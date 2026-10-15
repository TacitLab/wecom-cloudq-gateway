"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

process.env.ADMIN_PASSWORD = "test-admin-password";
process.env.SQLITE_PATH = ":memory:";

const { db } = require("../src/database");
const alertStore = require("../src/alert-store");
const registry = require("../src/registry");
const notifier = require("../src/notifier");
const { handleMessage } = require("../src/gateway");
const { buildConversationKey } = require("../src/conversation");
const taskControl = require("../src/task-control");
const { TencentMonitorClient } = require("../src/monitor-client");
const { TencentClsClient } = require("../src/cls-client");
const { listAlarmPolicies } = require("../src/alert-config");
const { pollIntegration, queryFor } = require("../src/alert-poller");
const alertWorker = require("../src/alert-worker");
const { splitUtf8 } = require("../src/alert-worker");

function createPair() {
  const agent = registry.saveAgent({ name: "SRE", agentId: "agent_ALERT", apiKey: "pt_test" });
  const bot = registry.saveBot({ name: "Alert Bot", botId: "aibot-alert", secret: "bot-secret", cloudAgentId: agent.id });
  return { agent, bot };
}

function createCredential(input = {}) {
  return registry.saveTencentCredential({ name: "TC cred", secretId: "AKIDEXAMPLE", secretKey: "SECRETEXAMPLE", ...input });
}

test.beforeEach(() => {
  db().exec("DELETE FROM alert_jobs; DELETE FROM alert_integrations; DELETE FROM tasks; DELETE FROM conversations; DELETE FROM wecom_bots; DELETE FROM cloud_agents; DELETE FROM tencent_credentials;");
});

test("alert integration hides credentials, binds one group, and deduplicates AlarmId", () => {
  const { bot } = createPair();
  const credential = createCredential();
  const integration = alertStore.saveIntegration({
    name: "Production alarms",
    botConfigId: bot.id,
    credentialId: credential.id,
    region: "ap-guangzhou",
    namespace: "cvm_device",
  });
  assert.equal(integration.secretId, undefined);
  assert.equal(integration.credentialId, credential.id);
  assert.equal(integration.credentialName, credential.name);
  assert.equal(alertStore.getIntegration(integration.id, { secrets: true }).secretKey, "SECRETEXAMPLE");
  const bound = alertStore.bindChat(integration.bindCode, bot.id, "chat-production");
  assert.equal(bound.targetChatId, "chat-production");
  const history = { AlarmId: "alarm-1", AlarmStatus: "ALARM", AlarmObject: "ins-1", FirstOccurTime: 100 };
  assert.equal(alertStore.enqueueHistory(integration.id, history).claimed, true);
  assert.equal(alertStore.enqueueHistory(integration.id, history).claimed, false);
  assert.equal(alertStore.nextJob().status, "analyzing");
});

test("rotating a tencent credential syncs the inline AK/SK of referencing integrations", () => {
  const { bot } = createPair();
  const credential = createCredential();
  const integration = alertStore.saveIntegration({
    name: "Rotation", botConfigId: bot.id, credentialId: credential.id, region: "ap-guangzhou",
  });
  registry.saveTencentCredential({ name: "TC cred", secretId: "AKIDNEW", secretKey: "SECRETNEW" }, credential.id);
  const reloaded = alertStore.getIntegration(integration.id, { secrets: true });
  assert.equal(reloaded.secretId, "AKIDNEW");
  assert.equal(reloaded.secretKey, "SECRETNEW");
});

test("a tencent credential referenced by an alert integration cannot be deleted", () => {
  const { bot } = createPair();
  const credential = createCredential();
  alertStore.saveIntegration({ name: "Blocking", botConfigId: bot.id, credentialId: credential.id, region: "ap-guangzhou" });
  assert.throws(() => registry.deleteTencentCredential(credential.id), /still used/);
});

test("alert polling can be paused and resumed without losing its group binding", () => {
  const { bot } = createPair();
  const saved = alertStore.saveIntegration({
    name: "Pausable polling", botConfigId: bot.id, credentialId: createCredential().id, region: "ap-guangzhou",
  });
  alertStore.bindChat(saved.bindCode, bot.id, "chat-pausable");
  assert.equal(alertStore.dueIntegrations().length, 1);

  const paused = alertStore.setIntegrationEnabled(saved.id, false);
  assert.equal(paused.enabled, false);
  assert.equal(paused.targetChatId, "chat-pausable");
  assert.equal(alertStore.dueIntegrations().length, 0);

  const resumed = alertStore.setIntegrationEnabled(saved.id, true);
  assert.equal(resumed.enabled, true);
  assert.equal(resumed.targetChatId, "chat-pausable");
  assert.equal(alertStore.dueIntegrations().length, 1);
});

test("group bind command records chatid instead of sending the command to CloudAgent", async () => {
  const { bot } = createPair();
  const integration = alertStore.saveIntegration({ name: "Bind me", botConfigId: bot.id, credentialId: createCredential().id, region: "ap-guangzhou" });
  const replies = [];
  const client = { replyStream: async (...args) => { replies.push(args); } };
  await handleMessage(bot.id, client, {
    headers: { req_id: "req-bind" },
    body: {
      msgid: "msg-bind", aibotid: "aibot-alert", chattype: "group", chatid: "chat-fixed",
      from: { userid: "admin" }, msgtype: "text", text: { content: `/bind-alert ${integration.bindCode}` },
    },
  });
  assert.equal(alertStore.getIntegration(integration.id).targetChatId, "chat-fixed");
  assert.match(replies[0][2], /已绑定/);
});

test("group @Bot /stop immediately aborts the active conversation task", async () => {
  const { bot } = createPair();
  const pair = registry.pairForBot(bot.id);
  const message = {
    msgid: "msg-stop", aibotid: "aibot-alert", chattype: "group", chatid: "chat-stop",
    from: { userid: "admin" }, msgtype: "text", text: { content: "@Alert Bot /stop" },
  };
  const conversationKey = buildConversationKey(message, pair.pairKey, pair.bot.groupSessionScope);
  const control = taskControl.begin(conversationKey, "running-task");
  const replies = [];

  try {
    await handleMessage(bot.id, { replyStream: async (...args) => { replies.push(args); } }, {
      headers: { req_id: "req-stop" }, body: message,
    });
    assert.equal(control.signal.aborted, true);
    assert.match(replies.at(-1)[2], /已停止当前任务/);
  } finally {
    taskControl.finish(conversationKey, "running-task");
  }
});

test("binding intercepts a spaced display-name mention in text and mixed messages without creating Agent tasks", async () => {
  const { bot } = createPair();
  const credential = createCredential();
  for (const msgtype of ["text", "mixed"]) {
    const integration = alertStore.saveIntegration({ name: `Bind ${msgtype}`, botConfigId: bot.id, credentialId: credential.id, region: "ap-guangzhou" });
    const content = `@多云管理 AIOPS agent\u2005/bind-alert ${integration.bindCode}`;
    const replies = [];
    await handleMessage(bot.id, { replyStream: async (...args) => { replies.push(args); } }, {
      body: {
        msgid: `msg-bind-${msgtype}`, aibotid: bot.botId, chattype: "group", chatid: `chat-${msgtype}`,
        from: { userid: "admin" }, msgtype,
        ...(msgtype === "text" ? { text: { content } } : { mixed: { msg_item: [{ msgtype: "text", text: { content } }] } }),
      },
    });
    assert.equal(alertStore.getIntegration(integration.id).targetChatId, `chat-${msgtype}`);
    assert.match(replies[0][2], /已绑定/);
    assert.equal(db().prepare("SELECT COUNT(*) AS n FROM tasks").get().n, 0);
  }
});

test("display-name binding still rejects invalid codes and codes assigned to another Bot", async () => {
  const { bot } = createPair();
  const otherBot = registry.saveBot({ name: bot.name, botId: "aibot-other", secret: "test-secret", cloudAgentId: bot.cloudAgentId });
  const integration = alertStore.saveIntegration({ name: "Own Bot only", botConfigId: otherBot.id, credentialId: createCredential().id, region: "ap-guangzhou" });
  for (const code of ["INVALID_CODE", integration.bindCode]) {
    const replies = [];
    await handleMessage(bot.id, { replyStream: async (...args) => { replies.push(args); } }, {
      body: {
        msgid: `msg-invalid-${code}`, aibotid: bot.botId, chattype: "group", chatid: "chat-unbound",
        from: { userid: "admin" }, msgtype: "text", text: { content: `@多云管理 AIOPS agent /bind-alert ${code}` },
      },
    });
    assert.match(replies[0][2], /绑定失败/);
  }
  assert.equal(alertStore.getIntegration(integration.id).targetChatId, "");
  assert.equal(db().prepare("SELECT COUNT(*) AS n FROM tasks").get().n, 0);
  const replies = [];
  await handleMessage(otherBot.id, { replyStream: async (...args) => { replies.push(args); } }, {
    body: {
      msgid: "msg-correct-bot", aibotid: otherBot.botId, chattype: "group", chatid: "chat-correct-bot",
      from: { userid: "admin" }, msgtype: "text", text: { content: `@多云管理 AIOPS agent /bind-alert ${integration.bindCode}` },
    },
  });
  assert.match(replies[0][2], /已绑定/);
  assert.equal(alertStore.getIntegration(integration.id).targetChatId, "chat-correct-bot");
});

test("notifier proactively sends markdown over the authenticated Bot connection", async () => {
  const calls = [];
  const client = {
    isConnected: true,
    sendMessage: async (...args) => { calls.push(args); return { errcode: 0 }; },
  };
  notifier.register("bot-config", client);
  try {
    await notifier.sendMessage("bot-config", "chat-1", "hello");
    assert.deepEqual(calls[0], ["chat-1", { msgtype: "markdown", markdown: { content: "hello" } }]);
  } finally {
    notifier.unregister("bot-config", client);
  }
});

test("Tencent Monitor client signs DescribeAlarmHistories and sends expected filters", async () => {
  let captured;
  const fetchImpl = async (url, options) => {
    captured = { url, options };
    return { ok: true, json: async () => ({ Response: { TotalCount: 0, Histories: [] } }) };
  };
  const client = new TencentMonitorClient({ secretId: "sid", secretKey: "skey", region: "ap-guangzhou" }, fetchImpl);
  const query = queryFor({ monitorType: "MT_QCE", namespace: "cvm_device", includeRecovery: false, policyIds: ["policy-1"] }, 1, 100, 200);
  await client.describeAlarmHistories(query);
  assert.equal(captured.url, "https://monitor.tencentcloudapi.com");
  assert.match(captured.options.headers.Authorization, /^TC3-HMAC-SHA256 Credential=sid\//);
  assert.equal(captured.options.headers["X-TC-Action"], "DescribeAlarmHistories");
  assert.deepEqual(JSON.parse(captured.options.body).AlarmStatus, ["ALARM"]);
  assert.deepEqual(JSON.parse(captured.options.body).PolicyIds, ["policy-1"]);
  assert.deepEqual(JSON.parse(captured.options.body).MonitorTypes, ["MT_QCE"]);
  assert.equal(JSON.parse(captured.options.body).Namespaces, undefined);
});

test("alarm policy discovery pages through all policies and returns display metadata", async () => {
  const queries = [];
  const client = {
    describeAlarmPolicies: async (query) => {
      queries.push(query);
      if (query.PageNumber === 1) return {
        TotalCount: 2,
        Policies: [{
          PolicyId: "policy-1", PolicyName: "CVM CPU", Namespace: "cvm_device",
          NamespaceShowName: "云服务器-基础监控", MonitorType: "MT_QCE", Enable: 1,
        }],
      };
      return {
        TotalCount: 2,
        Policies: [{
          PolicyId: "policy-2", PolicyName: "Redis", Namespace: "redis",
          NamespaceShowName: "云数据库 Redis", MonitorType: "MT_QCE", Enable: 0,
        }],
      };
    },
  };
  const items = await listAlarmPolicies({}, "ap-guangzhou", { client });
  assert.equal(queries.length, 2);
  assert.deepEqual(items.map((item) => [item.id, item.name, item.namespaceName, item.enabled]), [
    ["policy-1", "CVM CPU", "云服务器-基础监控", true],
    ["policy-2", "Redis", "云数据库 Redis", false],
  ]);
});

test("alert configuration requires a credential and region", () => {
  const { bot } = createPair();
  assert.throws(() => alertStore.saveIntegration({
    name: "Missing region", botConfigId: bot.id, credentialId: createCredential().id,
  }), /Region is required/);
});

test("poller pages through alarm history and advances its cursor after enqueue", async () => {
  const { bot } = createPair();
  const saved = alertStore.saveIntegration({ name: "Polling", botConfigId: bot.id, credentialId: createCredential().id, region: "ap-guangzhou" });
  alertStore.bindChat(saved.bindCode, bot.id, "chat-polling");
  const integration = alertStore.getIntegration(saved.id, { secrets: true });
  const queries = [];
  const client = {
    describeAlarmHistories: async (query) => {
      queries.push(query);
      if (query.PageNumber === 1) return { TotalCount: 101, Histories: [{ AlarmId: "alarm-page", AlarmStatus: "ALARM" }] };
      return { TotalCount: 101, Histories: [] };
    },
  };
  const originalSchedule = alertWorker.schedule;
  alertWorker.schedule = () => Promise.resolve();
  try {
    const result = await pollIntegration(integration, { client });
    assert.equal(result.claimed, 1);
    assert.equal(queries.length, 2);
    assert.ok(alertStore.getIntegration(saved.id).lastSuccessAt);
    assert.equal(alertStore.listJobs().length, 1);
  } finally {
    alertWorker.schedule = originalSchedule;
  }
});

test("proactive message splitting respects UTF-8 byte limits", () => {
  const parts = splitUtf8("告警".repeat(100), 31);
  assert.ok(parts.length > 1);
  assert.ok(parts.every((part) => Buffer.byteLength(part, "utf8") <= 31));
  assert.equal(parts.join(""), "告警".repeat(100));
});

test("APM policy discovery and history queries stay scoped to MT_TAW", async () => {
  let captured;
  const items = await listAlarmPolicies({}, "ap-guangzhou", {
    monitorType: "MT_TAW",
    client: { describeAlarmPolicies: async (query) => {
      captured = query;
      return { TotalCount: 1, Policies: [{ PolicyId: "apm-policy", MonitorType: "MT_TAW", Namespace: "performance_metric", Enable: 1 }] };
    } },
  });
  assert.deepEqual(captured.MonitorTypes, ["MT_TAW"]);
  assert.equal(items[0].monitorType, "MT_TAW");
  const integration = { monitorType: "MT_TAW", namespace: "", policyIds: [], includeRecovery: false };
  assert.deepEqual(queryFor(integration, 1, 100, 200).MonitorTypes, ["MT_TAW"]);
  assert.equal(queryFor(integration, 1, 100, 200).Namespaces, undefined);
  assert.deepEqual(queryFor({ ...integration, policyIds: ["apm-policy"] }, 1, 100, 200).PolicyIds, ["apm-policy"]);
  assert.deepEqual(queryFor({ ...integration, namespace: "performance_metric" }, 1, 100, 200).Namespaces,
    [{ MonitorType: "MT_TAW", Namespace: "performance_metric" }]);
});

test("CLS requests use their own host, signing service, and API version", async () => {
  const requests = [];
  const client = new TencentClsClient({ secretId: "sid", secretKey: "skey", region: "ap-guangzhou" }, async (url, options) => {
    requests.push({ url, options });
    return { ok: true, json: async () => ({ Response: {} }) };
  });
  await client.describeAlarms({ Offset: 0, Limit: 100 });
  await client.describeAlertRecordHistory({ From: 100000, To: 200000 });
  assert.deepEqual(requests.map((r) => r.options.headers["X-TC-Action"]), ["DescribeAlarms", "DescribeAlertRecordHistory"]);
  for (const { url, options } of requests) {
    assert.equal(url, "https://cls.tencentcloudapi.com");
    assert.equal(options.headers.Host, "cls.tencentcloudapi.com");
    assert.equal(options.headers["X-TC-Version"], "2020-10-16");
    assert.equal(options.headers["X-TC-Region"], "ap-guangzhou");
    assert.match(options.headers.Authorization, /Credential=sid\/\d{4}-\d{2}-\d{2}\/cls\/tc3_request/);
  }
});

test("CLS policy discovery uses offset pagination and normalizes enabled status", async () => {
  const queries = [];
  const items = await listAlarmPolicies({}, "ap-guangzhou", {
    monitorType: "MT_CLS",
    client: { describeAlarms: async (query) => {
      queries.push(query);
      return { TotalCount: 2, Alarms: query.Offset === 0
        ? [{ AlarmId: "cls-1", Name: "日志异常", Status: true }]
        : [{ AlarmId: "cls-2", Name: "已停用日志告警", Status: false }] };
    } },
  });
  assert.deepEqual(queries, [{ Offset: 0, Limit: 100 }, { Offset: 100, Limit: 100 }]);
  assert.deepEqual(items.map((p) => [p.id, p.name, p.monitorType, p.enabled]),
    [["cls-1", "日志异常", "MT_CLS", true], ["cls-2", "已停用日志告警", "MT_CLS", false]]);
});

test("CLS polling uses milliseconds, record IDs for deduplication, and keeps diagnosis context", async () => {
  const { bot } = createPair();
  const saved = alertStore.saveIntegration({ name: "CLS", botConfigId: bot.id, credentialId: createCredential().id,
    region: "ap-guangzhou", monitorType: "MT_CLS", policyIds: ["cls-policy"], includeRecovery: true });
  const integration = alertStore.getIntegration(saved.id, { secrets: true });
  const record = { RecordId: "record-1", AlarmId: "cls-policy", AlarmName: "业务日志异常", TopicId: "topic-1",
    TopicName: "订单日志", Trigger: "error_count > 5", Status: 0, CreateTime: 1700000000123, AlarmLevel: 0, GroupTriggerCondition: [{ Key: "service", Value: "orders" }] };
  const queries = [];
  const client = { describeAlertRecordHistory: async (query) => {
    queries.push(query);
    return { TotalCount: 101, Records: query.Offset === 0 ? [record, { ...record, RecordId: "record-2", Status: 1 }] : [] };
  } };
  const schedule = alertWorker.schedule;
  alertWorker.schedule = () => Promise.resolve();
  try {
    const result = await pollIntegration(integration, { client });
    assert.equal(result.claimed, 2);
    assert.equal(queries[0].From, result.startTime * 1000);
    assert.equal(queries[0].To, result.endTime * 1000);
    assert.equal(queries[1].Offset, 100);
    assert.deepEqual(queries[0].Filters, [{ Key: "status", Values: ["0", "1"] }, { Key: "alertId", Values: ["cls-policy"] }]);
    assert.equal((await pollIntegration(integration, { client })).claimed, 0);
    const jobs = alertStore.listJobs();
    const first = jobs.find((job) => job.alarmId === "record-1");
    assert.equal(first.payload.PolicyId, "cls-policy");
    assert.equal(first.payload.FirstOccurTime, 1700000000);
    assert.equal(first.payload.Region, "ap-guangzhou");
    assert.deepEqual(first.payload.RawData, record);
    assert.match(alertWorker.defaultPrompt(first.payload), /订单日志/);
    assert.match(alertWorker.defaultPrompt(first.payload), /级别：0/);
    assert.match(alertWorker.defaultPrompt(first.payload), /GroupTriggerCondition/);
    assert.equal(jobs.find((job) => job.alarmId === "record-2").alarmStatus, "OK");
  } finally { alertWorker.schedule = schedule; }
  assert.deepEqual(queryFor({ ...integration, policyIds: [], includeRecovery: false }, 1, 100, 200).Filters,
    [{ Key: "status", Values: ["0"] }]);
});

test("monitoring scope is explicit, preserves legacy CVM defaults, and resets the cursor when changed", () => {
  const { bot } = createPair();
  const input = { name: "范围配置", botConfigId: bot.id, credentialId: createCredential().id, region: "ap-guangzhou" };
  const legacy = alertStore.saveIntegration(input);
  assert.equal(legacy.namespace, "cvm_device");
  assert.throws(() => alertStore.saveIntegration({ ...input, policyScope: "selected", policyIds: [] }), /policy is required/);
  assert.throws(() => alertStore.saveIntegration({ ...input, policyScope: "all", policyIds: ["policy-1"] }), /Invalid policy scope/);
  assert.throws(() => alertStore.saveIntegration({ ...input, monitorType: "bad-source" }), /Invalid monitor type/);
  alertStore.updatePollState(legacy.id, { attemptedAt: 123, succeededAt: 123 });
  const unchanged = alertStore.saveIntegration({ ...input, name: "重命名" }, legacy.id);
  assert.equal(unchanged.lastSuccessAt, 123);
  const all = alertStore.saveIntegration({ ...input, namespace: "", policyScope: "all" }, legacy.id);
  assert.equal(all.namespace, "");
  assert.equal(all.lastSuccessAt, null);
  assert.equal(queryFor(all, 1, 100, 200).Namespaces, undefined);
  const apm = alertStore.saveIntegration({ ...input, monitorType: "MT_TAW" });
  assert.equal(apm.namespace, "");
  const cls = alertStore.saveIntegration({ ...input, monitorType: "MT_CLS", namespace: "cvm_device" });
  assert.equal(cls.namespace, "");
});

test("changing the execution Bot clears the old group binding", () => {
  const { bot, agent } = createPair();
  const input = { name: "推送配置", botConfigId: bot.id, credentialId: createCredential().id, region: "ap-guangzhou" };
  const saved = alertStore.saveIntegration(input);
  const bound = alertStore.bindChat(saved.bindCode, bot.id, "original-chat");
  assert.equal(alertStore.saveIntegration(input, saved.id).targetChatId, "original-chat");
  const second = registry.saveBot({ name: "Other Bot", botId: "other-bot", secret: "other-secret", cloudAgentId: agent.id });
  const updated = alertStore.saveIntegration({ ...input, botConfigId: second.id }, saved.id);
  assert.equal(updated.targetChatId, "");
  assert.notEqual(updated.bindCode, bound.bindCode);
  assert.throws(() => alertStore.bindChat(updated.bindCode, bot.id, "wrong-chat"), /不属于当前 Bot/);
});

test("a failed CLS history page does not advance the cursor and earlier records can be retried safely", async () => {
  const { bot } = createPair();
  const saved = alertStore.saveIntegration({ name: "CLS retry", botConfigId: bot.id, credentialId: createCredential().id,
    region: "ap-guangzhou", monitorType: "MT_CLS" });
  const integration = alertStore.getIntegration(saved.id, { secrets: true });
  const client = { describeAlertRecordHistory: async ({ Offset }) => {
    if (Offset) throw new Error("CLS unavailable");
    return { TotalCount: 101, Records: [{ RecordId: "partial-record", AlarmId: "policy", Status: 0 }] };
  } };
  await assert.rejects(pollIntegration(integration, { client }), /CLS unavailable/);
  assert.equal(alertStore.getIntegration(saved.id).lastSuccessAt, null);
  assert.equal(alertStore.listJobs().length, 1);
  await assert.rejects(pollIntegration(integration, { client }), /CLS unavailable/);
  assert.equal(alertStore.listJobs().length, 1);
});
