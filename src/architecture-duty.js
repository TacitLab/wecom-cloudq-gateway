"use strict";

const crypto = require("node:crypto");
const { db } = require("./database");
const watches = require("./architecture-watch");
const detailApi = require("./architecture-detail");
const capacityApi = require("./architecture-capacity");
const duty = require("./architecture-duty-store");
const { TencentMonitorClient } = require("./monitor-client");
const { credentialRedactor } = require("./alert-credentials");

const active = new Map();
let timer;

function selectedResources(detail, settings, kind) {
  return detail.resources.filter(resource => {
    const product = settings.products[resource.productKey];
    return product?.enabled && (!kind || (product[kind] && resource.cloudProvider === "tencent"))
      && (!product.resourceIds.length || product.resourceIds.includes(resource.id));
  });
}

function stillCurrent(id, settings) {
  const row = db().prepare("SELECT enabled,revision FROM architecture_watch_settings WHERE watch_id=?").get(id);
  return row?.enabled && row.revision === settings.revision;
}

function transition(watchId, key, high, timestamp, event, settings) {
  if (settings && !stillCurrent(watchId, settings)) return;
  const previous = db().prepare("SELECT * FROM architecture_watch_signals WHERE watch_id=? AND signal_key=?").get(watchId, key);
  if (previous && timestamp <= previous.last_timestamp) return;
  // Queue and latch change must commit together, otherwise a restart can lose
  // a high-load event after the latch was already marked active.
  db().exec("BEGIN IMMEDIATE");
  try {
    if (high !== Boolean(previous?.active)) event(high);
    db().prepare(`INSERT INTO architecture_watch_signals(watch_id,signal_key,active,last_timestamp) VALUES(?,?,?,?)
      ON CONFLICT(watch_id,signal_key) DO UPDATE SET active=excluded.active,last_timestamp=excluded.last_timestamp`)
      .run(watchId, key, high ? 1 : 0, timestamp);
    db().exec("COMMIT");
  } catch (error) { db().exec("ROLLBACK"); throw error; }
}

async function collectCapacity(id, settings, detail, window, now, options, summary) {
  const resources = selectedResources(detail, settings, "metrics");
  if (!resources.length) return;
  try {
    const snapshot = await (options.getCapacity || capacityApi.getCapacity)(id, { detail, resources, now });
    summary.warnings.push(...snapshot.warnings);
    summary.errors.push(...snapshot.errors);
    const result = capacityApi.processSnapshot(id, settings, snapshot, now);
    summary.capacityResources = result.resources;
    summary.highLoadResources = result.highLoadResources;
    summary.events += result.events;
  } catch (error) { summary.errors.push(`智能顾问容量监测：${error.message}`); }
}

function alarmResource(history, resources) {
  // Only inspect identifier-bearing fields, never an arbitrary description
  // that might mention an unrelated resource from the same account.
  const text = JSON.stringify([history.Dimensions, history.InternalDimensions, history.AlarmObject, history.ResourceId, history.InstanceId]);
  return resources.find(resource => {
    const escaped = resource.id.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return new RegExp(`(^|[^a-zA-Z0-9_-])${escaped}($|[^a-zA-Z0-9_-])`).test(text);
  });
}

async function collectAlarms(id, settings, detail, credential, window, now, options, summary) {
  const keyFor = resource => `${resource.productKey}:${resource.region}:${resource.id}`;
  const pushable = new Set(selectedResources(detail, settings, "alarms").map(keyFor));
  const coverage = detail.resources.map(resource => ({ resourceId: resource.id, resourceName: resource.name,
    product: resource.product, productKey: resource.productKey, region: resource.region,
    status: resource.cloudProvider === "tencent" ? "pending" : "unsupported", pushEnabled: pushable.has(keyFor(resource)),
    activeCount: 0, totalCount: 0 }));
  const entries = new Map(coverage.map(entry => [`${entry.productKey}:${entry.region}:${entry.resourceId}`, entry]));
  const resources = detail.resources.filter(resource => resource.cloudProvider === "tencent");
  const regions = [...new Set(resources.map(r => r.region || ""))];
  const allAlarms = new Map();
  summary.alarms = { resourceCount: detail.resources.length, queriedResources: 0, activeCount: 0, totalCount: 0,
    requests: 0, complete: false, lookbackDays: 30, resources: coverage };
  for (const region of regions) {
    const scoped = resources.filter(r => (r.region || "") === region);
    const client = options.clientFor?.(region) || new TencentMonitorClient({ ...credential, region });
    const histories = new Map();
    let complete = false, failed = false;
    try {
      // The API filters FirstOccurTime. A short incremental window misses
      // ongoing alarms and recoveries whose initial alarm started earlier.
      // Omit monitor/status filters so every returned alarm type is covered.
      for (let page = 1; page <= 100; page++) {
        summary.alarms.requests++;
        const response = await client.describeAlarmHistories({ Module: "monitor", PageNumber: page, PageSize: 100,
          StartTime: Math.floor(now / 1000) - 30 * 86400, EndTime: Math.floor(now / 1000), Order: "DESC" });
        if (!Array.isArray(response.Histories) || !Number.isSafeInteger(response.TotalCount) || response.TotalCount < 0) throw new Error("Invalid alarm history response");
        for (const history of response.Histories) {
          if (!history.AlarmId) continue;
          const previous = histories.get(history.AlarmId);
          if (!previous || Number(history.LastOccurTime || 0) >= Number(previous.LastOccurTime || 0)) histories.set(history.AlarmId, history);
        }
        if (!response.Histories.length && response.TotalCount > 0) { summary.warnings.push(`${region || "全地域"} 告警结果未读取完整`); break; }
        if (page * 100 >= response.TotalCount) { complete = true; break; }
        if (page === 100) { summary.warnings.push(`${region || "全地域"} 告警结果未读取完整`); break; }
      }
    } catch (error) { failed = true; summary.errors.push(`${region || "全地域"} 告警：${error.message}`); }
    for (const resource of scoped) {
      const entry = entries.get(keyFor(resource));
      entry.status = complete ? "checked" : histories.size ? "partial" : failed ? "failed" : "partial";
      if (complete) summary.alarms.queriedResources++;
    }
    for (const history of histories.values()) {
      if (!stillCurrent(id, settings)) return;
      const matches = scoped.filter(resource => alarmResource(history, [resource]) &&
        (!/^(?:ap|na|sa|eu|me)-/.test(history.Region || "") || !resource.region || history.Region === resource.region));
      if (!matches.length) continue;
      allAlarms.set(history.AlarmId, history);
      for (const resource of matches) {
        const entry = entries.get(keyFor(resource));
        entry.totalCount++;
        if (history.AlarmStatus === "ALARM") entry.activeCount++;
      }
      // Query all architecture resources, but preserve explicit push scopes.
      const resource = matches.find(resource => pushable.has(keyFor(resource)));
      if (!resource || !["ALARM", "OK"].includes(history.AlarmStatus)) continue;
      const recovered = history.AlarmStatus === "OK";
      let occurredAt = Number(recovered ? history.RecoverTime || history.LastOccurTime : history.FirstOccurTime) * 1000;
      let observedRecovery = false;
      if (!Number.isFinite(occurredAt) || occurredAt > now) continue;
      if (recovered && occurredAt < Math.max(window.start, settings.updatedAt)) {
        const prior = db().prepare("SELECT notified_at FROM architecture_watch_events WHERE watch_id=? AND event_key=?")
          .get(id, `alarm:${history.AlarmId}:ALARM`);
        if (!prior?.notified_at) continue;
        // LastOccurTime is not always a recovery timestamp. A known active
        // alarm now reported as OK is a recovery observed in this check.
        occurredAt = now; observedRecovery = true;
      }
      summary.events += Number(duty.enqueue(id, settings, { key: `alarm:${history.AlarmId}:${history.AlarmStatus}`,
        type: recovered ? "recovery" : "alarm", resourceId: resource.id, product: resource.product, region: resource.region,
        title: `${resource.name}：${history.PolicyName || history.Content || history.AlarmContent || (recovered ? "告警恢复" : "触发告警")}`,
        payload: { ...history, resourceName: resource.name, occurredAt, observedAt: now, observedRecovery } }));
    }
  }
  summary.alarms.totalCount = allAlarms.size;
  summary.alarms.activeCount = [...allAlarms.values()].filter(alarm => alarm.AlarmStatus === "ALARM").length;
  summary.alarms.complete = coverage.every(resource => resource.status === "checked");
  for (const resource of coverage.filter(r => r.status === "unsupported")) summary.warnings.push(`${resource.resourceId}：暂不支持该云厂商的产品告警查询`);
}

async function runCheck(id, options = {}) {
  const settings = duty.getSettings(id), now = options.now || Date.now();
  if (!settings.enabled || !settings.targetChatId) return { skipped: true, reason: "请先保存启用值守并绑定推送群" };
  const window = duty.scheduleWindow(settings.schedule, now);
  if (!window) return { skipped: true, reason: "当前不在值守时段（Asia/Shanghai）" };
  db().prepare("UPDATE architecture_watch_settings SET last_attempt_at=? WHERE watch_id=?").run(now, id);
  const credential = watches.credentialFor(watches.getWatch(id).credentialId), redact = credentialRedactor(credential);
  const summary = { resources: 0, capacityResources: 0, highLoadResources: 0, events: 0, warnings: [], errors: [] };
  try {
    const detail = await (options.getDetail || detailApi.getDetail)(id);
    if (duty.getSettings(id).revision !== settings.revision) return { skipped: true, reason: "值守配置已变更" };
    const resources = selectedResources(detail, settings);
    summary.resources = resources.length;
    for (const resource of resources) {
      const high = /异常|故障|失败|不可用|error|failed|unhealthy/i.test(resource.status);
      const healthy = /运行中|正常|可用|^(?:running|active|ready|available)$/i.test(resource.status);
      if (!high && !healthy) {
        if (!resource.status || /未知|unknown/i.test(resource.status)) summary.warnings.push(`${resource.id}：资源状态未知`);
        continue;
      }
      transition(id, `status:${resource.productKey}:${resource.region}:${resource.id}`, high, Math.floor(now / 1000), isHigh => {
        summary.events += Number(duty.enqueue(id, settings, { key: `status:${resource.productKey}:${resource.region}:${resource.id}:${now}`,
          type: isHigh ? "resource_status" : "recovery", title: `${resource.name}：${isHigh ? resource.status : "资源状态恢复"}`,
          resourceId: resource.id, product: resource.product, region: resource.region, payload: { status: resource.status, resourceName: resource.name, occurredAt: now } }));
      }, settings);
    }
    await collectAlarms(id, settings, detail, credential, window, now, options, summary);
    await collectCapacity(id, settings, detail, window, now, options, summary);
  } catch (error) { summary.errors.push(error.message); }
  if (stillCurrent(id, settings)) {
    try { await require("./architecture-apm").collect(id, settings, credential, window, now, options, summary); }
    catch (error) { summary.errors.push(`APM：${error.message}`); }
  }
  summary.errors = summary.errors.map(redact); summary.warnings = summary.warnings.map(redact);
  const error = [...summary.errors, ...summary.warnings].join("；").slice(0, 3000);
  db().prepare("INSERT INTO architecture_watch_checks(id,watch_id,summary_json,error,created_at) VALUES(?,?,?,?,?)")
    .run(crypto.randomUUID(), id, JSON.stringify(summary), error || null, now);
  db().prepare("UPDATE architecture_watch_settings SET last_success_at=CASE WHEN ?=0 THEN ? ELSE last_success_at END,last_error=? WHERE watch_id=? AND revision=?")
    .run(summary.errors.length, now, error || null, id, settings.revision);
  require("./architecture-duty-worker").schedule();
  return summary;
}

function checkNow(id, options = {}) {
  if (active.has(id)) return active.get(id);
  const task = runCheck(id, options).finally(() => active.delete(id));
  active.set(id, task); return task;
}

async function tick() {
  const now = Date.now();
  const ids = db().prepare("SELECT watch_id FROM architecture_watch_settings WHERE enabled=1 AND target_chat_id IS NOT NULL").all();
  await Promise.allSettled(ids.map(({ watch_id: id }) => {
    const settings = duty.getSettings(id);
    if ((!settings.lastAttemptAt || now - settings.lastAttemptAt >= settings.pollIntervalSeconds * 1000) && duty.scheduleWindow(settings.schedule, now)) return checkNow(id);
  }));
  require("./architecture-duty-worker").schedule();
}

function start() {
  if (timer) return;
  const run = () => tick().catch(error => console.error("architecture_duty_tick_failed", { message: error.message }));
  run(); timer = setInterval(run, 10000); timer.unref?.();
}
function stop() { clearInterval(timer); timer = undefined; }
async function drain() { await Promise.allSettled([...active.values()]); }

module.exports = { checkNow, tick, start, stop, drain, selectedResources, alarmResource };
