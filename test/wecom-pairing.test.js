"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

process.env.ADMIN_PASSWORD = "test-admin-password";
process.env.SQLITE_PATH = ":memory:";

const { db } = require("../src/database");
const registry = require("../src/registry");
const pairing = require("../src/wecom-pairing");

function jsonResponse(body, ok = true) {
  return { ok, json: async () => body };
}

test.beforeEach(() => {
  db().exec("DELETE FROM wma_tasks; DELETE FROM wma_conversations; DELETE FROM wecom_bots; DELETE FROM wma_agents;");
});

test("createSession returns the auth URL without exposing the scode", async () => {
  let capturedUrl;
  const fetchImpl = async (url) => {
    capturedUrl = url;
    return jsonResponse({ data: { scode: "scode-1", auth_url: "https://work.weixin.qq.com/ai/qc/auth?x=1" } });
  };
  const session = await pairing.createSession({ fetchImpl });
  assert.ok(session.pairingId);
  assert.equal(session.authUrl, "https://work.weixin.qq.com/ai/qc/auth?x=1");
  assert.ok(session.expiresAt > Date.now());
  assert.equal(session.scode, undefined);
  assert.match(capturedUrl, /^https:\/\/work\.weixin\.qq\.com\/ai\/qc\/generate\?source=/);
  assert.match(capturedUrl, /plat=3$/);
});

test("status stays pending until WeCom reports success, then returns botId without secret", async () => {
  const responses = [
    jsonResponse({ data: { scode: "scode-2", auth_url: "https://example.com/auth" } }),
    jsonResponse({ data: { status: "pending" } }),
    jsonResponse({ data: { status: "success", bot_info: { botid: "aib-1", secret: "topsecret", name: "扫码机器人" } } }),
  ];
  const fetchImpl = async () => responses.shift();
  const session = await pairing.createSession({ fetchImpl });

  const pending = await pairing.getSessionStatus(session.pairingId, { fetchImpl });
  assert.equal(pending.status, "pending");

  const paired = await pairing.getSessionStatus(session.pairingId, { fetchImpl });
  assert.equal(paired.status, "paired");
  assert.equal(paired.botId, "aib-1");
  assert.equal(paired.botName, "扫码机器人");
  assert.equal(paired.secret, undefined);
});

test("a transient polling error keeps the session pending", async () => {
  const session = await pairing.createSession({
    fetchImpl: async () => jsonResponse({ data: { scode: "s", auth_url: "u" } }),
  });
  const status = await pairing.getSessionStatus(session.pairingId, {
    fetchImpl: async () => { throw new Error("network down"); },
  });
  assert.equal(status.status, "pending");
});

test("unrecognized intermediate statuses keep polling instead of failing", async () => {
  const responses = [
    jsonResponse({ data: { scode: "s", auth_url: "u" } }),
    jsonResponse({ data: { status: "waiting_confirm" } }),
    jsonResponse({ data: {} }),
    jsonResponse({ data: { status: "success", bot_info: { botid: "aib-9", secret: "s9" } } }),
  ];
  const fetchImpl = async () => responses.shift();
  const session = await pairing.createSession({ fetchImpl });
  assert.equal((await pairing.getSessionStatus(session.pairingId, { fetchImpl })).status, "pending");
  assert.equal((await pairing.getSessionStatus(session.pairingId, { fetchImpl })).status, "pending");
  assert.equal((await pairing.getSessionStatus(session.pairingId, { fetchImpl })).status, "paired");
});

test("unknown or expired sessions report expired and completion is idempotent", async () => {
  assert.deepEqual(await pairing.getSessionStatus("missing"), { status: "expired" });
  const session = await pairing.createSession({
    fetchImpl: async () => jsonResponse({ data: { scode: "s", auth_url: "u" } }),
  });
  await pairing.getSessionStatus(session.pairingId, {
    fetchImpl: async () => jsonResponse({ data: { status: "success", bot_info: { botid: "aib-2", secret: "s2" } } }),
  });
  const credentials = pairing.completeSession(session.pairingId);
  assert.equal(credentials.botId, "aib-2");
  assert.equal(credentials.secret, "s2");
  assert.throws(() => pairing.completeSession(session.pairingId), /expired|not completed/);
});

test("completed pairing credentials create a working Bot pairing", async () => {
  const agent = registry.saveAgent({ credentialConfigId: registry.saveWmaCredential({ name: "WMA test", secretId: "AKID_test", secretKey: "test-secret" }).id, name: "SRE", agentId: "agent_SCAN", });
  const session = await pairing.createSession({
    fetchImpl: async () => jsonResponse({ data: { scode: "s", auth_url: "u" } }),
  });
  await pairing.getSessionStatus(session.pairingId, {
    fetchImpl: async () => jsonResponse({ data: { status: "success", bot_info: { botid: "aib-3", secret: "scan-secret" } } }),
  });
  const credentials = pairing.completeSession(session.pairingId);
  const bot = registry.saveBot({
    name: credentials.botName || "扫码创建的机器人",
    botId: credentials.botId,
    secret: credentials.secret,
    agentConfigId: agent.id,
  });
  const pair = registry.pairForBot(bot.id);
  assert.equal(pair.bot.secret, "scan-secret");
  assert.equal(pair.agent.secretKey, "test-secret");
});
