"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");

process.env.ADMIN_PASSWORD = "test-admin-password";
process.env.SQLITE_PATH = ":memory:";

const { db } = require("../src/database");
const registry = require("../src/registry");
const store = require("../src/store");

test.beforeEach(() => {
  db().exec("DELETE FROM tasks; DELETE FROM conversations; DELETE FROM wecom_bots; DELETE FROM cloud_agents; DELETE FROM api_keys;");
});

test("stores secrets locally but never exposes them through admin list APIs", () => {
  const agent = registry.saveAgent({
    name: "SRE Agent",
    agentId: "agent_01TEST",
    apiKey: "pt_secret_value",
  });
  const bot = registry.saveBot({
    name: "Ops Bot",
    botId: "aibot-test",
    secret: "wecom-secret",
    cloudAgentId: agent.id,
  });

  assert.equal(registry.listAgents()[0].apiKey, undefined);
  assert.equal(registry.listBots()[0].secret, undefined);
  assert.equal(registry.pairForBot(bot.id).agent.apiKey, "pt_secret_value");
  assert.equal(registry.pairForBot(bot.id).bot.secret, "wecom-secret");
  assert.equal(db().prepare("SELECT COUNT(DISTINCT cloud_agent_id) AS count FROM wecom_bots").get().count, 1);
  assert.equal(db().prepare("SELECT api_key_cipher FROM cloud_agents").get().api_key_cipher, "pt_secret_value");
  assert.equal(db().prepare("SELECT secret_cipher FROM wecom_bots").get().secret_cipher, "wecom-secret");
});

test("migrates an encrypted secret from the previous release on first use", () => {
  const key = Buffer.alloc(32, 9);
  const iv = Buffer.alloc(12, 7);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const encrypted = Buffer.concat([cipher.update("legacy-api-key", "utf8"), cipher.final()]);
  const legacyValue = ["v1", iv.toString("base64url"), cipher.getAuthTag().toString("base64url"), encrypted.toString("base64url")].join(":");
  const agent = registry.saveAgent({ name: "Legacy", agentId: "agent_LEGACY", apiKey: "temporary" });
  db().prepare("UPDATE cloud_agents SET api_key_cipher = ? WHERE id = ?").run(legacyValue, agent.id);
  process.env.CONFIG_ENCRYPTION_KEY = key.toString("base64");
  try {
    assert.equal(registry.getAgent(agent.id, { secrets: true }).apiKey, "legacy-api-key");
    assert.equal(db().prepare("SELECT api_key_cipher FROM cloud_agents WHERE id = ?").get(agent.id).api_key_cipher, "legacy-api-key");
  } finally {
    delete process.env.CONFIG_ENCRYPTION_KEY;
  }
});

test("an Agent may be reused but each Bot has exactly one selected Agent", () => {
  const first = registry.saveAgent({ name: "First", agentId: "agent_FIRST", apiKey: "pt_one" });
  const second = registry.saveAgent({ name: "Second", agentId: "agent_SECOND", apiKey: "pt_two" });
  const bot = registry.saveBot({ name: "Bot", botId: "bot-1", secret: "secret", cloudAgentId: first.id });
  registry.saveBot({ name: "Bot", botId: "bot-1", secret: "", cloudAgentId: second.id }, bot.id);
  assert.equal(registry.getBot(bot.id).cloudAgentId, second.id);
});

test("cannot delete an Agent while a Bot is paired to it", () => {
  const agent = registry.saveAgent({ name: "Agent", agentId: "agent_TEST", apiKey: "pt_one" });
  registry.saveBot({ name: "Bot", botId: "bot-1", secret: "secret", cloudAgentId: agent.id });
  assert.throws(() => registry.deleteAgent(agent.id), /still paired/);
});

test("stores API keys without exposing secrets and resolves agent credentials by reference", () => {
  const key = registry.saveKey({ name: "Enterprise Key", apiKey: "corp_secret_value" });
  assert.equal(registry.listKeys()[0].apiKey, undefined);
  assert.equal(registry.listKeys()[0].apiKeyConfigured, true);
  assert.equal(registry.getKey(key.id, { secrets: true }).apiKey, "corp_secret_value");

  const agent = registry.saveAgent({ name: "Ref Agent", agentId: "agent_REF", apiKeyConfigId: key.id });
  assert.equal(agent.apiKeyName, "Enterprise Key");
  assert.equal(registry.listAgents()[0].apiKey, undefined);

  const bot = registry.saveBot({ name: "Bot", botId: "bot-ref", secret: "secret", cloudAgentId: agent.id });
  assert.equal(registry.pairForBot(bot.id).agent.apiKey, "corp_secret_value");
  assert.equal(db().prepare("SELECT api_key_cipher FROM cloud_agents WHERE id = ?").get(agent.id).api_key_cipher, "");
});

test("requires either an API key reference or an inline key when saving an agent", () => {
  assert.throws(() => registry.saveAgent({ name: "NoKey", agentId: "agent_NOKEY" }), /API Key is required/);
  assert.throws(() => registry.saveAgent({ name: "BadRef", agentId: "agent_BADREF", apiKeyConfigId: "missing" }), /not found/);
});

test("rotating an API key value bumps the revision of referencing agents", () => {
  const key = registry.saveKey({ name: "Enterprise Key", apiKey: "corp_one" });
  const agent = registry.saveAgent({ name: "Ref Agent", agentId: "agent_ROT", apiKeyConfigId: key.id });
  const before = registry.getAgent(agent.id).revision;

  registry.saveKey({ name: "Enterprise Key", apiKey: "" }, key.id);
  assert.equal(registry.getAgent(agent.id).revision, before);
  assert.equal(registry.getKey(key.id, { secrets: true }).apiKey, "corp_one");

  registry.saveKey({ name: "Enterprise Key", apiKey: "corp_two" }, key.id);
  assert.equal(registry.getAgent(agent.id).revision, before + 1);
  assert.equal(registry.getKey(key.id, { secrets: true }).apiKey, "corp_two");
});

test("cannot delete an API key while a CloudAgent references it", () => {
  const key = registry.saveKey({ name: "Enterprise Key", apiKey: "corp_one" });
  registry.saveAgent({ name: "Ref Agent", agentId: "agent_DEL", apiKeyConfigId: key.id });
  assert.throws(() => registry.deleteKey(key.id), /still used/);
});

test("finds agents by business agent ID for pull-list de-duplication", () => {
  assert.equal(registry.findAgentByBusinessId("agent_MISSING"), undefined);
  const agent = registry.saveAgent({ name: "Agent", agentId: "agent_FIND", apiKey: "pt_one" });
  assert.equal(registry.findAgentByBusinessId("agent_FIND").id, agent.id);
});

test("redacts original message content after a task finishes", () => {
  const claimed = store.enqueueTask({
    botConfigId: "bot-config",
    cloudAgentId: "agent-config",
    conversationKey: "conversation",
    externalMsgId: "msg-1",
    frame: { headers: { req_id: "request" }, body: { text: { content: "sensitive" } } },
    command: "message",
    content: "sensitive",
  });
  store.updateTask(claimed.task.id, { status: "completed", answer: "done" });
  store.redactTask(claimed.task.id);
  const row = db().prepare("SELECT content,frame_json,answer FROM tasks WHERE id=?").get(claimed.task.id);
  assert.equal(row.content, "");
  assert.equal(row.frame_json, "{}");
  assert.equal(row.answer, "done");
});
