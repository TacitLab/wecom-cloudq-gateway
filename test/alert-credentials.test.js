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
const { CloudAgentAdapter } = require("../src/cloudagent");
const { adapterFor } = require("../src/worker");
const { credentialRedactor, withDiagnosticCredential } = require("../src/alert-credentials");

const POLL_ID = "AKID_POLL_ONLY_EXAMPLE";
const POLL_KEY = "poll-only-secret-example";
const DIAG_ID = "AKID_DIAG_ONLY_EXAMPLE";
const DIAG_KEY = "diag-only-secret-example";

function fixture() {
  const agent = registry.saveAgent({ name: "SRE", agentId: "agent_DIAG", apiKey: "test-api-key", logLevel: "debug" });
  const bot = registry.saveBot({ name: "RCA Bot", botId: "aibot-diag", secret: "test-bot-secret", cloudAgentId: agent.id });
  const polling = registry.saveTencentCredential({ name: "Poll", secretId: POLL_ID, secretKey: POLL_KEY });
  const diagnostic = registry.saveTencentCredential({ name: "CloudQ", secretId: DIAG_ID, secretKey: DIAG_KEY });
  const input = { name: "RCA", botConfigId: bot.id, credentialId: polling.id, region: "ap-guangzhou", promptTemplate: "诊断 {{alarm_content}}" };
  return { agent, bot, polling, diagnostic, input };
}

function queue(saved) {
  alertStore.bindChat(saved.bindCode, saved.botConfigId, "test-chat");
  return alertStore.enqueueHistory(saved.id, { AlarmId: "event-1", Content: "CPU > 80%" });
}

async function stubAgent(send, callback) {
  const originals = { create: CloudAgentAdapter.prototype.createConversation, send: CloudAgentAdapter.prototype.sendMessage, notify: notifier.sendMessage };
  const pushed = [];
  CloudAgentAdapter.prototype.createConversation = async () => ({ runtimeId: "runtime-test", sessionId: "session-test" });
  CloudAgentAdapter.prototype.sendMessage = send;
  notifier.sendMessage = async (...args) => { pushed.push(args); };
  try { return await callback(pushed); }
  finally {
    CloudAgentAdapter.prototype.createConversation = originals.create;
    CloudAgentAdapter.prototype.sendMessage = originals.send;
    notifier.sendMessage = originals.notify;
  }
}

function assertNoCredentials(value, credentials = [DIAG_ID, DIAG_KEY]) {
  const text = typeof value === "string" ? value : JSON.stringify(value);
  for (const credential of credentials) assert.equal(text.includes(credential), false, "credential value must be absent");
}

test.beforeEach(() => {
  db().exec("DELETE FROM alert_jobs; DELETE FROM alert_integrations; DELETE FROM tasks; DELETE FROM conversations; DELETE FROM wecom_bots; DELETE FROM cloud_agents; DELETE FROM tencent_credentials;");
});

test("diagnosis credentials are optional, independent of polling, and only their reference is exposed", () => {
  const { input, diagnostic } = fixture();
  const saved = alertStore.saveIntegration(input);
  assert.equal(saved.diagnosticCredentialId, null);
  const configured = alertStore.saveIntegration({ ...input, diagnosticCredentialId: diagnostic.id }, saved.id);
  assert.equal(configured.diagnosticCredentialName, "CloudQ");
  assertNoCredentials(alertStore.listIntegrations());
  assert.equal(alertStore.saveIntegration(input, saved.id).diagnosticCredentialId, diagnostic.id);
  assert.throws(() => registry.deleteTencentCredential(diagnostic.id), /still used/);
  assert.throws(() => alertStore.saveIntegration({ ...input, diagnosticCredentialId: "missing" }), /diagnostic credential not found/);
  assert.equal(alertStore.saveIntegration({ ...input, diagnosticCredentialId: null }, saved.id).diagnosticCredentialId, null);
  registry.deleteTencentCredential(diagnostic.id);
});

test("no selection sends only the diagnostic prompt and never reuses polling credentials", async () => {
  const { input } = fixture();
  const saved = alertStore.saveIntegration(input);
  queue(saved);
  await stubAgent(async function (_conversation, prompt, onDelta) {
    assert.equal(prompt, "诊断 CPU > 80%");
    assertNoCredentials(prompt, [POLL_ID, POLL_KEY, DIAG_ID, DIAG_KEY]);
    onDelta("结果");
  }, async () => {
    await alertWorker.processPending();
    assert.equal(alertStore.listJobs()[0].status, "delivered");
  });
});

test("only runtime requests contain current diagnosis credentials; history, replies and SDK logging stay redacted", async () => {
  const { input, diagnostic } = fixture();
  const saved = alertStore.saveIntegration({ ...input, diagnosticCredentialId: diagnostic.id });
  queue(saved);
  const rotatedId = "AKID_ROTATED_DIAG_EXAMPLE";
  const rotatedKey = "rotated-diag-secret-example";
  registry.saveTencentCredential({ name: "CloudQ rotated", secretId: rotatedId, secretKey: rotatedKey }, diagnostic.id);
  await stubAgent(async function (_conversation, prompt, onDelta) {
    assert.equal(this.config.logLevel, "off");
    const json = JSON.parse(prompt.slice(prompt.indexOf('{\n')));
    assert.deepEqual(json, { TENCENTCLOUD_SECRET_ID: rotatedId, TENCENTCLOUD_SECRET_KEY: rotatedKey, TENCENTCLOUD_REGION: "ap-guangzhou" });
    assertNoCredentials(prompt, [POLL_ID, POLL_KEY, DIAG_ID, DIAG_KEY]);
    onDelta(rotatedKey.slice(0, 8));
    onDelta(rotatedKey.slice(8) + " " + rotatedId);
    return { stopReason: rotatedKey };
  }, async (pushed) => {
    await alertWorker.processPending();
    const jobs = alertStore.listJobs();
    assert.equal(jobs[0].status, "delivered");
    assert.match(jobs[0].prompt, /运行时凭证已注入/);
    assert.equal(jobs[0].answer, "[REDACTED] [REDACTED]");
    assertNoCredentials(jobs, [rotatedId, rotatedKey, DIAG_ID, DIAG_KEY]);
    assertNoCredentials(pushed, [rotatedId, rotatedKey]);
    assert.equal(alertStore.getIntegration(saved.id).promptTemplate, input.promptTemplate);
  });
});

test("SDK exceptions containing the runtime prompt are scrubbed before job errors and local logs", async () => {
  const { input, diagnostic } = fixture();
  const saved = alertStore.saveIntegration({ ...input, diagnosticCredentialId: diagnostic.id });
  queue(saved);
  const messages = [];
  const originalError = console.error;
  console.error = (...args) => messages.push(args);
  try {
    await stubAgent(async (_conversation, prompt) => { throw new Error(`request failed: ${prompt}`); }, async () => {
      await alertWorker.processPending();
      const jobs = alertStore.listJobs();
      assert.equal(jobs[0].status, "failed");
      assertNoCredentials(jobs);
      assertNoCredentials(messages);
      assert.match(jobs[0].error, /REDACTED/);
    });
  } finally { console.error = originalError; }
});

test("sensitive SDK clients use a separate quiet adapter without changing ordinary chats", () => {
  const { agent } = fixture();
  const agentWithSecrets = registry.getAgent(agent.id, { secrets: true });
  const regular = adapterFor(agentWithSecrets);
  const sensitive = adapterFor(agentWithSecrets, { sensitive: true });
  assert.notEqual(regular, sensitive);
  assert.equal(regular.config.logLevel, "debug");
  assert.equal(sensitive.config.logLevel, "off");
});

test("runtime credential blocks remain JSON data and redaction handles escaped and encoded values", () => {
  const credential = { secretId: DIAG_ID, secretKey: 'example-"quoted"-$value\nsecret' };
  const prompt = withDiagnosticCredential("诊断", credential, "ap-shanghai");
  assert.deepEqual(JSON.parse(prompt.slice(prompt.indexOf('{\n'))), {
    TENCENTCLOUD_SECRET_ID: DIAG_ID, TENCENTCLOUD_SECRET_KEY: credential.secretKey, TENCENTCLOUD_REGION: "ap-shanghai",
  });
  const redact = credentialRedactor(credential);
  const forms = [credential.secretKey, JSON.stringify(credential.secretKey).slice(1, -1), encodeURIComponent(credential.secretKey), Buffer.from(credential.secretKey).toString("base64")];
  for (const form of forms) assert.equal(redact(form), "[REDACTED]");
  assert.equal(withDiagnosticCredential("plain", null, "ap-shanghai"), "plain");
});
