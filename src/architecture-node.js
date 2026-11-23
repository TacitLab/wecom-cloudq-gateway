"use strict";

const watches = require("./architecture-watch");
const detailApi = require("./architecture-detail");
const capacityApi = require("./architecture-capacity");
const { alarmResource } = require("./architecture-duty");
const { TencentMonitorClient } = require("./monitor-client");
const { credentialRedactor } = require("./alert-credentials");

async function getNode(id, nodeId, options = {}) {
  const detail = await (options.getDetail || detailApi.getDetail)(id);
  const node = detail.nodes?.find(n => n.id === nodeId);
  if (!node) { const error = new Error("Architecture node not found，请刷新架构图后重试"); error.httpStatus = 404; throw error; }
  const resources = detail.resources.filter(r => node.resourceKeys.includes(`${r.productKey}:${r.region}:${r.id}`));
  const now = options.now ?? Date.now();
  const credential = watches.credentialFor(watches.getWatch(id).credentialId), redact = credentialRedactor(credential);
  const readCapacity = async () => {
    if (!resources.length) return { resources: [], warnings: [], errors: [] };
    try { return await (options.getCapacity || capacityApi.getCapacity)(id, { detail, resources, nodeIds: node.bindingNodeIds, now }); }
    catch (error) { return { resources: [], warnings: [], errors: [redact(error.message)] }; }
  };
  async function readAlarms(resource) {
    const alarms = new Map(), errors = [], warnings = [];
    if (resource.cloudProvider !== "tencent") return { items: [], errors: [], warnings: ["暂不支持读取该云厂商告警"], complete: false };
    const client = options.clientFor?.(resource.region) || new TencentMonitorClient({ ...credential, region: resource.region });
    // Use a bounded window: StartTime=0 fails in the cloud monitoring backend.
    for (const [statuses, start] of [[["ALARM"], Math.floor(now / 1000) - 30 * 86400], [["OK", "NO_CONF", "NO_DATA"], Math.floor(now / 1000) - 86400]]) {
      try {
        for (let page = 1; page <= 5; page++) {
          const response = await client.describeAlarmHistories({ Module: "monitor", AlarmObject: resource.id, Order: "DESC",
            PageNumber: page, PageSize: 100, StartTime: start, EndTime: Math.floor(now / 1000), AlarmStatus: statuses,
            MonitorTypes: ["MT_QCE", "MT_TAW"] });
          if (!Array.isArray(response.Histories) || !Number.isSafeInteger(response.TotalCount) || response.TotalCount < 0) throw new Error("Invalid 云监控告警响应");
          for (const alarm of response.Histories) {
            if (!alarmResource(alarm, [resource]) || (alarm.Region?.startsWith("ap-") && alarm.Region !== resource.region)) continue;
            alarms.set(alarm.AlarmId, { id: alarm.AlarmId, status: alarm.AlarmStatus, title: alarm.PolicyName || "产品告警",
              content: alarm.Content || "", firstOccurTime: alarm.FirstOccurTime * 1000, lastOccurTime: alarm.LastOccurTime * 1000 || alarm.FirstOccurTime * 1000 });
          }
          if (page * 100 >= response.TotalCount) break;
          if (!response.Histories.length || page === 5) { warnings.push("告警记录较多，当前仅读取每类最近 500 条"); break; }
        }
      } catch (error) { errors.push(redact(error.message)); }
    }
    return { items: [...alarms.values()].sort((a, b) => b.lastOccurTime - a.lastOccurTime), errors, warnings,
      complete: !errors.length && !warnings.length };
  }
  // Keep API concurrency bounded for nodes/containers with many resources.
  const alarmResults = new Map();
  const work = [...resources];
  const alarmPromise = Promise.all(Array.from({ length: Math.min(3, work.length) }, async () => {
    while (work.length) {
      const resource = work.shift();
      alarmResults.set(resource, await readAlarms(resource));
    }
  }));
  const [capacity] = await Promise.all([readCapacity(), alarmPromise]);
  return { node, fetchedAt: now, alarmWindowHours: 24, activeAlarmWindowDays: 30, warnings: capacity.warnings, errors: capacity.errors,
    resources: resources.map(resource => ({ ...resource, capacity: capacity.resources.find(r => r.resourceId === resource.id
      && r.productKey === resource.productKey && r.region === resource.region) || null, alarms: alarmResults.get(resource) })) };
}

module.exports = { getNode };
