"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { DatabaseSync } = require("node:sqlite");
const { serverConfig } = require("./config");

let database;

function db() {
  if (database) return database;
  const filename = serverConfig().sqlitePath;
  if (filename !== ":memory:") fs.mkdirSync(path.dirname(path.resolve(filename)), { recursive: true });
  database = new DatabaseSync(filename);
  database.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA foreign_keys = ON;
    PRAGMA busy_timeout = 5000;

    CREATE TABLE IF NOT EXISTS api_keys (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      api_key_cipher TEXT NOT NULL,
      base_url TEXT NOT NULL DEFAULT 'https://www.codebuddy.cn/v2/agentos',
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS cloud_agents (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      business_agent_id TEXT NOT NULL,
      api_key_cipher TEXT NOT NULL,
      base_url TEXT NOT NULL,
      source_app TEXT NOT NULL,
      runtime_name_prefix TEXT NOT NULL,
      manifest_version TEXT NOT NULL,
      manifest_json TEXT NOT NULL,
      control_timeout_ms INTEGER NOT NULL,
      prompt_timeout_ms INTEGER NOT NULL,
      include_thinking INTEGER NOT NULL DEFAULT 0,
      log_level TEXT NOT NULL DEFAULT 'warn',
      revision INTEGER NOT NULL DEFAULT 1,
      api_key_config_id TEXT REFERENCES api_keys(id) ON DELETE RESTRICT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS wecom_bots (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      bot_id TEXT NOT NULL UNIQUE,
      secret_cipher TEXT NOT NULL,
      cloud_agent_id TEXT NOT NULL REFERENCES cloud_agents(id) ON DELETE RESTRICT,
      enabled INTEGER NOT NULL DEFAULT 1,
      show_thinking INTEGER NOT NULL DEFAULT 1,
      welcome_text TEXT NOT NULL,
      placeholder TEXT NOT NULL,
      group_session_scope TEXT NOT NULL DEFAULT 'chat',
      ws_url TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS conversations (
      conversation_key TEXT PRIMARY KEY,
      bot_config_id TEXT NOT NULL,
      cloud_agent_id TEXT NOT NULL,
      agent_revision INTEGER NOT NULL,
      runtime_id TEXT NOT NULL,
      session_id TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS tasks (
      id TEXT PRIMARY KEY,
      bot_config_id TEXT NOT NULL,
      cloud_agent_id TEXT NOT NULL,
      conversation_key TEXT NOT NULL,
      external_msg_id TEXT NOT NULL,
      frame_json TEXT NOT NULL,
      stream_id TEXT NOT NULL,
      command TEXT NOT NULL,
      content TEXT NOT NULL,
      status TEXT NOT NULL,
      answer TEXT NOT NULL DEFAULT '',
      error TEXT,
      runtime_id TEXT,
      session_id TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      UNIQUE(bot_config_id, external_msg_id)
    );

    CREATE TABLE IF NOT EXISTS tencent_credentials (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      secret_id TEXT NOT NULL,
      secret_key TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS alert_integrations (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      bot_config_id TEXT NOT NULL REFERENCES wecom_bots(id) ON DELETE RESTRICT,
      secret_id TEXT NOT NULL,
      secret_key TEXT NOT NULL,
      region TEXT,
      monitor_type TEXT NOT NULL DEFAULT 'MT_QCE',
      namespace TEXT NOT NULL DEFAULT 'cvm_device',
      policy_ids_json TEXT NOT NULL DEFAULT '[]',
      poll_interval_seconds INTEGER NOT NULL DEFAULT 60,
      initial_lookback_seconds INTEGER NOT NULL DEFAULT 600,
      overlap_seconds INTEGER NOT NULL DEFAULT 300,
      prompt_template TEXT NOT NULL DEFAULT '',
      include_recovery INTEGER NOT NULL DEFAULT 0,
      enabled INTEGER NOT NULL DEFAULT 1,
      bind_code TEXT NOT NULL UNIQUE,
      target_chat_id TEXT,
      target_chat_name TEXT,
      last_attempt_at INTEGER,
      last_success_at INTEGER,
      last_error TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS alert_jobs (
      id TEXT PRIMARY KEY,
      integration_id TEXT NOT NULL REFERENCES alert_integrations(id) ON DELETE CASCADE,
      event_key TEXT NOT NULL,
      alarm_id TEXT NOT NULL,
      alarm_status TEXT NOT NULL,
      first_occur_time INTEGER,
      payload_json TEXT NOT NULL,
      prompt TEXT NOT NULL DEFAULT '',
      answer TEXT NOT NULL DEFAULT '',
      runtime_id TEXT,
      session_id TEXT,
      status TEXT NOT NULL DEFAULT 'queued',
      attempt_count INTEGER NOT NULL DEFAULT 0,
      next_attempt_at INTEGER NOT NULL DEFAULT 0,
      error TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      UNIQUE(integration_id, event_key)
    );

    CREATE INDEX IF NOT EXISTS idx_tasks_conversation_status
      ON tasks(conversation_key, status, created_at);
    CREATE INDEX IF NOT EXISTS idx_tasks_updated_at ON tasks(updated_at);
    CREATE INDEX IF NOT EXISTS idx_alert_integrations_due
      ON alert_integrations(enabled, last_attempt_at);
    CREATE INDEX IF NOT EXISTS idx_alert_jobs_status
      ON alert_jobs(status, next_attempt_at, created_at);

    CREATE TABLE IF NOT EXISTS alert_job_attachments (
      job_id TEXT NOT NULL REFERENCES alert_jobs(id) ON DELETE CASCADE,
      ordinal INTEGER NOT NULL,
      filename TEXT NOT NULL,
      content BLOB NOT NULL,
      sent_at INTEGER,
      PRIMARY KEY(job_id, ordinal)
    );
  `);
  const agentColumns = database.prepare("PRAGMA table_info(cloud_agents)").all().map((column) => column.name);
  if (!agentColumns.includes("api_key_config_id")) {
    database.exec("ALTER TABLE cloud_agents ADD COLUMN api_key_config_id TEXT REFERENCES api_keys(id) ON DELETE RESTRICT");
  }
  const botColumns = database.prepare("PRAGMA table_info(wecom_bots)").all().map((column) => column.name);
  if (!botColumns.includes("show_thinking")) {
    database.exec("ALTER TABLE wecom_bots ADD COLUMN show_thinking INTEGER NOT NULL DEFAULT 1");
  }
  const alertColumns = database.prepare("PRAGMA table_info(alert_integrations)").all().map((column) => column.name);
  if (!alertColumns.includes("credential_id")) {
    database.exec("ALTER TABLE alert_integrations ADD COLUMN credential_id TEXT REFERENCES tencent_credentials(id) ON DELETE RESTRICT");
    migrateInlineTencentCredentials(database);
  }
  if (!alertColumns.includes("diagnostic_credential_id")) {
    database.exec("ALTER TABLE alert_integrations ADD COLUMN diagnostic_credential_id TEXT REFERENCES tencent_credentials(id) ON DELETE RESTRICT");
  }
  const jobColumns = database.prepare("PRAGMA table_info(alert_jobs)").all().map((column) => column.name);
  if (!jobColumns.includes("text_delivered")) database.exec("ALTER TABLE alert_jobs ADD COLUMN text_delivered INTEGER NOT NULL DEFAULT 0");
  if (!jobColumns.includes("attachment_error")) database.exec("ALTER TABLE alert_jobs ADD COLUMN attachment_error TEXT NOT NULL DEFAULT ''");
  return database;
}

// Legacy alert integrations stored Tencent Cloud AK/SK inline. Group them by
// SecretId, create one credential per group, and backfill credential_id.
function migrateInlineTencentCredentials(database) {
  const rows = database.prepare(`
    SELECT DISTINCT secret_id, secret_key FROM alert_integrations
    WHERE credential_id IS NULL AND secret_id != ''
  `).all();
  for (const row of rows) {
    const id = crypto.randomUUID();
    const masked = row.secret_id.length > 10
      ? `${row.secret_id.slice(0, 6)}****${row.secret_id.slice(-4)}`
      : row.secret_id;
    const now = Date.now();
    database.prepare(`
      INSERT INTO tencent_credentials (id, name, secret_id, secret_key, created_at, updated_at)
      VALUES (?,?,?,?,?,?)
    `).run(id, `迁移凭证 ${masked}`, row.secret_id, row.secret_key, now, now);
    database.prepare("UPDATE alert_integrations SET credential_id=? WHERE credential_id IS NULL AND secret_id=?")
      .run(id, row.secret_id);
  }
}

function closeDatabase() {
  if (!database) return;
  database.close();
  database = undefined;
}

module.exports = { closeDatabase, db };
