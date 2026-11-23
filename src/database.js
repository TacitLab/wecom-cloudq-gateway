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

    CREATE TABLE IF NOT EXISTS architecture_watches (
      id TEXT PRIMARY KEY,
      credential_id TEXT NOT NULL REFERENCES tencent_credentials(id) ON DELETE RESTRICT,
      arch_id TEXT NOT NULL,
      arch_name TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      version_name TEXT NOT NULL DEFAULT '',
      created_at INTEGER NOT NULL,
      UNIQUE(credential_id, arch_id)
    );

    CREATE TABLE IF NOT EXISTS architecture_watch_settings (
      watch_id TEXT PRIMARY KEY REFERENCES architecture_watches(id) ON DELETE CASCADE,
      enabled INTEGER NOT NULL DEFAULT 0,
      bot_config_id TEXT REFERENCES wecom_bots(id) ON DELETE RESTRICT,
      diagnostic_credential_id TEXT REFERENCES tencent_credentials(id) ON DELETE RESTRICT,
      bind_code TEXT NOT NULL UNIQUE,
      target_chat_id TEXT,
      target_chat_name TEXT,
      config_json TEXT NOT NULL DEFAULT '{}',
      revision INTEGER NOT NULL DEFAULT 1,
      last_attempt_at INTEGER,
      last_success_at INTEGER,
      last_error TEXT,
      updated_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS architecture_watch_events (
      id TEXT PRIMARY KEY,
      watch_id TEXT NOT NULL REFERENCES architecture_watches(id) ON DELETE CASCADE,
      event_key TEXT NOT NULL,
      type TEXT NOT NULL,
      title TEXT NOT NULL,
      resource_id TEXT NOT NULL,
      product TEXT NOT NULL,
      region TEXT NOT NULL,
      payload_json TEXT NOT NULL,
      destination_json TEXT NOT NULL,
      rca_enabled INTEGER NOT NULL DEFAULT 0,
      notified_at INTEGER,
      analysis_status TEXT NOT NULL DEFAULT 'pending',
      analysis TEXT NOT NULL DEFAULT '',
      analysis_parts_sent INTEGER NOT NULL DEFAULT 0,
      analysis_messages_json TEXT,
      completed_at INTEGER,
      attempts INTEGER NOT NULL DEFAULT 0,
      next_attempt_at INTEGER NOT NULL DEFAULT 0,
      error TEXT,
      created_at INTEGER NOT NULL,
      UNIQUE(watch_id,event_key)
    );
    CREATE INDEX IF NOT EXISTS idx_architecture_watch_events_queue ON architecture_watch_events(completed_at,next_attempt_at,created_at);
    CREATE TABLE IF NOT EXISTS architecture_watch_signals (
      watch_id TEXT NOT NULL REFERENCES architecture_watches(id) ON DELETE CASCADE,
      signal_key TEXT NOT NULL,
      active INTEGER NOT NULL DEFAULT 0,
      last_timestamp INTEGER NOT NULL,
      PRIMARY KEY(watch_id,signal_key)
    );
    CREATE TABLE IF NOT EXISTS architecture_watch_checks (
      id TEXT PRIMARY KEY,
      watch_id TEXT NOT NULL REFERENCES architecture_watches(id) ON DELETE CASCADE,
      summary_json TEXT NOT NULL,
      error TEXT,
      created_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS architecture_capacity_signals (
      watch_id TEXT NOT NULL REFERENCES architecture_watches(id) ON DELETE CASCADE,
      signal_key TEXT NOT NULL,
      episode_id TEXT NOT NULL,
      active INTEGER NOT NULL DEFAULT 1,
      first_seen_at INTEGER NOT NULL,
      last_seen_at INTEGER NOT NULL,
      last_report_at INTEGER NOT NULL,
      last_notified_at INTEGER,
      reminder_stage INTEGER NOT NULL DEFAULT 0,
      last_event_id TEXT,
      PRIMARY KEY(watch_id,signal_key)
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
  // RCA now inherits the paired WMA version environment. Retain the nullable
  // legacy columns for compatibility, but release obsolete credential links.
  database.exec(`
    UPDATE alert_integrations SET diagnostic_credential_id=NULL WHERE diagnostic_credential_id IS NOT NULL;
    UPDATE architecture_watch_settings SET diagnostic_credential_id=NULL WHERE diagnostic_credential_id IS NOT NULL;
    UPDATE architecture_watch_events SET destination_json=json_remove(destination_json,'$.diagnosticCredentialId')
      WHERE json_type(destination_json,'$.diagnosticCredentialId') IS NOT NULL;
  `);
  // Persist RCA message boundaries so delivery retries keep the same context.
  if (!database.prepare("PRAGMA table_info(architecture_watch_events)").all().some(column => column.name === "analysis_messages_json")) {
    database.exec("ALTER TABLE architecture_watch_events ADD COLUMN analysis_messages_json TEXT");
  }
  // Additive migration: existing Agents continue to follow the WMA route.
  const agentColumns = new Set(database.prepare("PRAGMA table_info(wma_agents)").all().map((column) => column.name));
  for (const [name, definition] of Object.entries({
    runtime_credential_id: "TEXT REFERENCES tencent_credentials(id) ON DELETE RESTRICT",
    runtime_region: "TEXT",
    wma_version_id: "TEXT",
    wma_version_name: "TEXT",
    runtime_credential_updated_at: "INTEGER",
  })) {
    if (!agentColumns.has(name)) database.exec(`ALTER TABLE wma_agents ADD COLUMN ${name} ${definition}`);
  }
  database.exec(`
    CREATE TABLE IF NOT EXISTS wma_credential_versions (
      credential_config_id TEXT NOT NULL REFERENCES wma_credentials(id) ON DELETE CASCADE,
      business_agent_id TEXT NOT NULL,
      version_id TEXT NOT NULL,
      version_name TEXT NOT NULL,
      source_version_id TEXT,
      source_version_name TEXT,
      runtime_credential_id TEXT,
      runtime_credential_name TEXT NOT NULL,
      runtime_region TEXT NOT NULL,
      runtime_credential_updated_at INTEGER NOT NULL,
      created_at INTEGER NOT NULL,
      PRIMARY KEY (credential_config_id,business_agent_id,version_id)
    );
    INSERT OR IGNORE INTO wma_credential_versions
      (credential_config_id,business_agent_id,version_id,version_name,runtime_credential_id,runtime_credential_name,runtime_region,runtime_credential_updated_at,created_at)
    SELECT a.credential_config_id,a.business_agent_id,a.wma_version_id,COALESCE(a.wma_version_name,''),
      a.runtime_credential_id,c.name,COALESCE(a.runtime_region,'ap-guangzhou'),COALESCE(a.runtime_credential_updated_at,c.updated_at),a.updated_at
    FROM wma_agents a JOIN tencent_credentials c ON c.id=a.runtime_credential_id
    WHERE a.wma_version_id IS NOT NULL;
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
