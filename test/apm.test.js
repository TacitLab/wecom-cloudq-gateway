"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const apm = require("../src/apm");

const app = { region: "ap-guangzhou", instanceId: "apm-demo", instanceName: "生产", serviceName: "checkout", serviceId: "svc-demo" };
const dimension = (Key, Value, Operator = "eq") => ({ Key, Value, Operator });
const filter = (...groups) => ({ Type: "DIMENSION", Dimensions: JSON.stringify(groups) });
const policy = Filter => ({ PolicyId: "policy-one", MonitorType: "MT_TAW", Enable: 1, Filter,
  Condition: { IsUnionRule: 0, Rules: [{ MetricName: "duration_avg", Filter: { Type: "", Dimensions: "", Expression: "" } }] } });

test("policy scope includes explicit, multi-app and system-wide policies; excludes same names in other systems", () => {
  const system = dimension("tapm.instance.key", [app.instanceId]);
  assert.equal(apm.matchPolicy(policy(filter([system, dimension("service.name", ["checkout"])])), app), "matched");
  assert.equal(apm.matchPolicy(policy(filter([system, dimension("service.name", ["cart", "checkout"])])), app), "matched");
  assert.equal(apm.matchPolicy(policy(filter([system, dimension("span.kind", ["server"])])), app), "conditional");
  assert.equal(apm.matchPolicy({ ...policy(null), IsBindAll: 1 }, app), "matched");
  assert.equal(apm.matchPolicy(policy(filter([dimension("tapm.instance.key", ["apm-other"]), dimension("service.name", ["checkout"])])), app), "excluded");
  assert.equal(apm.matchPolicy(policy(filter([system, dimension("service.name", ["checkout"], "ne")])), app), "excluded");
  assert.equal(apm.matchPolicy(policy(filter([dimension("region", ["ap-shanghai"])])), app), "excluded");
});

test("policy matching preserves OR groups, per-rule filters and undecidable expressions", () => {
  const first = [dimension("service.name", ["other"])], second = [dimension("service.name", ["checkout"])];
  assert.equal(apm.matchPolicy(policy(filter(first, second)), app), "matched");
  assert.equal(apm.matchPolicy(policy({ Type: "EXPRESSION", Expression: "anything()" }), app), "unknown");
  assert.equal(apm.matchPolicy(policy({ Type: "DIMENSION", Dimensions: "invalid json" }), app), "unknown");
  assert.equal(apm.matchPolicy(policy(filter([dimension("service.name", [".*"], "re")])), app), "unknown");
  const p = policy(filter([]));
  p.GroupBy = [{ Id: "service.name" }];
  p.Condition.Rules = [{ Filter: filter(first) }, { Filter: filter(second) }];
  assert.equal(apm.matchPolicy(p, app), "matched");
  p.Condition.IsUnionRule = 1;
  assert.equal(apm.matchPolicy(p, app), "excluded");
  p.Condition.IsUnionRule = 2;
  assert.equal(apm.matchPolicy(p, app), "unknown");
  assert.equal(apm.matchPolicy(policy(null), app), "unknown");
});

test("real APM dimensions and decorated display values identify applications without substring matches", () => {
  const history = { Region: "ap-guangzhou", Dimensions: "null",
    InternalDimensions: JSON.stringify({ "tapm.instance.key": "apm-demo", "service.name": "checkout" }),
    AlarmObject: "业务系统=apm-demo(生产), 应用=checkout" };
  assert.equal(apm.matchHistory(history, app), "matched");
  assert.equal(apm.matchHistory({ ...history, AlarmObject: "业务系统=生产, 应用=checkout" }, app), "matched");
  assert.equal(apm.matchHistory({ ...history, Region: "ap-shanghai" }, app), "excluded");
  assert.equal(apm.matchHistory({ ...history, InternalDimensions: undefined }, app), "matched");
  assert.equal(apm.matchHistory({ InternalDimensions: '[{"Name":"tapm.instance.key","Value":"apm-demo"},{"Name":"service.name","Value":"checkout"}]' }, app), "matched");
  assert.equal(apm.matchHistory({ AlarmObject: "业务系统=apm-demo, 应用=checkout-v2" }, app), "excluded");
  assert.equal(apm.matchHistory({ AlarmObject: "checkout 错误 apm-demo" }, app), "unknown");
  assert.equal(apm.matchHistory({ AlarmObject: "业务系统=apm-demo" }, app), "unknown");
  assert.equal(apm.matchHistory({ ...history, Dimensions: '{"service.name":"another"}' }, app), "unknown");
});

test("inventory pagination fails explicitly on truncation, invalid totals and duplicate pages", async () => {
  let calls = 0;
  const rows = await apm.readPages(async (_, p) => { calls++; return { TotalCount: 101,
    Rows: Array.from({ length: p.PageNumber === 1 ? 100 : 1 }, (_, i) => ({ id: `${p.PageNumber}-${i}` })) }; }, "Read", {}, "Rows", "PageNumber", r => r.id);
  assert.equal(rows.length, 101); assert.equal(calls, 2);
  const duplicates = await apm.readPages(async (_, p) => ({ TotalCount: 2, Rows: [{ id: "same", time: p.PageNumber }] }), "Read", {}, "Rows", "PageNumber", r => r.id);
  assert.equal(duplicates.length, 1); assert.equal(duplicates[0].time, 1);
  const statuses = await apm.readPages(async (_, p) => ({ TotalCount: 2, Rows: [{ id: "same", LastOccurTime: p.PageNumber, AlarmStatus: p.PageNumber === 1 ? "ALARM" : "OK" }] }), "Read", {}, "Rows", "PageNumber", r => r.id);
  assert.equal(statuses[0].AlarmStatus, "OK");
  for (const response of [{ Rows: [], TotalCount: 1 }, { Rows: [], TotalCount: undefined }, { Rows: [{ id: "same" }], TotalCount: 2 }]) {
    await assert.rejects(apm.readPages(async () => response, "Read", {}, "Rows", "PageNumber", r => r.id), /不完整|未读取完整/);
  }
});

test("APM inventories expose only selector fields and validate ownership", async () => {
  const items = await apm.listInstances({}, { request: async (_, p) => {
    assert.equal(p.AllRegionsFlag, 1);
    return { TotalCount: 1, Instances: [{ InstanceId: app.instanceId, Region: app.region, Name: app.instanceName, Token: "private-ingestion-token" }] };
  } });
  assert.doesNotMatch(JSON.stringify(items), /private-ingestion-token|Token/);
  const request = async action => action === "DescribeApmInstances"
    ? { TotalCount: 1, Instances: [{ Region: app.region, InstanceId: app.instanceId, Name: app.instanceName }] }
    : { Values: [app.serviceName] };
  assert.equal((await apm.listApplications({}, app.region, app.instanceId, { request }))[0].serviceName, app.serviceName);
  await assert.rejects(apm.listApplications({}, app.region, "apm-foreign", { request }), /不匹配/);
  assert.throws(() => apm.normalizeApplications([{ ...app, region: "invalid" }]), /region/);
  assert.throws(() => apm.normalizeApplications([{ ...app, serviceName: "\n" }]), /Invalid/);
  assert.equal(apm.normalizeApplications([app, app]).length, 1);
});

test("strategy discovery includes disabled and undecidable policies and keeps full conditions", async () => {
  const result = await apm.discoverPolicies({}, [app], { clientFor: () => ({ describeAlarmPolicies: async p => {
    assert.deepEqual(p.MonitorTypes, ["MT_TAW"]); assert.deepEqual(p.Enable, [0, 1]); assert.equal(p.NotBindAll, 0);
    return { TotalCount: 3, Policies: [{ ...policy(filter([])), Enable: 0 }, { ...policy({ Type: "EXPRESSION" }), PolicyId: "unknown" },
      { ...policy(filter([dimension("service.name", ["other"])])), PolicyId: "excluded" }] };
  } }) });
  assert.equal(result.items[0].policies.length, 2); assert.equal(result.complete, false);
  assert.equal(result.items[0].policies[0].enabled, false); assert.ok(result.items[0].policies[0].condition.Rules.length);
});
