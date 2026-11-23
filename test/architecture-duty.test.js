"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { Readable } = require("node:stream");
process.env.ADMIN_PASSWORD = "test-password";
process.env.SQLITE_PATH = ":memory:";
const { db, closeDatabase } = require("../src/database");
const registry = require("../src/registry");
const watches = require("../src/architecture-watch");
const { inventory } = require("../src/architecture-detail");
const duty = require("../src/architecture-duty-store");
const poller = require("../src/architecture-duty");
const worker = require("../src/architecture-duty-worker");
const capacity = require("../src/architecture-capacity");
const gateway = require("../src/gateway");
const { createServer } = require("../server");
const { normalizeGatewayCommand } = require("../src/conversation");
const apm = require("../src/apm");

test.beforeEach(() => db().exec(`DELETE FROM architecture_watches; DELETE FROM alert_jobs; DELETE FROM alert_integrations;
  DELETE FROM wecom_bots; DELETE FROM wma_agents; DELETE FROM wma_credentials; DELETE FROM tencent_credentials;`));
test.after(closeDatabase);

const apmApp = { region: "ap-guangzhou", instanceId: "apm-test", instanceName: "生产业务", serviceName: "checkout" };
function apmClient(histories = []) {
  return {
    async describeAlarmPolicies() { return { TotalCount: 1, Policies: [{ PolicyId: "shared-policy", PolicyName: "全应用错误率",
      MonitorType: "MT_TAW", Enable: 1, Filter: { Type: "BIND_ALL" }, Condition: { Rules: [{ MetricName: "error_req_rate" }] } }] }; },
    async describeAlarmHistories(params) { assert.deepEqual(params.MonitorTypes, ["MT_TAW"]); return { Histories: histories, TotalCount: histories.length }; },
  };
}

test("APM-only watches discover policies, isolate shared-policy events, deduplicate and observe recovery", async t => {
  const f = fixture(t, { products: {}, apmApplications: [apmApp], rcaEnabled: true }), now = Date.now();
  const alarm = { AlarmId: "app-alarm", MonitorType: "MT_TAW", PolicyId: "shared-policy", AlarmStatus: "ALARM", FirstOccurTime: Math.floor(now / 1000) - 2 * 86400,
    InternalDimensions: JSON.stringify({ "tapm.instance.key": apmApp.instanceId, "service.name": apmApp.serviceName }),
    AlarmObject: "业务系统=apm-test(生产业务), 应用=checkout" };
  const client = apmClient([alarm, { ...alarm, AlarmId: "foreign", InternalDimensions: undefined, AlarmObject: "业务系统=apm-test, 应用=other" },
    { ...alarm, AlarmId: "aggregate", InternalDimensions: undefined, AlarmObject: "业务系统=apm-test" }]);
  const options = { now, getDetail: async () => f.detail, clientFor: () => sampleClient(), apmClientFor: () => client };
  const first = await poller.checkNow(f.id, options);
  assert.equal(first.events, 1); assert.equal(first.apm.totalCount, 1); assert.equal(first.apm.unresolvedCount, 1);
  assert.equal(first.apm.applications[0].policies.length, 1); assert.equal(first.apm.complete, false);
  assert.equal((await poller.checkNow(f.id, options)).events, 0);
  const event = duty.history(f.id).items[0]; assert.equal(event.product, "APM"); assert.equal(event.rcaEnabled, true);
  let notice = "";
  await worker.deliverNotifications({ sendMessage: async (_, __, text) => { notice = text; } });
  assert.match(notice, /APM 应用.*checkout/); assert.match(notice, /生产业务/);
  let prompt = "";
  await worker.processAnalyses({ adapter: { createConversation: async () => "apm-session", sendMessage: async (_, input, delta) => { prompt = input; delta("应用错误率异常"); return { stopReason: "end_turn" }; } }, sendMessage: async () => ({}) });
  assert.match(prompt, /apm-test/); assert.match(prompt, /checkout/); assert.match(prompt, /arch-duty/);
  const recovered = await poller.checkNow(f.id, { ...options, now: now + 60000,
    apmClientFor: () => apmClient([{ ...alarm, AlarmStatus: "OK", LastOccurTime: alarm.FirstOccurTime }]) });
  assert.equal(recovered.events, 1);
  const recovery = duty.history(f.id).items.find(e => e.type === "recovery");
  assert.equal(recovery.payload.observedRecovery, true); assert.equal(recovery.rcaEnabled, false);
});

test("APM checking survives Advisor and policy lookup failures without claiming full coverage", async t => {
  const f = fixture(t, { products: {}, apmApplications: [apmApp] });
  const client = apmClient(); client.describeAlarmPolicies = async () => { throw new Error("permission denied"); };
  const result = await poller.checkNow(f.id, { getDetail: async () => { throw new Error("Advisor unavailable"); }, apmClientFor: () => client });
  assert.equal(result.apm.complete, false); assert.equal(result.apm.applications[0].status, "partial");
  assert.ok(result.errors.some(e => e.includes("permission denied")));
  assert.ok(result.errors.some(e => e.includes("Advisor unavailable")));
});

test("APM-only scopes survive quick switches and old clients; invalid scopes cannot be saved", t => {
  const f = fixture(t, { products: {}, apmApplications: [apmApp] });
  assert.deepEqual(duty.setEnabled(f.id, false).apmApplications[0].serviceName, "checkout");
  assert.equal(duty.setEnabled(f.id, true, f.detail).enabled, true);
  const oldInput = { ...f.settings }; delete oldInput.apmApplications;
  assert.equal(duty.saveSettings(f.id, oldInput, f.detail).apmApplications.length, 1);
  assert.throws(() => duty.saveSettings(f.id, { ...f.settings, apmApplications: [{ ...apmApp, instanceId: "invalid" }] }, f.detail), /Invalid APM/);
  assert.throws(() => duty.saveSettings(f.id, { ...f.settings, apmApplications: [] }, f.detail), /至少一个产品或 APM/);
});

test("APM admin selectors use the watch credential, verify selections and preserve saved names", async t => {
  const f = fixture(t), credentialCalls = [];
  t.mock.method(apm, "listInstances", async credential => { credentialCalls.push(credential.secretId); return [{ region: apmApp.region, instanceId: apmApp.instanceId, instanceName: apmApp.instanceName }]; });
  t.mock.method(apm, "listApplications", async credential => { credentialCalls.push(credential.secretId); return [apmApp]; });
  t.mock.method(apm, "discoverPolicies", async (_, apps) => ({ items: apps, complete: true }));
  t.mock.method(require("../src/architecture-detail"), "getDetail", async () => f.detail);
  const { server } = createServer({ config: { adminUsername: "admin", adminPassword: "test-password", bodyLimitBytes: 1048576 }, botManager: { statuses: () => ({}) } });
  const request = (method, url, body, auth = true) => new Promise(resolve => {
    const req = Readable.from(body ? [Buffer.from(JSON.stringify(body))] : []);
    Object.assign(req, { method, url, headers: { host: "gateway.test", ...(auth ? { authorization: `Basic ${Buffer.from("admin:test-password").toString("base64")}` } : {}) } });
    let status; server.emit("request", req, { writeHead(s) { status = s; }, end(v) { resolve({ status, body: JSON.parse(v) }); } });
  });
  const base = `/api/admin/architecture-watches/${f.id}`;
  assert.equal((await request("GET", `${base}/apm-instances`, undefined, false)).status, 401);
  assert.equal((await request("GET", `${base}/apm-instances`)).body.items.length, 1);
  assert.equal((await request("GET", `${base}/apm-applications?region=ap-guangzhou&instanceId=apm-test`)).body.items[0].serviceName, "checkout");
  assert.equal((await request("POST", `${base}/apm-policies`, { applications: [apmApp] })).body.complete, true);
  const saved = await request("PUT", `${base}/settings`, { ...f.settings, apmApplications: [{ ...apmApp, instanceName: "browser-forged" }] });
  assert.equal(saved.status, 200); assert.equal(saved.body.apmApplications[0].instanceName, apmApp.instanceName);
  assert.ok(credentialCalls.every(id => id === "AKID_DUTY_CLOUD"));
  const rejected = await request("PUT", `${base}/settings`, { ...f.settings, apmApplications: [{ ...apmApp, serviceName: "foreign" }] });
  assert.equal(rejected.status, 400); assert.equal(duty.getSettings(f.id).apmApplications[0].serviceName, "checkout");
});

function fixture(t, config = {}) {
  t.mock.method(worker, "schedule", () => Promise.resolve());
  const credential = registry.saveTencentCredential({ name: "Cloud", secretId: "AKID_DUTY_CLOUD", secretKey: "cloud-secret-test" });
  const key = registry.saveWmaCredential({ name: "WMA", secretId: "AKID_CONTROL", secretKey: "wma-secret-test" });
  const agent = registry.saveAgent({ name: "SRE", credentialConfigId: key.id, agentId: "agent-duty" });
  const bot = registry.saveBot({ name: "Duty Bot", botId: "bot-duty", secret: "bot-secret-test", agentConfigId: agent.id });
  db().prepare("INSERT INTO architecture_watches(id,credential_id,arch_id,arch_name,created_at) VALUES(?,?,?,?,?)").run("watch-duty", credential.id, "arch-duty", "生产架构", Date.now());
  const detail = { products: [{ id: "tencent:CVM", product: "CVM", capacitySupported: true }, { id: "tencent:TKE", product: "TKE", capacitySupported: true }], resources: [
    { id: "ins-watched", name: "核心服务", productKey: "tencent:CVM", product: "CVM", cloudProvider: "tencent", region: "ap-guangzhou", status: "运行中" },
    { id: "ins-excluded", name: "范围外", productKey: "tencent:CVM", product: "CVM", cloudProvider: "tencent", region: "ap-guangzhou", status: "运行中" },
  ] };
  const settings = duty.saveSettings("watch-duty", { ...structuredClone(duty.DEFAULTS), enabled: true, botConfigId: bot.id,
    products: { "tencent:CVM": { enabled: true, alarms: true, metrics: true, resourceIds: ["ins-watched"] } }, ...config }, detail);
  duty.bindChat(settings.bindCode, bot.id, "group-duty");
  db().prepare("UPDATE architecture_watch_settings SET updated_at=? WHERE watch_id=?").run(Date.now() - 3600000, "watch-duty");
  return { credential, agent, bot, detail, settings: duty.getSettings("watch-duty"), id: "watch-duty" };
}

function sampleClient(histories = []) {
  return {
    async describeAlarmHistories() { return { Histories: histories, TotalCount: histories.length }; },
    async request() { assert.fail("Retired raw GetMonitorData must never be called"); },
  };
}
function sampleCapacity(now, level = 3, stale = false) {
  return { warnings: stale ? ["容量结果超过 24 小时未更新"] : [], errors: [], resources: [{ resourceId: "ins-watched", resourceName: "核心服务",
    productKey: "tencent:CVM", product: "CVM", region: "ap-guangzhou", nodeNames: ["服务"], riskLevel: level, periodDays: 14,
    updatedAt: now - 60000, taskId: "monitor-test", stale, supported: true,
    metrics: [{ name: "CPU利用率", riskLevel: level, value: level === 3 ? 91 : 20 }] }] };
}

test("inventory deduplicates resources and retains source node bindings without drawing topology", () => {
  const node = { NodeId: 1, DiagramId: "a", NodeName: "服务", ProductType: "CVM", NodeRegion: "ap-guangzhou", BindingType: "instance", ResourceList: [{ InstanceId: "ins-one" }] };
  const arch = { NodeList: [node, { ...node, NodeId: 2, DiagramId: "b", NodeName: "服务副本" }, { NodeId: 3, ProductType: "LINE", Conditions: [{ Key: "StartKey", Value: "a" }, { Key: "EndKey", Value: "b" }] }],
    Detail: JSON.stringify({ a: { position: { x: 10, y: 20 } } }) };
  const resolved = { ArchNodeList: [1, 2].map(NodeId => ({ NodeId, ProductType: "CVM", ResourceList: [{ ResourceId: "ins-one", ResourceName: "生产主机", Status: "运行中", Extensions: [] }] })) };
  const result = inventory(arch, resolved);
  assert.equal(result.products.length, 1); assert.equal(result.resources.length, 1); assert.equal(result.regions[0].resourceCount, 1);
  assert.deepEqual(result.resources[0].nodeNames, ["服务", "服务副本"]);
  assert.deepEqual(result.resources[0].nodeIds, ["a", "b"]); assert.equal(result.diagram, undefined);
});

test("schedule supports exact minute boundaries, selected weekdays and overnight windows", () => {
  const schedule = { allDay: false, start: "22:00", end: "02:00", days: [1] };
  assert.ok(duty.scheduleWindow(schedule, Date.parse("2026-11-23T22:00:00+08:00")));
  assert.ok(duty.scheduleWindow(schedule, Date.parse("2026-11-24T01:59:00+08:00")));
  assert.equal(duty.scheduleWindow(schedule, Date.parse("2026-11-24T02:00:00+08:00")), null);
  assert.equal(duty.scheduleWindow(schedule, Date.parse("2026-11-24T23:00:00+08:00")), null);
  assert.equal(duty.scheduleWindow({ ...schedule, allDay: true }, Date.parse("2026-11-24T10:00:00+08:00")), null);
});

test("settings preserve resource scopes while retiring local thresholds", t => {
  const f = fixture(t), saved = { ...f.settings, cpuThreshold: 73, consecutiveSamples: 5,
    products: { "tencent:CVM": { ...f.settings.products["tencent:CVM"], cpuThreshold: 92 } } };
  const result = duty.saveSettings(f.id, saved, f.detail);
  assert.equal(result.products["tencent:CVM"].cpuThreshold, undefined); assert.equal(result.cpuThreshold, undefined);
  assert.equal(result.targetChatId, "group-duty");
  assert.throws(() => duty.saveSettings(f.id, { ...saved, pollIntervalSeconds: 1 }, f.detail), /Invalid/);
  assert.throws(() => duty.saveSettings(f.id, { ...saved, products: { "unknown": { enabled: true, metrics: true } } }, f.detail), /Invalid/);
  assert.throws(() => duty.saveSettings(f.id, { ...saved, products: { "tencent:CVM": { resourceIds: ["ins-foreign"] } } }, f.detail), /指定资源范围/);
  assert.throws(() => registry.deleteBot(f.bot.id), /still used/);
  const other = registry.saveBot({ name: "Other", botId: "bot-other", secret: "secret", agentConfigId: f.agent.id });
  const changed = duty.saveSettings(f.id, { ...saved, botConfigId: other.id }, f.detail);
  assert.equal(changed.targetChatId, ""); assert.notEqual(changed.bindCode, result.bindCode);
  assert.throws(() => duty.bindChat(changed.bindCode, f.bot.id, "wrong-group"), /不匹配/);
});

test("scoped alarms and Advisor high-load judgements produce events without local metric sampling", async t => {
  const f = fixture(t), now = Date.now();
  const histories = [
    { AlarmId: "alarm-match", AlarmStatus: "ALARM", AlarmObject: "ins-watched", FirstOccurTime: Math.floor(now / 1000) - 20 },
    { AlarmId: "alarm-unrelated", AlarmStatus: "ALARM", AlarmObject: "ins-excluded", FirstOccurTime: Math.floor(now / 1000) - 20 },
  ];
  const client = sampleClient(histories);
  let snapshot = sampleCapacity(now);
  const options = { now, getDetail: async () => f.detail, clientFor: () => client, getCapacity: async () => snapshot };
  const first = await poller.checkNow(f.id, options);
  assert.equal(first.events, 2); assert.equal(first.resources, 1); assert.equal(first.capacityResources, 1);
  assert.equal((await poller.checkNow(f.id, options)).events, 0);
  await worker.deliverNotifications({ sendMessage: async () => ({}) });
  snapshot = sampleCapacity(now + 60000, 0);
  assert.equal((await poller.checkNow(f.id, { ...options, now: now + 60000 })).events, 1);
  snapshot = sampleCapacity(now + 240000);
  assert.equal((await poller.checkNow(f.id, { ...options, now: now + 240000 })).events, 1);
  assert.deepEqual(duty.history(f.id).items.map(e => e.type).sort(), ["alarm", "high_load", "high_load", "recovery"]);
});

test("stale and medium-load Advisor results never produce high-load events", async t => {
  const f = fixture(t), now = Date.now();
  let snapshot = sampleCapacity(now, 3, true);
  const options = { now, getDetail: async () => f.detail, clientFor: () => sampleClient(), getCapacity: async () => snapshot };
  const stale = await poller.checkNow(f.id, options);
  assert.equal(stale.events, 0); assert.equal(stale.capacityResources, 0); assert.ok(stale.warnings.length);
  snapshot = sampleCapacity(now, 2);
  assert.equal((await poller.checkNow(f.id, options)).events, 0);
  assert.match(duty.history(f.id).checks.find(c => c.warnings.length).error, /24 小时/);
});

test("capacity2 HAR refreshes cloud metrics using the existing period before reading the exact new task", async t => {
  const f = fixture(t), now = Date.now(), calls = [];
  f.detail.resources[0].nodeIds = ["node-one"];
  const snapshot = await capacity.getCapacity(f.id, { detail: f.detail, resources: [f.detail.resources[0]], now,
    request: async (action, params) => {
      calls.push({ action, params });
      if (action === "DescribeArchThresholdConfigStatusV2") return { AnalysisDay: 7 };
      if (action === "UpdateNodeResourceCapacityMetricV2") return { MapId: "arch-duty", CapacityAsyncId: "task" };
      if (action === "DescribeNodeLoadInfoV2New") return { IsFinish: true, FinishTime: new Date(now).toISOString(),
        NodeLoadRiskInfos: [{ NodeId: "node-one", NodeName: "登录鉴权", Product: "cvm", IsFinish: true, TaskId: "task", LastSuccessTaskId: "task", MediumLoadCount: 1, HighLoadCount: 0 }] };
      return { LatestUpdateTime: new Date(now).toISOString(), ResourceCount: 1, ResourceLoadRiskInfos: [{ InsId: "ins-watched", Region: "ap-guangzhou", Period: 7, RiskLevel: 2,
        MetricValueList: [{ Metric: "内存利用率", MetricRiskLevel: 2, Value: 61.89 }, { Metric: "CPU利用率", MetricRiskLevel: 0, Value: 15.34 }], RiskDurationList: [] }] };
    } });
  const session = calls[1].params.SessionId;
  assert.ok(session);
  assert.deepEqual(calls, [
    { action: "DescribeArchThresholdConfigStatusV2", params: { MapId: "arch-duty" } },
    { action: "UpdateNodeResourceCapacityMetricV2", params: { MapId: "arch-duty", SessionId: session, Source: 1, Period: 7 } },
    { action: "DescribeNodeLoadInfoV2New", params: { MapId: "arch-duty", SessionId: session, TaskId: "task", Mode: "monitor" } },
    { action: "DescribeNodeResourceLoadInfoV2New", params: { MapId: "arch-duty", NodeUuid: "node-one", TaskId: "task" } },
  ]);
  assert.equal(snapshot.resources[0].riskLevel, 2); assert.equal(snapshot.resources[0].metrics[0].value, 61.89);
  assert.equal(capacity.processSnapshot(f.id, f.settings, snapshot, now).events, 0);
});

test("unfinished capacity tasks do not reuse previous success data as current results", async t => {
  const f = fixture(t);
  f.detail.resources[0].nodeIds = ["node-one"];
  const snapshot = await capacity.getCapacity(f.id, { detail: f.detail, resources: [f.detail.resources[0]], pollAttempts: 1, request: async action => {
    if (action === "DescribeArchThresholdConfigStatusV2") return { AnalysisDay: 14 };
    if (action === "UpdateNodeResourceCapacityMetricV2") return { MapId: "arch-duty", CapacityAsyncId: "new-task" };
    assert.equal(action, "DescribeNodeLoadInfoV2New");
    return { IsFinish: false, NodeLoadRiskInfos: [{ NodeId: "node-one", NodeName: "节点", LastSuccessTaskId: "old-task", TaskId: "new-task" }] };
  } });
  assert.equal(snapshot.resources.length, 0); assert.ok(snapshot.warnings.some(w => w.includes("尚未完成")));
});

test("capacity reminders follow cumulative milestones and then repeat weekly without backlog bursts", t => {
  const f = fixture(t), base = Date.now(), hour = 3600000;
  const observe = offset => capacity.processSnapshot(f.id, duty.getSettings(f.id), sampleCapacity(base + offset), base + offset).events;
  const delivered = offset => db().prepare("UPDATE architecture_watch_events SET notified_at=?,completed_at=?,analysis_status='skipped' WHERE notified_at IS NULL").run(base + offset, base + offset);
  assert.equal(observe(0), 1); delivered(0);
  for (const offset of [hour, 6 * hour, 24 * hour, 72 * hour, 168 * hour, 336 * hour, 504 * hour]) {
    assert.equal(observe(offset - 1000), 0);
    assert.equal(observe(offset), 1); delivered(offset);
    assert.equal(observe(offset + 1000), 0);
  }
  assert.equal(duty.history(f.id).totalCount, 8);
  assert.equal(observe(1000 * hour), 1); // a long pause creates only one current reminder
  assert.equal(capacity.reminderStage(1000 * hour), 9);
});

test("saving settings and reloading the capacity module preserve reminder progress", t => {
  const f = fixture(t), now = Date.now();
  capacity.processSnapshot(f.id, f.settings, sampleCapacity(now), now);
  db().prepare("UPDATE architecture_watch_events SET notified_at=?,completed_at=?").run(now, now);
  const updated = duty.saveSettings(f.id, { ...f.settings, pollIntervalSeconds: 120 }, f.detail);
  delete require.cache[require.resolve("../src/architecture-capacity")];
  const reloaded = require("../src/architecture-capacity");
  assert.equal(reloaded.processSnapshot(f.id, updated, sampleCapacity(now + 60000), now + 60000).events, 0);
  assert.equal(reloaded.processSnapshot(f.id, updated, sampleCapacity(now + 3600000), now + 3600000).events, 1);
});

test("failed initial delivery backs off, then the next capacity milestone can remind again", t => {
  const f = fixture(t), now = Date.now(), later = now + 6 * 3600000;
  assert.equal(capacity.processSnapshot(f.id, f.settings, sampleCapacity(now), now).events, 1);
  assert.equal(capacity.processSnapshot(f.id, f.settings, sampleCapacity(later), later).events, 0);
  db().prepare("UPDATE architecture_watch_events SET attempts=5").run();
  assert.equal(capacity.processSnapshot(f.id, f.settings, sampleCapacity(later), later).events, 1);
  assert.equal(duty.history(f.id).items.find(e => e.payload.reminderStage === 2)?.type, "high_load");
});

test("stale or out-of-order reports do not consume reminder stages or falsely recover", t => {
  const f = fixture(t), now = Date.now();
  capacity.processSnapshot(f.id, f.settings, sampleCapacity(now), now);
  db().prepare("UPDATE architecture_watch_events SET notified_at=?,completed_at=?").run(now, now);
  assert.equal(capacity.processSnapshot(f.id, f.settings, sampleCapacity(now + 6 * 3600000, 0, true), now + 6 * 3600000).events, 0);
  const older = sampleCapacity(now - 3600000, 0);
  assert.equal(capacity.processSnapshot(f.id, f.settings, older, now + 3600000).events, 0);
  const signal = db().prepare("SELECT * FROM architecture_capacity_signals").get();
  assert.equal(signal.active, 1); assert.equal(signal.reminder_stage, 0);
});

test("recovery resets the episode, and a rapid recurrence cancels obsolete recovery notices", async t => {
  const f = fixture(t), now = Date.now();
  capacity.processSnapshot(f.id, f.settings, sampleCapacity(now), now);
  await worker.deliverNotifications({ sendMessage: async () => ({}) });
  assert.equal(capacity.processSnapshot(f.id, f.settings, sampleCapacity(now + 60000, 2), now + 60000).events, 1);
  const oldEpisode = db().prepare("SELECT episode_id FROM architecture_capacity_signals").get().episode_id;
  assert.equal(capacity.processSnapshot(f.id, f.settings, sampleCapacity(now + 120000), now + 120000).events, 1);
  assert.notEqual(db().prepare("SELECT episode_id FROM architecture_capacity_signals").get().episode_id, oldEpisode);
  const sent = [];
  await worker.deliverNotifications({ sendMessage: async (_bot, _group, text) => sent.push(text) });
  assert.equal(sent.length, 1); assert.match(sent[0], /高负载/);
  assert.equal(duty.history(f.id).items.find(e => e.type === "recovery").analysisStatus, "cancelled");
});

test("pending events from the retired local threshold detector are cancelled instead of pushed", async t => {
  const f = fixture(t);
  duty.enqueue(f.id, f.settings, { key: "legacy-local", type: "high_load", title: "旧 CPU 超限", resourceId: "ins-watched", product: "CVM", region: "ap-guangzhou",
    payload: { namespace: "QCE/CVM", metric: "CPUUsage", threshold: 80, samples: [] } });
  await worker.deliverNotifications({ sendMessage: async () => assert.fail("retired detections must not be delivered") });
  assert.equal(duty.history(f.id).items[0].analysisStatus, "cancelled");
});

test("disabled and out-of-window watches do not access cloud APIs", async t => {
  const f = fixture(t);
  duty.saveSettings(f.id, { ...f.settings, enabled: false }, f.detail);
  assert.equal((await poller.checkNow(f.id, { getDetail: () => assert.fail("should not read cloud") })).skipped, true);
  duty.saveSettings(f.id, { ...f.settings, schedule: { allDay: false, start: "01:00", end: "02:00", days: [1] } }, f.detail);
  assert.equal((await poller.checkNow(f.id, { now: Date.parse("2026-11-24T10:00:00+08:00"), getDetail: () => assert.fail() })).skipped, true);
});

test("first notice is delivered before RCA, and delivery retries reuse completed analysis", async t => {
  const f = fixture(t, { rcaEnabled: true }), order = [];
  duty.enqueue(f.id, f.settings, { key: "event", type: "alarm", title: "异常", resourceId: "ins-watched", product: "CVM", region: "ap-guangzhou", payload: {} });
  const adapter = { async createConversation() { order.push("analyze"); return {}; }, async sendMessage(_session, prompt, delta) {
    assert.match(prompt, /当前分析基于腾讯云智能顾问架构图「生产架构」/);
    assert.match(prompt, /架构图 ID：arch-duty/);
    assert.match(prompt, /在分析结果开头明确声明架构图名称和 ID/);
    assert.match(prompt, /advisor\?archId=arch-duty/);
    delta("结论：测试高负载"); return { stopReason: "end_turn" }; } };
  await worker.processAnalyses({ adapter, sendMessage: async () => assert.fail("notice must precede analysis") });
  assert.equal(order.length, 0);
  await worker.deliverNotifications({ sendMessage: async (_bot, group, text) => { assert.equal(group, "group-duty"); assert.match(text, /^### 生产架构 · 🔔 架构值守事件\n/); assert.match(text, /架构图：\*\* 生产架构/); assert.match(text, /架构图 ID：\*\* arch-duty/); order.push("notice"); } });
  await worker.processAnalyses({ adapter, sendMessage: async () => { order.push("result-failed"); throw new Error("network unavailable"); } });
  assert.deepEqual(order, ["notice", "analyze", "result-failed"]);
  const row = db().prepare("SELECT * FROM architecture_watch_events").get();
  assert.equal(row.analysis_status, "ready"); assert.equal(row.completed_at, null);
  db().prepare("UPDATE architecture_watch_events SET next_attempt_at=0").run();
  await worker.processAnalyses({ adapter: { createConversation() { assert.fail("must not reanalyze") } }, sendMessage: async (_bot, _group, text) => { assert.match(text, /^### 生产架构 · RCA 分析\n/); assert.match(text, /架构图：\*\* 生产架构/); assert.match(text, /架构图 ID：\*\* arch-duty/); assert.match(text, /advisor\?archId=arch-duty/); order.push("result"); } });
  assert.equal(duty.history(f.id).items[0].analysisStatus, "completed");
  assert.equal(duty.history(f.id).items[0].analysis, "结论：测试高负载");
});

test("failed notices retry durably; disabling or rebinding cancels unsent events", async t => {
  const f = fixture(t);
  const event = { key: "event", type: "alarm", title: "异常", resourceId: "ins-watched", product: "CVM", region: "ap-guangzhou", payload: {} };
  duty.enqueue(f.id, f.settings, event);
  await worker.deliverNotifications({ sendMessage: async () => { throw new Error("offline"); } });
  const failed = duty.history(f.id).items[0]; assert.equal(failed.notifiedAt, null); assert.equal(failed.attempts, 1);
  db().prepare("UPDATE architecture_watch_events SET next_attempt_at=0").run();
  duty.unbind(f.id);
  await worker.deliverNotifications({ sendMessage: async () => assert.fail("must not send after unbinding") });
  assert.equal(duty.history(f.id).items[0].analysisStatus, "cancelled");
});

test("group binding command supports mentions, enforces Bot scope and never queues Agent chat", async t => {
  const f = fixture(t), replies = [];
  assert.equal(normalizeGatewayCommand(`@运维 助手 /bind-watch ${f.settings.bindCode}`, "group", "other"), `/bind-watch ${f.settings.bindCode}`);
  const client = { async replyStream(...args) { replies.push(args[2]); } };
  await gateway.handleMessage(f.bot.id, client, { body: { msgtype: "text", chattype: "group", chatid: "group-duty", text: { content: `/bind-watch ${f.settings.bindCode}` } } });
  assert.match(replies[0], /架构值守推送群/);
  assert.equal(db().prepare("SELECT COUNT(*) AS count FROM wma_tasks").get().count, 0);
  assert.throws(() => duty.bindChat(f.settings.bindCode, f.bot.id, "another-group"), /已绑定其他群/);
});

test("details, settings and history admin endpoints stay authenticated and use verified cloud resources", async t => {
  const f = fixture(t);
  const arch = { ArchId: "arch-duty", ArchName: "生产架构", NodeList: [{ NodeId: 1, DiagramId: "node", NodeName: "CVM", ProductType: "CVM", BindingType: "instance", NodeRegion: "ap-guangzhou" }] };
  const svg = '<svg xmlns="http://www.w3.org/2000/svg"><text>原始架构图</text></svg>';
  const svgRequests = [];
  t.mock.method(globalThis, "fetch", async (_url, options) => {
    const action = options.headers["X-TC-Action"], params = JSON.parse(options.body);
    if (action === "DescribeAlarmHistories") return Response.json({ Response: { Histories: [], TotalCount: 0 } });
    if (action === "DescribeArchThresholdConfigStatusV2") return Response.json({ Response: { AnalysisDay: 7 } });
    if (action === "UpdateNodeResourceCapacityMetricV2") return Response.json({ Response: { MapId: arch.ArchId, CapacityAsyncId: "task-current" } });
    if (action === "DescribeNodeLoadInfoV2New") return Response.json({ Response: { IsFinish: true, NodeLoadRiskInfos: [] } });
    if (action === "DescribeArchSvgData") {
      svgRequests.push(params);
      return Response.json({ Response: { ArchId: arch.ArchId, Svg: params.IsThreeDimension ? svg : svg.replace('原始架构图', '2D 原图') } });
    }
    return Response.json({ Response: action === "DescribeArch" ? { Arch: arch }
      : { ArchId: arch.ArchId, ArchNodeList: [{ NodeId: 1, ProductType: "CVM", ResourceList: [{ ResourceId: "ins-watched", ResourceName: "主机" }] }] } });
  });
  const { server } = createServer({ config: { adminUsername: "admin", adminPassword: "test-password", bodyLimitBytes: 1048576 }, botManager: { statuses: () => ({}) } });
  function request(method, url, body, auth = true) { return new Promise(resolve => {
    const req = Readable.from(body ? [Buffer.from(JSON.stringify(body))] : []);
    Object.assign(req, { method, url, headers: { host: "gateway.test", ...(auth ? { authorization: `Basic ${Buffer.from("admin:test-password").toString("base64")}` } : {}) } });
    let status; server.emit("request", req, { writeHead(s) { status = s; }, end(v) { resolve({ status, body: JSON.parse(v) }); } });
  }); }
  const base = `/api/admin/architecture-watches/${f.id}`;
  assert.equal((await request("GET", base, undefined, false)).status, 401);
  const detail = await request("GET", base);
  assert.equal(detail.status, 200); assert.equal(detail.body.resources[0].id, "ins-watched");
  assert.equal((await request("GET", `${base}/nodes/node`, undefined, false)).status, 401);
  const inspected = await request("GET", `${base}/nodes/node`);
  assert.equal(inspected.status, 200); assert.equal(inspected.body.resources.length, 1);
  assert.equal(inspected.body.resources[0].alarms.complete, true);
  assert.equal((await request("GET", `${base}/nodes/foreign`)).status, 404);
  assert.equal((await request("PUT", `${base}/enabled`, { enabled: false }, false)).status, 401);
  assert.equal((await request("PUT", `${base}/enabled`, { enabled: "false" })).status, 400);
  assert.equal((await request("PUT", `${base}/enabled`, { enabled: false })).body.enabled, false);
  assert.equal((await request("PUT", `${base}/enabled`, { enabled: true })).body.enabled, true);
  assert.equal((await request("GET", `${base}/diagram`, undefined, false)).status, 401);
  const original = await request("GET", `${base}/diagram`);
  assert.equal(original.status, 200); assert.equal(original.body.svg, svg); assert.equal(original.body.view, "3d");
  const flat = await request("GET", `${base}/diagram?view=2d`);
  assert.equal(flat.body.view, "2d"); assert.match(flat.body.svg, /2D 原图/);
  assert.equal((await request("GET", `${base}/diagram?view=unsupported`)).status, 400);
  assert.deepEqual(svgRequests, [{ ArchId: "arch-duty", IsThreeDimension: true }, { ArchId: "arch-duty", IsThreeDimension: false }]);
  assert.equal((await request("PUT", `${base}/settings`, { ...f.settings, enabled: false })).body.enabled, true);
  assert.equal((await request("PUT", `${base}/enabled`, { enabled: false })).body.enabled, false);
  assert.equal((await request("PUT", `${base}/settings`, { ...f.settings, enabled: true })).body.enabled, false);
  assert.equal((await request("GET", `${base}/history`)).body.totalCount, 0);
  assert.doesNotMatch(JSON.stringify(detail), /AKID_DUTY_CLOUD|cloud-secret-test|wma-secret-test|bot-secret-test/);
  assert.equal(watches.getWatch(f.id).dutyEnabled, false);
});

test("native diagram nodes include container descendants and exclude lines without duplicating resources", () => {
  const result = inventory({ NodeList: [
    { NodeId: 1, DiagramId: "zone", NodeName: "广州六区", ProductType: "ZONE" },
    { NodeId: 2, DiagramId: "server", ParentDiagramId: "zone", NodeName: "服务", ProductType: "CVM", BindingType: "instance", NodeRegion: "ap-guangzhou" },
    { NodeId: 3, DiagramId: "line", ProductType: "LINE" },
  ] }, { ArchNodeList: [{ NodeId: 2, ProductType: "CVM", ResourceList: [{ ResourceId: "ins-test", ResourceName: "主机" }] }] });
  assert.equal(result.nodes.length, 2);
  assert.deepEqual(result.nodes[0].bindingNodeIds, ["zone", "server"]);
  assert.deepEqual(result.nodes[0].resourceKeys, ["tencent:CVM:ap-guangzhou:ins-test"]);
  assert.equal(result.nodes[1].resourceCount, 1);
});

test("quick duty switch preserves saved scopes, bindings and capacity reminder episodes", t => {
  const f = fixture(t), now = Date.now();
  capacity.processSnapshot(f.id, f.settings, sampleCapacity(now), now);
  const before = duty.getSettings(f.id);
  const signals = db().prepare("SELECT * FROM architecture_capacity_signals WHERE watch_id=?").all(f.id);
  const disabled = duty.setEnabled(f.id, false, null);
  assert.equal(disabled.enabled, false);
  assert.deepEqual(disabled.products, before.products);
  assert.equal(disabled.targetChatId, before.targetChatId);
  assert.equal(disabled.bindCode, before.bindCode);
  const enabled = duty.setEnabled(f.id, true, f.detail);
  assert.equal(enabled.enabled, true);
  assert.deepEqual(db().prepare("SELECT * FROM architecture_capacity_signals WHERE watch_id=?").all(f.id), signals);
  assert.throws(() => duty.setEnabled(f.id, "false", null), /Invalid/);
  duty.saveSettings(f.id, { ...before, enabled: false, products: {} }, f.detail);
  assert.throws(() => duty.setEnabled(f.id, true, f.detail), /产品范围/);
});

test("node inspection is scoped to cloud bindings, paginates alarms and never creates duty events", async t => {
  const f = fixture(t), nodes = require("../src/architecture-node"), now = Date.now(), calls = [];
  f.detail.nodes = [{ id: "node-one", name: "核心服务", bindingNodeIds: ["node-one"], resourceKeys: ["tencent:CVM:ap-guangzhou:ins-watched"] }];
  const result = await nodes.getNode(f.id, "node-one", { now, getDetail: async () => f.detail,
    getCapacity: async (id, options) => {
      assert.equal(id, f.id); assert.deepEqual(options.nodeIds, ["node-one"]);
      assert.deepEqual(options.resources.map(r => r.id), ["ins-watched"]);
      return sampleCapacity(now);
    },
    clientFor: () => ({ describeAlarmHistories: async params => {
      calls.push(params);
      assert.equal(params.AlarmObject, "ins-watched"); assert.ok(params.StartTime > 0);
      if (params.AlarmStatus[0] !== "ALARM") return { Histories: [], TotalCount: 0 };
      const alarm = { AlarmId: "a-" + params.PageNumber, AlarmObject: "ins-watched", AlarmStatus: "ALARM", Content: "cpu high", FirstOccurTime: Math.floor(now / 1000) - 2 };
      return { Histories: [alarm, { ...alarm, AlarmId: "foreign", AlarmObject: "ins-watched-longer" }], TotalCount: params.PageNumber === 1 ? 101 : 101 };
    } }),
  });
  assert.equal(result.resources.length, 1);
  assert.equal(result.resources[0].capacity.metrics[0].value, 91);
  assert.deepEqual(result.resources[0].alarms.items.map(a => a.id), ["a-1", "a-2"]);
  assert.equal(calls.length, 3); assert.equal(result.resources[0].alarms.complete, true);
  assert.equal(duty.history(f.id).totalCount, 0);
  await assert.rejects(nodes.getNode(f.id, "foreign-node", { getDetail: async () => f.detail }), /node not found/);
});

test("node inspection surfaces partial cloud failures and redacts credentials", async t => {
  const f = fixture(t), nodes = require("../src/architecture-node");
  f.detail.nodes = [{ id: "node-one", resourceKeys: ["tencent:CVM:ap-guangzhou:ins-watched"], bindingNodeIds: ["node-one"] }];
  const result = await nodes.getNode(f.id, "node-one", { getDetail: async () => f.detail,
    getCapacity: async () => { throw new Error("Forbidden cloud-secret-test"); },
    clientFor: () => ({ describeAlarmHistories: async () => { throw new Error("Forbidden cloud-secret-test"); } }),
  });
  assert.equal(result.resources[0].capacity, null);
  assert.equal(result.resources[0].alarms.complete, false);
  assert.ok(result.resources[0].alarms.errors.length);
  assert.ok(result.errors.length);
  assert.doesNotMatch(JSON.stringify(result), /cloud-secret-test|AKID_DUTY_CLOUD/);
});

test("node capacity inspection does not include another node sharing the same instance", async t => {
  const f = fixture(t), requested = [];
  f.detail.resources[0].nodeIds = ["selected", "other-alias"];
  await capacity.getCapacity(f.id, { detail: f.detail, resources: [f.detail.resources[0]], nodeIds: ["selected"], request: async (action, params) => {
    if (action === "DescribeArchThresholdConfigStatusV2") return { AnalysisDay: 7 };
    if (action === "UpdateNodeResourceCapacityMetricV2") return { MapId: "arch-duty", CapacityAsyncId: "task-current" };
    if (action === "DescribeNodeLoadInfoV2New") return { IsFinish: true, NodeLoadRiskInfos: [
      { NodeId: "selected", IsFinish: true, TaskId: "task-current", LastSuccessTaskId: "task-current" },
      { NodeId: "other-alias", IsFinish: true, TaskId: "task-current", LastSuccessTaskId: "task-current" },
    ] };
    requested.push(params.NodeUuid);
    return { LatestUpdateTime: new Date().toISOString(), ResourceLoadRiskInfos: [] };
  } });
  assert.deepEqual(requested, ["selected"]);
});

test("each RCA chunk identifies its architecture and delivery retries resume the saved messages", async t => {
  const f = fixture(t, { rcaEnabled: true }), answer = "证据与建议。".repeat(1200), sent = [];
  duty.enqueue(f.id, f.settings, { key: "long-rca", type: "alarm", title: "异常", resourceId: "ins-watched", product: "CVM", region: "ap-guangzhou", payload: {} });
  await worker.deliverNotifications({ sendMessage: async () => {} });
  await worker.processAnalyses({ adapter: { async createConversation() { return {}; }, async sendMessage(_session, _prompt, delta) { delta(answer); return { stopReason: "end_turn" }; } },
    sendMessage: async (_bot, _group, text) => {
      if (sent.length === 1) throw new Error("第二条临时失败");
      sent.push(text);
    } });
  const row = db().prepare("SELECT * FROM architecture_watch_events").get(), plan = JSON.parse(row.analysis_messages_json);
  assert.ok(plan.length > 2); assert.equal(row.analysis_parts_sent, 1);
  assert.equal(row.analysis_status, "ready");
  // Even if a display name changes while waiting, retry the exact saved chunks.
  db().prepare("UPDATE architecture_watches SET arch_name='改名后架构' WHERE id=?").run(f.id);
  db().prepare("UPDATE architecture_watch_events SET next_attempt_at=0").run();
  await worker.processAnalyses({ adapter: { createConversation() { assert.fail("must reuse completed analysis"); } },
    sendMessage: async (_bot, _group, text) => sent.push(text) });
  assert.deepEqual(sent, plan);
  for (const text of sent) {
    assert.match(text, /架构图：\*\* 生产架构/); assert.match(text, /架构图 ID：\*\* arch-duty/);
    assert.match(text, /advisor\?archId=arch-duty/); assert.ok(Buffer.byteLength(text, "utf8") <= 3800);
  }
  assert.equal(duty.history(f.id).items[0].analysis, answer);
  assert.equal(duty.history(f.id).items[0].analysisStatus, "completed");
});

test("partially delivered legacy RCA results retain their remaining text when architecture labels are added", async t => {
  const f = fixture(t, { rcaEnabled: true }), answer = "旧版分析证据。".repeat(700), title = "异常", sent = [];
  duty.enqueue(f.id, f.settings, { key: "legacy-rca", type: "alarm", title, resourceId: "ins-watched", product: "CVM", region: "ap-guangzhou", payload: {} });
  const legacyParts = require("../src/alert-worker").splitUtf8(`### 架构值守 · RCA 分析\n**事件：** ${title}\n\n${answer}`);
  db().prepare("UPDATE architecture_watch_events SET notified_at=?,analysis_status='ready',analysis=?,analysis_parts_sent=1").run(Date.now(), answer);
  await worker.processAnalyses({ adapter: { createConversation() { assert.fail("must reuse legacy analysis"); } }, sendMessage: async (_bot, _group, text) => sent.push(text) });
  assert.ok(sent.length > 0);
  const recovered = sent.map(text => text.slice(text.indexOf("\n\n") + 2)).join("");
  assert.equal(recovered, legacyParts.slice(1).join(""));
  for (const text of sent) assert.match(text, /架构图 ID：\*\* arch-duty/);
  assert.equal(duty.history(f.id).items[0].analysisStatus, "completed");
});

test("capacity refresh coalesces concurrent readers and polls the current task without starting another", async t => {
  const f = fixture(t), cache = new Map(), calls = [];
  f.detail.resources[0].nodeIds = ["node-one"];
  let finished = false;
  const options = { detail: f.detail, resources: [f.detail.resources[0]], taskCache: cache, pollAttempts: 1,
    request: async (action, params) => {
      calls.push({ action, params });
      if (action === "DescribeArchThresholdConfigStatusV2") return { AnalysisDay: 14 };
      if (action === "UpdateNodeResourceCapacityMetricV2") return { MapId: "arch-duty", CapacityAsyncId: "fresh-task" };
      if (action === "DescribeNodeLoadInfoV2New") return { IsFinish: finished, NodeLoadRiskInfos: [{ NodeId: "node-one", IsFinish: finished, TaskId: "fresh-task", LastSuccessTaskId: finished ? "fresh-task" : "old-task" }] };
      assert.equal(params.TaskId, "fresh-task");
      return { LatestUpdateTime: new Date().toISOString(), ResourceLoadRiskInfos: [{ InsId: "ins-watched", Region: "ap-guangzhou", Period: 14, RiskLevel: 3,
        MetricValueList: [{ Metric: "CPU利用率", MetricRiskLevel: 3, Value: 95 }] }] };
    } };
  const [a, b] = await Promise.all([capacity.getCapacity(f.id, options), capacity.getCapacity(f.id, options)]);
  assert.equal(a.complete, false); assert.equal(b.complete, false); assert.equal(a.resources.length, 0);
  assert.equal(calls.filter(c => c.action === "UpdateNodeResourceCapacityMetricV2").length, 1);
  assert.equal(calls.filter(c => c.action === "DescribeNodeLoadInfoV2New").length, 1);
  finished = true;
  const fresh = await capacity.getCapacity(f.id, options);
  assert.equal(fresh.resources[0].taskId, "fresh-task"); assert.equal(fresh.resources[0].stale, false);
  assert.equal(fresh.resources[0].metrics[0].value, 95);
  await capacity.getCapacity(f.id, options);
  assert.equal(calls.filter(c => c.action === "UpdateNodeResourceCapacityMetricV2").length, 1);
  assert.equal(calls.filter(c => c.action === "DescribeNodeLoadInfoV2New").length, 2);
});

test("capacity refresh failures and invalid cloud periods never fall back to old task results", async t => {
  const f = fixture(t);
  await assert.rejects(capacity.getCapacity(f.id, { detail: f.detail, request: async action => {
    assert.equal(action, "DescribeArchThresholdConfigStatusV2"); return {};
  } }), /有效分析周期/);
  await assert.rejects(capacity.getCapacity(f.id, { detail: f.detail, request: async action => {
    if (action === "DescribeArchThresholdConfigStatusV2") return { AnalysisDay: 7 };
    assert.equal(action, "UpdateNodeResourceCapacityMetricV2"); throw new Error("Forbidden refresh");
  } }), /Forbidden refresh/);
  f.detail.resources[0].nodeIds = ["node-one"];
  const snapshot = await capacity.getCapacity(f.id, { detail: f.detail, request: async action => {
    if (action === "DescribeArchThresholdConfigStatusV2") return { AnalysisDay: 7 };
    if (action === "UpdateNodeResourceCapacityMetricV2") return { MapId: "arch-duty", CapacityAsyncId: "new-task" };
    assert.equal(action, "DescribeNodeLoadInfoV2New");
    return { IsFinish: true, NodeLoadRiskInfos: [{ NodeId: "node-one", IsFinish: true, TaskId: "old-task", LastSuccessTaskId: "old-task" }] };
  } });
  assert.equal(snapshot.resources.length, 0);
});

test("alarm checks cover every architecture resource even when capacity and push scopes exclude them", async t => {
  const f = fixture(t, { products: { "tencent:CVM": { enabled: true, alarms: true, metrics: false, resourceIds: ["ins-watched"] } } });
  f.detail.resources.push(
    { id: "cls-test", name: "集群", productKey: "tencent:TKE", product: "TKE", cloudProvider: "tencent", region: "ap-guangzhou", status: "运行中" },
    { id: "prom-test", name: "监控实例", productKey: "tencent:Prometheus", product: "Prometheus", cloudProvider: "tencent", region: "ap-shanghai", status: "运行中" });
  const now = Date.now(), requests = [];
  const alarm = id => ({ AlarmId: "alarm-" + id, AlarmObject: id, AlarmStatus: "ALARM", FirstOccurTime: Math.floor(now / 1000) - 2 * 86400 });
  const summary = await poller.checkNow(f.id, { now, getDetail: async () => f.detail,
    getCapacity: () => assert.fail("capacity disabled must not prevent any alarm query"),
    clientFor: region => ({ async describeAlarmHistories(params) {
      requests.push({ region, params });
      assert.equal(params.MonitorTypes, undefined); assert.equal(params.AlarmStatus, undefined);
      assert.equal(params.StartTime, Math.floor(now / 1000) - 30 * 86400);
      if (region === "ap-shanghai") return { Histories: [alarm("prom-test")], TotalCount: 1 };
      return params.PageNumber === 1
        ? { Histories: [alarm("ins-watched"), alarm("ins-excluded"), ...Array.from({ length: 98 }, (_, i) => alarm("ins-foreign-" + i))], TotalCount: 101 }
        : { Histories: [alarm("cls-test")], TotalCount: 101 };
    } }),
  });
  assert.equal(requests.length, 3); assert.equal(summary.alarms.queriedResources, 4);
  assert.equal(summary.alarms.resourceCount, 4); assert.equal(summary.alarms.activeCount, 4);
  assert.equal(summary.alarms.totalCount, 4); assert.equal(summary.alarms.complete, true);
  assert.equal(summary.capacityResources, 0); assert.equal(summary.events, 1);
  const events = duty.history(f.id).items;
  assert.deepEqual(events.map(event => event.resourceId), ["ins-watched"]);
  assert.ok(summary.alarms.resources.every(resource => resource.status === "checked"));
  assert.equal(summary.alarms.resources.find(resource => resource.resourceId === "prom-test").pushEnabled, false);
  assert.equal(duty.history(f.id).checks[0].alarms.queriedResources, 4);
});

test("failed and incomplete alarm queries never count as successfully checked resources", async t => {
  const f = fixture(t, { products: { "tencent:CVM": { enabled: true, alarms: true, metrics: false, resourceIds: [] } } });
  f.detail.resources[1].region = "ap-shanghai";
  const summary = await poller.checkNow(f.id, { getDetail: async () => f.detail, clientFor: region => ({ async describeAlarmHistories() {
    if (region === "ap-shanghai") throw new Error("Forbidden cloud-secret-test");
    return { Histories: [], TotalCount: 0 };
  } }) });
  assert.equal(summary.alarms.complete, false); assert.equal(summary.alarms.queriedResources, 1);
  assert.equal(summary.alarms.requests, 2);
  assert.equal(summary.alarms.resources[1].status, "failed");
  assert.doesNotMatch(JSON.stringify(summary), /cloud-secret-test/);
  f.detail.resources[1].region = "ap-guangzhou";
  const partial = await poller.checkNow(f.id, { getDetail: async () => f.detail, clientFor: () => ({ async describeAlarmHistories() { return { Histories: [], TotalCount: 1 }; } }) });
  assert.equal(partial.alarms.queriedResources, 0); assert.equal(partial.alarms.complete, false);
  assert.equal(partial.alarms.resources[0].status, "partial");
  assert.ok(partial.warnings.some(w => w.includes("未读取完整")));
});

test("an ongoing older alarm is discovered and its later recovery is observed without relying on initial occurrence time", async t => {
  const f = fixture(t, { products: { "tencent:CVM": { enabled: true, alarms: true, metrics: false, resourceIds: ["ins-watched"] } } });
  const now = Date.now(), alarm = { AlarmId: "old-active", AlarmObject: "ins-watched", AlarmStatus: "ALARM",
    FirstOccurTime: Math.floor(now / 1000) - 2 * 86400, LastOccurTime: Math.floor(now / 1000) - 86400 };
  const options = { now, getDetail: async () => f.detail, clientFor: () => sampleClient([alarm]) };
  assert.equal((await poller.checkNow(f.id, options)).events, 1);
  await worker.deliverNotifications({ sendMessage: async () => {} });
  alarm.AlarmStatus = "OK";
  assert.equal((await poller.checkNow(f.id, { ...options, now: now + 60000 })).events, 1);
  const recovery = duty.history(f.id).items.find(event => event.type === "recovery");
  assert.equal(recovery.payload.observedRecovery, true); assert.equal(recovery.payload.occurredAt, now + 60000);
  assert.equal((await poller.checkNow(f.id, { ...options, now: now + 120000 })).events, 0);
});

test("architecture RCA inherits the WMA version environment and ignores legacy diagnostic overrides", async t => {
  const f = fixture(t, { rcaEnabled: true });
  const runtime = registry.saveTencentCredential({ name: "Version Runtime", secretId: "AKID_VERSION_RUNTIME", secretKey: "version-runtime-secret" });
  registry.saveAgent(f.agent, f.agent.id, { runtimeVersion: { runtimeCredentialId: runtime.id, runtimeRegion: "ap-guangzhou", wmaVersionId: "version-with-credentials", wmaVersionName: "凭证注入版", runtimeCredentialUpdatedAt: runtime.updatedAt } });
  const settings = duty.saveSettings(f.id, { ...f.settings, diagnosticCredentialId: "retired-missing-credential" }, f.detail);
  assert.equal(settings.diagnosticCredentialId, undefined);
  duty.enqueue(f.id, settings, { key: "version-inherited", type: "alarm", title: "异常", resourceId: "ins-watched", product: "CVM", region: "ap-guangzhou", payload: {} });
  const event = db().prepare("SELECT * FROM architecture_watch_events").get();
  assert.equal(JSON.parse(event.destination_json).diagnosticCredentialId, undefined);
  db().prepare("UPDATE architecture_watch_events SET destination_json=json_set(destination_json,'$.diagnosticCredentialId','legacy-deleted')").run();
  const { AgentAdapter } = require("../src/agent");
  t.mock.method(AgentAdapter.prototype, "createConversation", async function () {
    assert.equal(this.config.wmaVersionId, "version-with-credentials"); return {};
  });
  t.mock.method(AgentAdapter.prototype, "sendMessage", async function (_session, prompt, delta) {
    assert.equal(this.config.wmaVersionId, "version-with-credentials");
    assert.doesNotMatch(prompt, /AKID_VERSION_RUNTIME|version-runtime-secret|cloud-secret-test|wma-secret-test|诊断运行时凭证/);
    assert.match(prompt, /架构图 ID：arch-duty/);
    delta("结果：version-runtime-secret cloud-secret-test"); return { stopReason: "end_turn" };
  });
  const sent = [];
  await worker.deliverNotifications({ sendMessage: async (_bot, _group, text) => sent.push(text) });
  await worker.processAnalyses({ sendMessage: async (_bot, _group, text) => sent.push(text) });
  assert.equal(duty.history(f.id).items[0].analysisStatus, "completed");
  assert.equal(duty.history(f.id).items[0].analysis, "结果：[REDACTED] [REDACTED]");
  assert.doesNotMatch(JSON.stringify(sent), /version-runtime-secret|cloud-secret-test/);
});
