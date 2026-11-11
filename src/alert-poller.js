"use strict";

const alertStore = require("./alert-store");
const alertWorker = require("./alert-worker");
const { createAlertClient, normalizeClsHistory } = require("./alert-config");
const { safeError } = require("./utils");

const active = new Set();
let timer;

function queryFor(integration, page, startTime, endTime) {
  if (integration.monitorType === "MT_CLS") {
    const filters = [{ Key: "status", Values: integration.includeRecovery ? ["0", "1"] : ["0"] }];
    if (integration.policyIds.length) filters.push({ Key: "alertId", Values: integration.policyIds });
    return { From: startTime * 1000, To: endTime * 1000, Offset: (page - 1) * 100, Limit: 100, Filters: filters };
  }
  const query = {
    Module: "monitor",
    PageNumber: page,
    PageSize: 100,
    Order: "ASC",
    StartTime: startTime,
    EndTime: endTime,
    AlarmStatus: integration.includeRecovery ? ["ALARM", "OK"] : ["ALARM"],
    MonitorTypes: [integration.monitorType],
  };
  if (integration.policyIds.length) {
    query.PolicyIds = integration.policyIds;
  } else if (integration.namespace) {
    query.Namespaces = [{ MonitorType: integration.monitorType, Namespace: integration.namespace }];
  }
  return query;
}

async function pollIntegration(integration, options = {}) {
  if (!integration.agentConfigId) return { skipped: true, reason: "wma_agent_not_bound" };
  if (active.has(integration.id)) return { skipped: true, reason: "already_running" };
  active.add(integration.id);
  const attemptedAt = Date.now();
  alertStore.updatePollState(integration.id, { attemptedAt });
  try {
    const endTime = Math.floor(attemptedAt / 1000);
    const cursor = integration.lastSuccessAt || attemptedAt - integration.initialLookbackSeconds * 1000;
    const startTime = Math.max(0, Math.floor(cursor / 1000) - integration.overlapSeconds);
    const client = options.client || createAlertClient(integration);
    let page = 1;
    let discovered = 0;
    let claimed = 0;
    const isCls = integration.monitorType === "MT_CLS";
    while (true) {
      const query = queryFor(integration, page, startTime, endTime);
      const response = isCls ? await client.describeAlertRecordHistory(query) : await client.describeAlarmHistories(query);
      const records = isCls ? response.Records : response.Histories;
      const items = Array.isArray(records) ? records : [];
      const histories = isCls
        ? items.map((record) => normalizeClsHistory(record, integration.region))
        : items.map((history) => ({
          ...history,
          MonitorType: history.MonitorType || integration.monitorType,
          Region: history.Region || integration.region,
        }));
      for (const history of histories) {
        discovered += 1;
        if (alertStore.enqueueHistory(integration.id, history).claimed) claimed += 1;
      }
      const total = Number(response.TotalCount || 0);
      if (!histories.length || page * 100 >= total) break;
      page += 1;
    }
    alertStore.updatePollState(integration.id, { attemptedAt, succeededAt: attemptedAt, error: null });
    if (claimed) alertWorker.schedule();
    return { discovered, claimed, startTime, endTime };
  } catch (error) {
    alertStore.updatePollState(integration.id, { attemptedAt, error: safeError(error).slice(0, 500) });
    throw error;
  } finally {
    active.delete(integration.id);
  }
}

async function pollNow(id, options = {}) {
  const integration = alertStore.getIntegration(id, { secrets: true });
  if (!integration) throw new Error("Alert integration not found");
  if (!integration.agentConfigId) throw new Error("WMA Agent is not bound to this Bot");
  if (!integration.targetChatId) throw new Error("Target WeCom group is not bound");
  return pollIntegration(integration, options);
}

async function tick() {
  await Promise.allSettled(alertStore.dueIntegrations().map((integration) => pollIntegration(integration)));
  alertWorker.schedule();
}

function start() {
  if (timer) return;
  tick().catch((error) => console.error("alert_poll_tick_failed", { message: safeError(error) }));
  timer = setInterval(() => tick().catch((error) =>
    console.error("alert_poll_tick_failed", { message: safeError(error) })), 10000);
  timer.unref?.();
}

function stop() {
  if (timer) clearInterval(timer);
  timer = undefined;
}

module.exports = { pollIntegration, pollNow, queryFor, start, stop, tick };
