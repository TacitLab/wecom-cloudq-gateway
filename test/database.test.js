"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

process.env.ADMIN_PASSWORD = "test-admin-password";
const directory = fs.mkdtempSync(path.join(os.tmpdir(), "gateway-migration-"));
process.env.SQLITE_PATH = path.join(directory, "gateway.db");
const { db, closeDatabase } = require("../src/database");
const registry = require("../src/registry");

test.after(() => {
  closeDatabase();
  fs.rmSync(directory, { recursive: true, force: true });
});

test("upgrades existing Bot configurations with thinking visible by default", () => {
  const agent = registry.saveAgent({ name: "Agent", agentId: "agent_MIGRATE", apiKey: "pt_test" });
  const bot = registry.saveBot({ name: "Legacy Bot", botId: "legacy", secret: "secret", cloudAgentId: agent.id });
  db().exec("ALTER TABLE wecom_bots DROP COLUMN show_thinking");
  closeDatabase();
  assert.equal(registry.getBot(bot.id).showThinking, true);
  registry.saveBot({ ...bot, secret: "", showThinking: false }, bot.id);
  closeDatabase();
  assert.equal(registry.getBot(bot.id).showThinking, false);
});
