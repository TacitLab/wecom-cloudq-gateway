"use strict";

const apm = require("./apm");
const duty = require("./architecture-duty-store");
const { db } = require("./database");
const { TencentMonitorClient } = require("./monitor-client");

async function collect(id, settings, credential, window, now, options, summary) {
  const apps = settings.apmApplications || [];
  if (!apps.length) return;
  const current = () => { const latest = duty.getSettings(id); return latest.enabled && latest.revision === settings.revision; };
  const result = summary.apm = { complete: true, lookbackDays: 30, applications: [], totalCount: 0, activeCount: 0, unresolvedCount: 0 };
  const seen = new Set(), unresolved = new Set();
  for (const region of new Set(apps.map(app => app.region))) {
    if (!current()) return;
    const scoped = apps.filter(app => app.region === region);
    const client = options.apmClientFor?.(region) || new TencentMonitorClient({ ...credential, region });
    const entries = scoped.map(app => ({ ...app, policies: [], status: "checked", totalCount: 0, activeCount: 0 }));
    result.applications.push(...entries);
    try {
      const policies = await apm.listPolicies(credential, region, { client });
      for (const entry of entries) {
        entry.policies = policies.map(p => apm.policySummary(p, entry)).filter(p => p.match !== "excluded");
        if (entry.policies.some(p => p.match === "unknown")) {
          result.complete = false; entry.status = "partial";
          summary.warnings.push(`APM ${entry.serviceName}：部分策略的应用范围待核对`);
        }
      }
    } catch (error) {
      result.complete = false;
      entries.forEach(entry => { entry.status = "partial"; });
      summary.errors.push(`APM ${region} 策略查询：${error.message}`);
    }
    // Read all APM events, including events from removed/changed policies. A
    // policy list is configuration coverage, not proof of an event's identity.
    try {
      const histories = await apm.readPages((action, params) => client.describeAlarmHistories(params), "DescribeAlarmHistories",
        { Module: "monitor", MonitorTypes: ["MT_TAW"], StartTime: Math.floor(now / 1000) - 30 * 86400,
          EndTime: Math.floor(now / 1000), Order: "DESC" }, "Histories", "PageNumber", row => row.AlarmId);
      for (const history of histories) {
        if (!current()) return;
        if (history.MonitorType && history.MonitorType !== "MT_TAW") continue;
        const matches = entries.filter(app => apm.matchHistory(history, app) === "matched");
        if (!matches.length) {
          if (entries.some(app => apm.matchHistory(history, app) === "unknown")) unresolved.add(history.AlarmId);
          continue;
        }
        if (seen.has(history.AlarmId)) continue;
        seen.add(history.AlarmId); result.totalCount++;
        if (history.AlarmStatus === "ALARM") result.activeCount++;
        for (const app of matches) { app.totalCount++; if (history.AlarmStatus === "ALARM") app.activeCount++; }
        if (!["ALARM", "OK"].includes(history.AlarmStatus)) continue;
        const app = matches[0], recovered = history.AlarmStatus === "OK";
        let occurredAt = Number(recovered ? history.RecoverTime || history.LastOccurTime : history.FirstOccurTime) * 1000;
        let observedRecovery = false;
        if (!Number.isFinite(occurredAt) || occurredAt <= 0 || occurredAt > now) continue;
        if (recovered && occurredAt < Math.max(window.start, settings.updatedAt)) {
          const prior = db().prepare("SELECT notified_at FROM architecture_watch_events WHERE watch_id=? AND event_key=?")
            .get(id, `alarm:${history.AlarmId}:ALARM`);
          if (!prior?.notified_at) continue;
          occurredAt = now; observedRecovery = true;
        }
        summary.events += Number(duty.enqueue(id, settings, { key: `alarm:${history.AlarmId}:${history.AlarmStatus}`,
          type: recovered ? "recovery" : "alarm", product: "APM", resourceId: `${app.instanceId}/${app.serviceName}`, region: app.region,
          title: `${app.serviceName}：${history.PolicyName || (recovered ? "告警恢复" : "应用告警")}`,
          payload: { ...history, MonitorType: "MT_TAW", source: "apm", application: {
            region: app.region, instanceId: app.instanceId, instanceName: app.instanceName, serviceName: app.serviceName, serviceId: app.serviceId,
          }, resourceName: app.serviceName, occurredAt, observedAt: now, observedRecovery } }));
      }
    } catch (error) {
      result.complete = false; entries.forEach(entry => { entry.status = "failed"; });
      summary.errors.push(`APM ${region} 告警查询：${error.message}`);
    }
  }
  result.unresolvedCount = unresolved.size;
  if (unresolved.size) {
    result.complete = false;
    summary.warnings.push(`APM 有 ${unresolved.size} 条告警无法确定应用归属（可能为跨应用聚合），未自动推送`);
  }
}

module.exports = { collect };
