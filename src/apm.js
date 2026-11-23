"use strict";

const { TencentMonitorClient } = require("./monitor-client");
const { validateRegion } = require("./alert-config");

const applicationKey = app => JSON.stringify([app.region, app.instanceId, app.serviceName]);
function normalizeApplications(value = []) {
  if (!Array.isArray(value) || value.length > 100) throw new Error("Invalid APM 应用范围，最多选择 100 个应用");
  const items = new Map();
  for (const app of value) {
    if (!app || typeof app.instanceId !== "string" || !/^apm-[\w-]{1,100}$/.test(app.instanceId)
      || typeof app.serviceName !== "string" || !app.serviceName.trim() || app.serviceName.length > 256
      || /[\x00-\x1f]/.test(app.serviceName)) throw new Error("Invalid APM 业务系统或应用");
    const item = { region: validateRegion(app.region), instanceId: app.instanceId, serviceName: app.serviceName,
      instanceName: typeof app.instanceName === "string" ? app.instanceName.slice(0, 256) : app.instanceId,
      serviceId: typeof app.serviceId === "string" ? app.serviceId.slice(0, 100) : "" };
    items.set(applicationKey(item), item);
  }
  return [...items.values()];
}

// Never report a truncated, malformed or repeated page as a complete inventory.
async function readPages(request, action, params, field, pageKey, keyFor) {
  const items = new Map(), pages = new Set();
  let received = 0;
  for (let page = 1; page <= 1000; page++) {
    const result = await request(action, { ...params, [pageKey]: page, PageSize: 100 });
    const rows = result[field], total = result.TotalCount;
    if (!Array.isArray(rows) || !Number.isSafeInteger(total) || total < 0) throw new Error(`${action} 返回不完整`);
    const fingerprint = JSON.stringify(rows);
    if (rows.length && pages.has(fingerprint)) throw new Error(`${action} 分页未读取完整，请重试`);
    pages.add(fingerprint);
    for (const row of rows) {
      const key = keyFor(row);
      if (!key) throw new Error(`${action} 返回对象缺少标识`);
      const previous = items.get(key);
      const timestamp = item => Math.max(Number(item?.LastOccurTime) || 0, Number(item?.RecoverTime) || 0);
      if (!previous || timestamp(row) > timestamp(previous)) items.set(key, row);
    }
    received += rows.length;
    // TotalCount counts rows, not unique AlarmIds: repeated notifications can
    // share an event id. Keep the newest status observation for each id.
    if (received >= total) return [...items.values()];
    if (!rows.length) throw new Error(`${action} 分页未读取完整，请重试`);
  }
  throw new Error(`${action} 超过分页上限，结果未读取完整`);
}

function apmRequest(credential, region, options) {
  const client = new TencentMonitorClient({ ...credential, region }, globalThis.fetch, { service: "apm", version: "2021-06-22" });
  return options.request || ((action, params) => client.request(action, params));
}
async function listInstances(credential, options = {}) {
  const rows = await readPages(apmRequest(credential, "ap-guangzhou", options), "DescribeApmInstances",
    { AllRegionsFlag: 1 }, "Instances", "PageIndex", row => row.InstanceId);
  // APM responses also contain ingestion tokens; expose only selector fields.
  return rows.map(row => ({ instanceId: row.InstanceId, instanceName: row.Name || row.InstanceId, region: validateRegion(row.Region) }));
}
async function listApplications(credential, region, instanceId, options = {}) {
  normalizeApplications([{ region, instanceId, serviceName: "validation" }]);
  const request = apmRequest(credential, region, options);
  const instances = await readPages(request, "DescribeApmInstances", { InstanceIds: [instanceId] }, "Instances", "PageIndex", row => row.InstanceId);
  const instance = instances.find(item => item.InstanceId === instanceId && item.Region === region);
  if (!instance) throw new Error("APM 业务系统不存在或地域不匹配");
  // The metric-list API can return zero even when applications exist. The
  // official service.name tag API is the application selector's source.
  const end = Math.floor((options.now || Date.now()) / 1000);
  const result = await request("DescribeTagValues", { InstanceId: instanceId, TagKey: "service.name",
    StartTime: end - 7 * 86400, EndTime: end, Type: "agentConfig" });
  if (!Array.isArray(result.Values) || result.Values.some(name => typeof name !== "string" || !name)) throw new Error("APM 应用列表返回不完整");
  return [...new Set(result.Values)].sort().map(serviceName => normalizeApplications([
    { region, instanceId, instanceName: instance.Name || instanceId, serviceName },
  ])[0]);
}

// Four outcomes: excluded, covered, covered with additional runtime dimensions,
// or undecidable. GroupBy describes aggregation, never membership.
const and = values => values.includes("excluded") ? "excluded" : values.includes("unknown") ? "unknown" : values.includes("conditional") ? "conditional" : "matched";
const or = values => values.includes("matched") ? "matched" : values.includes("conditional") ? "conditional" : values.includes("unknown") ? "unknown" : "excluded";
function dimensionMatch(condition, app) {
  const known = { region: app.region, "tapm.instance.key": app.instanceId, "service.name": app.serviceName,
    "service.id": app.serviceId || undefined };
  if (!condition || typeof condition.Key !== "string" || !Array.isArray(condition.Value) || !condition.Value.length
    || condition.Value.some(v => typeof v !== "string")) return "unknown";
  if (!(condition.Key in known)) return "conditional";
  const value = known[condition.Key];
  if (value === undefined) return "unknown";
  const op = String(condition.Operator).toLowerCase();
  if (["eq", "=", "in"].includes(op)) return condition.Value.includes(value) ? "matched" : "excluded";
  if (["ne", "neq", "!=", "not in", "notin"].includes(op)) return condition.Value.includes(value) ? "excluded" : "matched";
  // Do not execute arbitrary cloud expressions or regexes in the server process.
  return "unknown";
}
function filterMatch(filter, app, absent = "matched") {
  if (!filter) return absent;
  if (filter.Type === "EXPRESSION" || filter.Expression) return "unknown";
  if (!["", "DIMENSION", "BIND_ALL", undefined, null].includes(filter.Type)) return "unknown";
  if (!filter.Dimensions) return "matched";
  let groups;
  try { groups = typeof filter.Dimensions === "string" ? JSON.parse(filter.Dimensions) : filter.Dimensions; } catch { return "unknown"; }
  if (!Array.isArray(groups) || groups.some(g => !Array.isArray(g))) return "unknown";
  return groups.length ? or(groups.map(group => and(group.map(c => dimensionMatch(c, app))))) : "matched";
}
function matchPolicy(policy, app) {
  if (policy.MonitorType !== "MT_TAW") return "excluded";
  const global = filterMatch(policy.Filter, app, policy.IsBindAll === 1 ? "matched" : "unknown");
  if (global === "excluded") return global;
  const condition = policy.Condition;
  const rules = condition?.Rules || [];
  const eventRules = policy.EventCondition?.Rules || [];
  const metric = rules.length ? (condition.IsUnionRule === 1 ? and : condition.IsUnionRule === 2 ? () => "unknown" : or)
    (rules.map(rule => filterMatch(rule.Filter, app))) : "excluded";
  const event = eventRules.length ? or(eventRules.map(rule => filterMatch(rule.Filter, app))) : "excluded";
  return and([global, !rules.length && !eventRules.length ? "unknown" : or([metric, event])]);
}
async function listPolicies(credential, region, options = {}) {
  const client = options.client || new TencentMonitorClient({ ...credential, region: validateRegion(region) });
  return readPages((action, params) => client.describeAlarmPolicies(params), "DescribeAlarmPolicies",
    { Module: "monitor", MonitorTypes: ["MT_TAW"], Enable: [0, 1], NotBindAll: 0, Field: "PolicyId", Order: "ASC" },
    "Policies", "PageNumber", row => row.PolicyId);
}
function policySummary(policy, app) {
  const match = matchPolicy(policy, app);
  return { id: policy.PolicyId, name: policy.PolicyName || policy.PolicyId, namespace: policy.Namespace || "",
    enabled: policy.Enable === 1, match, reason: ({ matched: "覆盖此应用", conditional: "覆盖此应用，另有接口、实例或其他维度条件",
      unknown: "包含暂无法判定的条件，请核对策略范围", excluded: "不在策略范围内" })[match],
    filter: policy.Filter || null, condition: policy.Condition || null, eventCondition: policy.EventCondition || null,
    groupBy: policy.GroupBy || [] };
}
async function discoverPolicies(credential, applications, options = {}) {
  const apps = normalizeApplications(applications), byRegion = new Map();
  for (const region of new Set(apps.map(app => app.region))) {
    byRegion.set(region, await listPolicies(credential, region, { client: options.clientFor?.(region) }));
  }
  const items = apps.map(app => ({ ...app, policies: byRegion.get(app.region).map(p => policySummary(p, app)).filter(p => p.match !== "excluded") }));
  return { items, complete: items.every(app => app.policies.every(p => p.match !== "unknown")), fetchedAt: Date.now() };
}

function historyIdentity(history) {
  const values = new Map();
  const aliases = { "tapm.instance.key": "instanceId", "apm_instance": "instanceId", "InstanceKey": "instanceId", "业务系统": "instanceId",
    "service.name": "serviceName", "apm_service_name": "serviceName", "ServiceName": "serviceName", "应用": "serviceName",
    region: "region", Region: "region", "地域": "region" };
  function add(key, value) {
    key = aliases[key];
    if (!key || typeof value !== "string" || !value) return;
    if (key === "instanceId") {
      value = value.match(/^(apm-[\w-]+)(?:\([^\n]*\))?$/)?.[1];
      if (!value) return; // Display names are not business-system identifiers.
    }
    if (!values.has(key)) values.set(key, new Set());
    values.get(key).add(value);
  }
  function visit(value, depth = 0) {
    if (depth > 5 || !value) return;
    if (typeof value === "string") { try { visit(JSON.parse(value), depth + 1); } catch { /* labelled AlarmObject handled below */ } return; }
    if (Array.isArray(value)) { for (const item of value) visit(item, depth + 1); return; }
    if (typeof value !== "object") return;
    add(value.Name ?? value.Key ?? value.name, value.Value ?? value.value);
    for (const [key, entry] of Object.entries(value)) { add(key, entry); if (typeof entry === "object") visit(entry, depth + 1); }
  }
  visit(history.Dimensions); visit(history.InternalDimensions); visit(history.AlarmObject);
  if (/^(ap|na|sa|eu|me|af)-/.test(history.Region || "")) add("region", history.Region);
  // Parse full labelled values only; a substring/name mention is not evidence.
  if (typeof history.AlarmObject === "string") {
    for (const part of history.AlarmObject.split(/[,，;；\n]/)) {
      const match = part.trim().match(/^([^=:：]+)[=:：]\s*(.*?)\s*$/);
      if (match) add(match[1].trim(), match[2]);
    }
  }
  const result = {};
  for (const [key, entries] of values) result[key] = entries.size === 1 ? [...entries][0] : null;
  return result;
}
function matchHistory(history, app) {
  const identity = historyIdentity(history);
  if ((identity.instanceId && identity.instanceId !== app.instanceId) || (identity.serviceName && identity.serviceName !== app.serviceName)
    || (identity.region && /^(ap|na|sa|eu|me|af)-/.test(identity.region) && identity.region !== app.region)) return "excluded";
  return identity.instanceId === app.instanceId && identity.serviceName === app.serviceName ? "matched" : "unknown";
}

module.exports = { applicationKey, normalizeApplications, readPages, listInstances, listApplications, listPolicies,
  matchPolicy, policySummary, discoverPolicies, historyIdentity, matchHistory };
