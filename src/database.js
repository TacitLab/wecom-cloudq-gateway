"use strict";

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

    CREATE TABLE IF NOT EXISTS wma_credentials (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      secret_id TEXT NOT NULL,
      secret_key TEXT NOT NULL,
      region TEXT NOT NULL DEFAULT 'ap-guangzhou',
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS wma_agents (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      business_agent_id TEXT NOT NULL,
      credential_config_id TEXT NOT NULL REFERENCES wma_credentials(id) ON DELETE RESTRICT,
      control_timeout_ms INTEGER NOT NULL DEFAULT 30000,
      prompt_timeout_ms INTEGER NOT NULL DEFAULT 1200000,
      include_thinking INTEGER NOT NULL DEFAULT 0,
      revision INTEGER NOT NULL DEFAULT 1,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      UNIQUE(credential_config_id, business_agent_id)
    );

    CREATE TABLE IF NOT EXISTS wecom_bots (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      bot_id TEXT NOT NULL UNIQUE,
      secret TEXT NOT NULL,
      agent_config_id TEXT REFERENCES wma_agents(id) ON DELETE RESTRICT,
      enabled INTEGER NOT NULL DEFAULT 1,
      show_thinking INTEGER NOT NULL DEFAULT 1,
      welcome_text TEXT NOT NULL,
      placeholder TEXT NOT NULL,
      group_session_scope TEXT NOT NULL DEFAULT 'chat',
      ws_url TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS wma_conversations (
      conversation_key TEXT PRIMARY KEY,
      bot_config_id TEXT NOT NULL,
      agent_config_id TEXT NOT NULL,
      agent_revision INTEGER NOT NULL,
      session_id TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS wma_tasks (
      id TEXT PRIMARY KEY,
      bot_config_id TEXT NOT NULL,
      agent_config_id TEXT NOT NULL,
      conversation_key TEXT NOT NULL,
      external_msg_id TEXT NOT NULL,
      frame_json TEXT NOT NULL,
      stream_id TEXT NOT NULL,
      command TEXT NOT NULL,
      content TEXT NOT NULL,
      status TEXT NOT NULL,
      answer TEXT NOT NULL DEFAULT '',
      error TEXT,
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
      credential_id TEXT REFERENCES tencent_credentials(id) ON DELETE RESTRICT,
      diagnostic_credential_id TEXT REFERENCES tencent_credentials(id) ON DELETE RESTRICT,
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
      session_id TEXT,
      text_delivered INTEGER NOT NULL DEFAULT 0,
      attachment_error TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'queued',
      attempt_count INTEGER NOT NULL DEFAULT 0,
      next_attempt_at INTEGER NOT NULL DEFAULT 0,
      error TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      UNIQUE(integration_id, event_key)
    );

    CREATE INDEX IF NOT EXISTS idx_wma_tasks_conversation_status
      ON wma_tasks(conversation_key, status, created_at);
    CREATE INDEX IF NOT EXISTS idx_wma_tasks_updated_at ON wma_tasks(updated_at);
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
  require("./prepare-wma-storage").prepareBotBindings(database);
  return database;
}

function closeDatabase() {
  if (!database) return;
  database.close();
  database = undefined;
}

module.exports = { closeDatabase, db };
