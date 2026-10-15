"use strict";

const { TencentMonitorClient } = require("./monitor-client");

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
  const client = options.client || new TencentMonitorClient({ ...credential, region: selectedRegion });
  const items = [];
  let page = 1;

  while (true) {
    const response = await client.describeAlarmPolicies({
      Module: "monitor",
      PageNumber: page,
      PageSize: 100,
      Field: "PolicyId",
      Order: "ASC",
    });
    const policies = Array.isArray(response.Policies) ? response.Policies : [];
    items.push(...policies.map(policySummary).filter((policy) => policy.id));
    const total = Number(response.TotalCount || 0);
    if (!policies.length || items.length >= total) break;
    page += 1;
  }

  return items;
}

module.exports = { listAlarmPolicies, policySummary, validateRegion };
