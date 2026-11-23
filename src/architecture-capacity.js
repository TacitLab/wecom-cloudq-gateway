"use strict";

const crypto = require("node:crypto");
const { db } = require("./database");
const watches = require("./architecture-watch");
const detailApi = require("./architecture-detail");
const duty = require("./architecture-duty-store");

const HOUR = 3600000, DAY = 24 * HOUR;
const MAX_REPORT_AGE = DAY;
const REMINDER_MILESTONES = [0, HOUR, 6 * HOUR, DAY, 3 * DAY, 7 * DAY];

function reportTime(value) {
  if (typeof value !== "string" || !value) return null;
  const time = Date.parse(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(value) ? value.replace(" ", "T") + "+08:00" : value);
  return Number.isFinite(time) ? time : null;
}

function riskLevel(value) { return Number.isInteger(value) && value >= 0 && value <= 3 ? value : null; }

// Share an in-flight cloud refresh across the duty worker and node inspector.
const currentTasks = new Map();
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
async function currentCapacityTask(watch, credential, request, options) {
  const cache = options.taskCache || (options.request ? new Map() : currentTasks);
  const identity = crypto.createHash("sha256").update(`${credential.secretId}\0${credential.secretKey}`).digest("hex");
  const key = `${watch.id}:${watch.archId}:${identity}`;
  let entry = cache.get(key);
  if (entry?.promise) return entry.promise;
  if (entry?.overview?.IsFinish === true && Date.now() - entry.completedAt < 30000) return entry;
  // Keep polling the same unfinished job instead of creating a job each time.
  if (!entry || entry.overview?.IsFinish === true || Date.now() - entry.startedAt > 600000) {
    entry = { startedAt: Date.now(), sessionId: crypto.randomUUID() };
    cache.set(key, entry);
    if (cache.size > 128) cache.delete(cache.keys().next().value);
  }
  entry.promise = (async () => {
    if (!entry.taskId) {
      const config = await request("DescribeArchThresholdConfigStatusV2", { MapId: watch.archId });
      if (!Number.isSafeInteger(config.AnalysisDay) || config.AnalysisDay <= 0 || config.AnalysisDay > 365) {
        throw new Error("Invalid 智能顾问未返回有效分析周期，请先在智能顾问配置容量监测");
      }
      entry.periodDays = config.AnalysisDay;
      const refresh = await request("UpdateNodeResourceCapacityMetricV2", {
        MapId: watch.archId, SessionId: entry.sessionId, Source: 1, Period: config.AnalysisDay,
      });
      if (refresh.MapId !== watch.archId || typeof refresh.CapacityAsyncId !== "string" || !refresh.CapacityAsyncId) {
        throw new Error("Invalid 智能顾问容量刷新任务响应");
      }
      entry.taskId = refresh.CapacityAsyncId;
    }
    for (let attempt = 0; attempt < (options.pollAttempts ?? 20); attempt++) {
      entry.overview = await request("DescribeNodeLoadInfoV2New", {
        MapId: watch.archId, SessionId: entry.sessionId, TaskId: entry.taskId, Mode: "monitor",
      });
      if (!Array.isArray(entry.overview.NodeLoadRiskInfos)) throw new Error("Invalid 智能顾问容量节点响应");
      if (entry.overview.IsFinish === true) break;
      if (attempt + 1 < (options.pollAttempts ?? 20)) await (options.wait || delay)(1000);
    }
    entry.completedAt = Date.now();
    return entry;
  })();
  try { return await entry.promise; }
  catch (error) { cache.delete(key); throw error; }
  finally { entry.promise = null; }
}

async function getCapacity(id, options = {}) {
  const now = options.now ?? Date.now(), detail = options.detail || await detailApi.getDetail(id);
  const watch = watches.getWatch(id), credential = watches.credentialFor(watch.credentialId);
  const request = options.request || ((action, params) => watches.request(credential, action, params));
  const resources = options.resources || detail.resources;
  const { overview, taskId } = await currentCapacityTask(watch, credential, request, options);
  const result = new Map(), warnings = [], errors = [];
  for (const node of overview.NodeLoadRiskInfos) {
    if (options.nodeIds && !options.nodeIds.includes(node.NodeId)) continue;
    const scoped = resources.filter(resource => resource.cloudProvider === "tencent" && resource.nodeIds?.includes(node.NodeId));
    if (!scoped.length) continue;
    if (node.IsFinish !== true || node.TaskId !== taskId || node.LastSuccessTaskId !== taskId) {
      warnings.push(`${node.NodeName || node.NodeId}：智能顾问容量任务尚未完成`); continue;
    }
    try {
      const response = await request("DescribeNodeResourceLoadInfoV2New", {
        MapId: watch.archId, NodeUuid: node.NodeId, TaskId: taskId,
      });
      if (!Array.isArray(response.ResourceLoadRiskInfos)) throw new Error("Invalid 智能顾问实例容量响应");
      const updatedAt = reportTime(response.LatestUpdateTime);
      const stale = !updatedAt || now - updatedAt > MAX_REPORT_AGE || updatedAt > now + 300000;
      for (const resource of scoped) {
        const source = response.ResourceLoadRiskInfos.find(r => r.InsId === resource.id && (!r.Region || r.Region === resource.region));
        if (!source) continue;
        const entry = { resourceId: resource.id, resourceName: resource.name, productKey: resource.productKey, product: resource.product,
          region: resource.region, nodeIds: [node.NodeId], nodeNames: [node.NodeName || node.NodeId],
          riskLevel: riskLevel(source.RiskLevel), periodDays: source.Period ?? null,
          metrics: Array.isArray(source.MetricValueList) ? source.MetricValueList.filter(metric => typeof metric.Metric === "string").map(metric => ({
            name: metric.Metric, riskLevel: riskLevel(metric.MetricRiskLevel), value: Number.isFinite(metric.Value) ? metric.Value : null,
          })) : [], riskDurations: Array.isArray(source.RiskDurationList) ? source.RiskDurationList : [],
          updatedAt, taskId, stale, supported: riskLevel(source.RiskLevel) !== null };
        const key = `${resource.productKey}:${resource.region}:${resource.id}`, existing = result.get(key);
        // Prefer fresh completed reports over old ones. For the same resource
        // on several nodes, retain the worst cloud judgement, without duplicates.
        if (!existing || (existing.stale && !entry.stale)) result.set(key, entry);
        else if (existing.stale === entry.stale) {
          existing.nodeIds = [...new Set([...existing.nodeIds, node.NodeId])];
          existing.nodeNames = [...new Set([...existing.nodeNames, node.NodeName || node.NodeId])];
          if (entry.riskLevel !== null) existing.riskLevel = existing.riskLevel === null ? entry.riskLevel : Math.max(existing.riskLevel, entry.riskLevel);
          const metrics = new Map(existing.metrics.map(metric => [metric.name, metric]));
          for (const metric of entry.metrics) {
            const previous = metrics.get(metric.name);
            if (!previous || (metric.riskLevel ?? -1) > (previous.riskLevel ?? -1)) metrics.set(metric.name, metric);
          }
          existing.metrics = [...metrics.values()];
          existing.supported ||= entry.supported;
        }
      }
    } catch (error) { errors.push(`${node.NodeName || node.NodeId}：${error.message}`); }
  }
  for (const resource of resources) {
    const key = `${resource.productKey}:${resource.region}:${resource.id}`;
    if (!result.has(key)) warnings.push(`${resource.id}：暂无已完成的智能顾问容量结果（可能未开启或暂不支持）`);
  }
  for (const resource of result.values()) {
    if (!resource.supported) warnings.push(`${resource.resourceId}：智能顾问尚未提供有效容量指标（可能暂不支持该资源）`);
    else if (!resource.updatedAt) warnings.push(`${resource.resourceId}：云端未返回有效监测时间，暂停高负载及恢复判定`);
    else if (resource.stale) warnings.push(`${resource.resourceId}：容量结果超过 24 小时未更新，暂停高负载播报及恢复判定`);
  }
  return { source: "advisor", taskId, fetchedAt: Date.now(), finishedAt: reportTime(overview.FinishTime), complete: overview.IsFinish === true,
    resources: [...result.values()], warnings, errors };
}

function reminderStage(elapsed) {
  if (elapsed >= REMINDER_MILESTONES.at(-1)) return 5 + Math.floor((elapsed - 7 * DAY) / (7 * DAY));
  for (let stage = REMINDER_MILESTONES.length - 2; stage >= 0; stage--) if (elapsed >= REMINDER_MILESTONES[stage]) return stage;
  return 0;
}

function currentConfig(id, settings) {
  const row = db().prepare("SELECT enabled,revision FROM architecture_watch_settings WHERE watch_id=?").get(id);
  return row?.enabled && row.revision === settings.revision;
}

function observe(id, settings, resource, metric, now) {
  if (!currentConfig(id, settings)) return 0;
  const key = `capacity:${resource.productKey}:${resource.region}:${resource.resourceId}:${metric.name}`;
  const previous = db().prepare("SELECT * FROM architecture_capacity_signals WHERE watch_id=? AND signal_key=?").get(id, key);
  if (previous && resource.updatedAt < previous.last_report_at) return 0; // ignore out-of-order old task results
  const high = metric.riskLevel === 3;
  if (!high && !previous?.active) return 0;
  const lastEvent = previous?.last_event_id ? db().prepare("SELECT notified_at,analysis_status,completed_at,attempts FROM architecture_watch_events WHERE id=?").get(previous.last_event_id) : null;
  const lastNotifiedAt = Math.max(previous?.last_notified_at || 0, lastEvent?.notified_at || 0) || null;
  const continuing = high && previous?.active;
  const firstSeenAt = previous?.active ? previous.first_seen_at : now;
  const episodeId = high && !continuing ? crypto.randomUUID() : previous.episode_id;
  let stage = previous?.active ? previous.reminder_stage : 0;
  let eventId = previous?.last_event_id || null;
  let emit = !continuing && high;
  if (continuing) {
    const dueStage = reminderStage(now - firstSeenAt);
    const pending = lastEvent && !lastEvent.notified_at && !lastEvent.completed_at && lastEvent.attempts < 5;
    const cancelledUnsent = lastEvent && !lastEvent.notified_at && lastEvent.analysis_status === "cancelled";
    if (!pending && (!lastNotifiedAt || now - lastNotifiedAt >= HOUR) && (dueStage > stage || cancelledUnsent)) {
      stage = Math.max(stage, dueStage); emit = true;
    }
  }
  if (!high) emit = Boolean(lastNotifiedAt); // do not announce recovery for an event nobody received
  let claimed = 0;
  db().exec("BEGIN IMMEDIATE");
  try {
    if (emit) {
      eventId = crypto.randomUUID();
      claimed = Number(duty.enqueue(id, settings, { id: eventId,
        key: `${key}:${episodeId}:${high ? `stage-${stage}` : "recovery"}${high && lastEvent?.analysis_status === 'cancelled' ? `:revision-${settings.revision}` : ''}`,
        type: high ? "high_load" : "recovery", resourceId: resource.resourceId, product: resource.product, region: resource.region,
        title: `${resource.resourceName} ${metric.name}${high ? continuing ? "高负载仍未解除" : "高负载" : "高负载判定已解除"}`,
        payload: { source: "advisor", resourceName: resource.resourceName, metric: metric.name, value: metric.value,
          riskLevel: metric.riskLevel, periodDays: resource.periodDays, sourceUpdatedAt: resource.updatedAt, taskId: resource.taskId,
          firstSeenAt, observedDurationMs: now - firstSeenAt, reminderStage: stage, nodeNames: resource.nodeNames,
          capacitySignal: { key, episodeId }, occurredAt: now } }));
    }
    db().prepare(`INSERT INTO architecture_capacity_signals(watch_id,signal_key,episode_id,active,first_seen_at,last_seen_at,last_report_at,last_notified_at,reminder_stage,last_event_id)
      VALUES(?,?,?,?,?,?,?,?,?,?) ON CONFLICT(watch_id,signal_key) DO UPDATE SET episode_id=excluded.episode_id,active=excluded.active,
      first_seen_at=excluded.first_seen_at,last_seen_at=excluded.last_seen_at,last_report_at=excluded.last_report_at,
      last_notified_at=excluded.last_notified_at,reminder_stage=excluded.reminder_stage,last_event_id=excluded.last_event_id`)
      .run(id, key, episodeId, high ? 1 : 0, high ? firstSeenAt : previous.first_seen_at, now, resource.updatedAt,
        lastNotifiedAt, stage, eventId);
    db().exec("COMMIT");
  } catch (error) { db().exec("ROLLBACK"); throw error; }
  return claimed;
}

function processSnapshot(id, settings, snapshot, now = Date.now()) {
  let events = 0, resources = 0, highLoadResources = 0;
  for (const resource of snapshot.resources) {
    if (resource.stale || !resource.supported || !resource.updatedAt) continue;
    resources++;
    const metrics = resource.metrics.filter(metric => metric.riskLevel !== null);
    if (resource.riskLevel === 3 || metrics.some(m => m.riskLevel === 3)) highLoadResources++;
    if (resource.riskLevel === 3 && !metrics.some(metric => metric.riskLevel === 3)) {
      metrics.push({ name: "实例整体负载", riskLevel: 3, value: null });
    }
    for (const metric of metrics) events += observe(id, settings, resource, metric, now);
    // A fresh completed non-high instance report explicitly ends any old high
    // signals whose metric was removed from the cloud capacity configuration.
    if (resource.riskLevel !== null && resource.riskLevel < 3) {
      const prefix = `capacity:${resource.productKey}:${resource.region}:${resource.resourceId}:`;
      const active = db().prepare("SELECT signal_key FROM architecture_capacity_signals WHERE watch_id=? AND active=1").all(id);
      for (const signal of active.filter(s => s.signal_key.startsWith(prefix))) {
        const name = signal.signal_key.slice(prefix.length);
        if (!metrics.some(metric => metric.name === name)) events += observe(id, settings, resource, { name, riskLevel: resource.riskLevel, value: null }, now);
      }
    }
  }
  return { events, resources, highLoadResources };
}

module.exports = { getCapacity, processSnapshot, reminderStage, reportTime, REMINDER_MILESTONES, MAX_REPORT_AGE };
