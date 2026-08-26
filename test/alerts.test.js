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
const { pollIntegration, queryFor } = require("../src/alert-poller");
const alertWorker = require("../src/alert-worker");
const { splitUtf8 } = require("../src/alert-worker");

function createPair() {
  const agent = registry.saveAgent({ name: "SRE", agentId: "agent_ALERT", apiKey: "pt_test" });
  const bot = registry.saveBot({ name: "Alert Bot", botId: "aibot-alert", secret: "bot-secret", cloudAgentId: agent.id });
  return { agent, bot };
}

test.beforeEach(() => {
  db().exec("DELETE FROM alert_jobs; DELETE FROM alert_integrations; DELETE FROM tasks; DELETE FROM conversations; DELETE FROM wecom_bots; DELETE FROM cloud_agents;");
});

test("alert integration hides credentials, binds one group, and deduplicates AlarmId", () => {
  const { bot } = createPair();
  const integration = alertStore.saveIntegration({
    name: "Production alarms",
    botConfigId: bot.id,
    secretId: "AKIDEXAMPLE",
    secretKey: "SECRETEXAMPLE",
    namespace: "cvm_device",
  });
  assert.equal(integration.secretId, undefined);
  assert.equal(alertStore.getIntegration(integration.id, { secrets: true }).secretKey, "SECRETEXAMPLE");
  const bound = alertStore.bindChat(integration.bindCode, bot.id, "chat-production");
  assert.equal(bound.targetChatId, "chat-production");
  const history = { AlarmId: "alarm-1", AlarmStatus: "ALARM", AlarmObject: "ins-1", FirstOccurTime: 100 };
  assert.equal(alertStore.enqueueHistory(integration.id, history).claimed, true);
  assert.equal(alertStore.enqueueHistory(integration.id, history).claimed, false);
  assert.equal(alertStore.nextJob().status, "analyzing");
});

test("alert polling can be paused and resumed without losing its group binding", () => {
  const { bot } = createPair();
  const saved = alertStore.saveIntegration({
    name: "Pausable polling", botConfigId: bot.id, secretId: "sid", secretKey: "skey",
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
  const integration = alertStore.saveIntegration({ name: "Bind me", botConfigId: bot.id, secretId: "sid", secretKey: "skey" });
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
});

test("poller pages through alarm history and advances its cursor after enqueue", async () => {
  const { bot } = createPair();
  const saved = alertStore.saveIntegration({ name: "Polling", botConfigId: bot.id, secretId: "sid", secretKey: "skey" });
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
