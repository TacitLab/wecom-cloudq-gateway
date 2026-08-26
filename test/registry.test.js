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
  db().exec("DELETE FROM tasks; DELETE FROM conversations; DELETE FROM wecom_bots; DELETE FROM cloud_agents;");
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
