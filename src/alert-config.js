"use strict";

const { TencentMonitorClient } = require("./monitor-client");
const { TencentClsClient } = require("./cls-client");

const SOURCE_NAMES = { MT_QCE: "云产品监控", MT_TAW: "应用性能监控 APM", MT_CLS: "日志服务 CLS" };

function validateMonitorType(value = "MT_QCE") {
  const result = String(value).trim();
  if (!/^MT_[A-Z0-9_]{1,40}$/.test(result)) throw new Error("Invalid monitor type");
  return result;
}

function createAlertClient(config) {
  return config.monitorType === "MT_CLS" ? new TencentClsClient(config) : new TencentMonitorClient(config);
}

function clsPolicySummary(policy) {
  return {
    id: String(policy.AlarmId || ""),
    name: String(policy.Name || policy.AlarmId || ""),
    namespace: "",
    namespaceName: "日志服务 CLS",
    monitorType: "MT_CLS",
    enabled: policy.Status === true || policy.Status === 1,
  };
}

function normalizeClsHistory(record, region) {
  return {
    AlarmId: String(record.RecordId || ""),
    AlarmStatus: ({ 0: "ALARM", 1: "OK", 2: "NO_CONF" })[record.Status] || "NO_DATA",
    PolicyId: record.AlarmId,
    PolicyName: record.AlarmName,
    AlarmObject: [record.TopicName, record.TopicId].filter(Boolean).join(" · "),
    Region: record.Region || region,
    MonitorType: "MT_CLS",
    Namespace: "",
    FirstOccurTime: Math.floor(Number(record.CreateTime || 0) / 1000),
    Content: record.Trigger || "",
    AlarmLevel: record.AlarmLevel,
    Dimensions: JSON.stringify({ TopicId: record.TopicId, TopicName: record.TopicName }),
    RawData: record,
  };
}

const REGION_PATTERN = /^(ap|eu|na|sa|me|af)-[a-z0-9-]+$/;

function validateRegion(value) {
  const region = String(value || "").trim();
  if (!region) throw new Error("Region is required");
  if (!REGION_PATTERN.test(region) || region.length > 100) throw new Error("Invalid Tencent Cloud region");
  return region;
}

function policySummary(policy) {
  return {
    id: String(policy.PolicyId || ""),
    name: String(policy.PolicyName || policy.PolicyId || ""),
    namespace: String(policy.Namespace || ""),
    namespaceName: String(policy.NamespaceShowName || policy.Namespace || ""),
    monitorType: String(policy.MonitorType || ""),
    enabled: Number(policy.Enable) === 1,
  };
}

async function listAlarmPolicies(credential, region, options = {}) {
  const selectedRegion = validateRegion(region);
  const monitorType = options.monitorType ? validateMonitorType(options.monitorType) : undefined;
  const isCls = monitorType === "MT_CLS";
  const client = options.client || createAlertClient({ ...credential, region: selectedRegion, monitorType });
  const items = [];
  let page = 1;

  while (true) {
    const response = isCls ? await client.describeAlarms({ Offset: (page - 1) * 100, Limit: 100 }) : await client.describeAlarmPolicies({
      Module: "monitor",
      PageNumber: page,
      PageSize: 100,
      Field: "PolicyId",
      Order: "ASC",
      ...(monitorType ? { MonitorTypes: [monitorType] } : {}),
    });
    const result = isCls ? response.Alarms : response.Policies;
    const policies = Array.isArray(result) ? result : [];
    items.push(...policies.map(isCls ? clsPolicySummary : policySummary).filter((policy) => policy.id));
    const total = Number(response.TotalCount || 0);
    if (!policies.length || items.length >= total) break;
    page += 1;
  }

  return items;
}

module.exports = { createAlertClient, listAlarmPolicies, normalizeClsHistory, policySummary, SOURCE_NAMES, validateMonitorType, validateRegion };
