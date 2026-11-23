"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
process.env.ADMIN_PASSWORD = "test-admin-password";
process.env.SQLITE_PATH = ":memory:";
const { db } = require("../src/database");
const registry = require("../src/registry");
const alertStore = require("../src/alert-store");
const alertWorker = require("../src/alert-worker");
const notifier = require("../src/notifier");
const { AgentAdapter } = require("../src/agent");
const { credentialRedactor } = require("../src/alert-credentials");

const POLL_ID = "AKID_POLL_ONLY_EXAMPLE", POLL_KEY = "poll-only-secret-example";
const RUNTIME_ID = "AKID_RUNTIME_ONLY_EXAMPLE", RUNTIME_KEY = "runtime-only-secret-example";
function fixture({ embedded = false } = {}) {
  const polling = registry.saveTencentCredential({ name: "Poll", secretId: POLL_ID, secretKey: POLL_KEY });
  const runtime = registry.saveTencentCredential({ name: "WMA Runtime", secretId: RUNTIME_ID, secretKey: RUNTIME_KEY });
  const agent = registry.saveAgent({ credentialConfigId: registry.saveWmaCredential({ name: "WMA test", secretId: "AKID_test", secretKey: "test-secret" }).id, name: "SRE", agentId: "agent_DIAG" }, undefined,
    { runtimeVersion: embedded ? { runtimeCredentialId: runtime.id, runtimeRegion: "ap-guangzhou", wmaVersionId: "embedded-version", wmaVersionName: "凭证注入版", runtimeCredentialUpdatedAt: runtime.updatedAt } : null });
  const bot = registry.saveBot({ name: "RCA Bot", botId: "aibot-diag", secret: "test-bot-secret", agentConfigId: agent.id });
  return { agent, bot, polling, runtime, input: { name: "RCA", botConfigId: bot.id, credentialId: polling.id, region: "ap-guangzhou", promptTemplate: "诊断 {{alarm_content}}" } };
}
function queue(saved) {
  alertStore.bindChat(saved.bindCode, saved.botConfigId, "test-chat");
  return alertStore.enqueueHistory(saved.id, { AlarmId: "event-1", Content: "CPU > 80%" });
}
async function stubAgent(send, callback) {
  const originals = { create: AgentAdapter.prototype.createConversation, send: AgentAdapter.prototype.sendMessage, notify: notifier.sendMessage };
  const pushed = [];
  AgentAdapter.prototype.createConversation = async () => ({ sessionId: "session-test" });
  AgentAdapter.prototype.sendMessage = send;
  notifier.sendMessage = async (...args) => { pushed.push(args); };
  try { return await callback(pushed); }
  finally { AgentAdapter.prototype.createConversation = originals.create; AgentAdapter.prototype.sendMessage = originals.send; notifier.sendMessage = originals.notify; }
}
function assertNoCredentials(value) {
  const text = typeof value === "string" ? value : JSON.stringify(value);
  for (const credential of [POLL_ID, POLL_KEY, RUNTIME_ID, RUNTIME_KEY]) assert.equal(text.includes(credential), false);
}
test.beforeEach(() => db().exec("DELETE FROM alert_jobs; DELETE FROM alert_integrations; DELETE FROM wma_tasks; DELETE FROM wma_conversations; DELETE FROM wecom_bots; DELETE FROM wma_agents; DELETE FROM tencent_credentials;"));

test("RCA ignores retired diagnostic credential input and releases obsolete references", () => {
  const f = fixture(), saved = alertStore.saveIntegration({ ...f.input, diagnosticCredentialId: f.runtime.id });
  assert.equal(saved.diagnosticCredentialId, undefined); assert.equal(saved.diagnosticCredentialName, undefined);
  assert.equal(db().prepare("SELECT diagnostic_credential_id FROM alert_integrations WHERE id=?").get(saved.id).diagnostic_credential_id, null);
  assert.doesNotThrow(() => alertStore.saveIntegration({ ...f.input, diagnosticCredentialId: "missing" }, saved.id));
  db().prepare("UPDATE alert_integrations SET diagnostic_credential_id=? WHERE id=?").run(f.runtime.id, saved.id);
  registry.deleteTencentCredential(f.runtime.id);
  assert.equal(alertStore.getIntegration(saved.id).credentialId, f.polling.id);
  assert.throws(() => registry.deleteTencentCredential(f.polling.id), /still used/);
});

test("RCA uses the paired WMA version and sends no runtime or polling credentials in the prompt", async () => {
  const f = fixture({ embedded: true }), saved = alertStore.saveIntegration(f.input);
  queue(saved);
  await stubAgent(async function (_conversation, prompt, onDelta) {
    assert.equal(this.config.wmaVersionId, "embedded-version");
    assert.equal(prompt, "诊断 CPU > 80%"); assertNoCredentials(prompt);
    onDelta("结果"); return { stopReason: "end_turn" };
  }, async () => {
    await alertWorker.processPending();
    assert.equal(alertStore.listJobs()[0].status, "delivered");
    assert.equal(alertStore.listJobs()[0].prompt, "诊断 CPU > 80%");
  });
});

test("legacy queued RCA configuration cannot restore per-request credential injection", async () => {
  const f = fixture(), saved = alertStore.saveIntegration(f.input);
  db().prepare("UPDATE alert_integrations SET diagnostic_credential_id=? WHERE id=?").run(f.runtime.id, saved.id);
  queue(saved);
  await stubAgent(async (_conversation, prompt, onDelta) => {
    assert.equal(prompt, "诊断 CPU > 80%"); assertNoCredentials(prompt);
    onDelta("使用 Agent 环境");
  }, async () => {
    await alertWorker.processPending(); assert.equal(alertStore.listJobs()[0].status, "delivered");
  });
});

test("WMA runtime credentials remain redacted from RCA answers, history and pushed messages", async () => {
  const f = fixture({ embedded: true }); queue(alertStore.saveIntegration(f.input));
  await stubAgent(async (_conversation, prompt, onDelta) => {
    assertNoCredentials(prompt);
    onDelta(RUNTIME_KEY.slice(0, 8)); onDelta(RUNTIME_KEY.slice(8) + " " + RUNTIME_ID);
    return { stopReason: "end_turn" };
  }, async pushed => {
    await alertWorker.processPending();
    assert.equal(alertStore.listJobs()[0].answer, "[REDACTED] [REDACTED]");
    assertNoCredentials(alertStore.listJobs()); assertNoCredentials(pushed);
  });
});

test("alert diagnosis uses the paired Bot's thinking visibility", async () => {
  const f = fixture(); registry.saveBot({ ...f.bot, secret: "", showThinking: false }, f.bot.id);
  queue(alertStore.saveIntegration(f.input));
  await stubAgent(async (_conversation, _prompt, onDelta, options) => { assert.equal(options.showThinking, false); onDelta("最终诊断结果"); }, async pushed => {
    await alertWorker.processPending(); assert.equal(pushed[0][2], "最终诊断结果");
  });
});

test("SDK exceptions are scrubbed using WMA runtime credentials without sending them", async () => {
  const f = fixture({ embedded: true }); queue(alertStore.saveIntegration(f.input));
  const messages = [], originalError = console.error; console.error = (...args) => messages.push(args);
  try {
    await stubAgent(async (_conversation, prompt) => { assertNoCredentials(prompt); throw new Error(`request failed: ${RUNTIME_KEY}`); }, async () => {
      await alertWorker.processPending(); assert.equal(alertStore.listJobs()[0].status, "failed");
      assertNoCredentials(alertStore.listJobs()); assertNoCredentials(messages);
      assert.match(alertStore.listJobs()[0].error, /REDACTED/);
    });
  } finally { console.error = originalError; }
});

test("redaction handles multiple credentials and their escaped or encoded forms", () => {
  const credential = { secretId: RUNTIME_ID, secretKey: 'example-"quoted"-$value\nsecret' };
  const redact = credentialRedactor(credential, { secretId: POLL_ID, secretKey: POLL_KEY });
  for (const form of [credential.secretKey, JSON.stringify(credential.secretKey).slice(1, -1), encodeURIComponent(credential.secretKey), Buffer.from(credential.secretKey).toString("base64"), POLL_ID, POLL_KEY]) assert.equal(redact(form), "[REDACTED]");
});
