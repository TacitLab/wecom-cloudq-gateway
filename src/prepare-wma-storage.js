"use strict";

// One-time schema cutover for retained Bot/alert settings. No Agent definitions,
// credentials or sessions are imported from the retired Agent storage.
function prepareBotBindings(database) {
  const columns = database.prepare("PRAGMA table_info(wecom_bots)").all().map((column) => column.name);
  if (columns.includes("agent_config_id") && columns.includes("secret")) return;
  database.exec("PRAGMA foreign_keys = OFF");
  database.exec("BEGIN IMMEDIATE");
  try {
    database.exec(`
      CREATE TABLE wma_bots_cutover (
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
      INSERT INTO wma_bots_cutover
        (id,name,bot_id,secret,agent_config_id,enabled,show_thinking,welcome_text,placeholder,group_session_scope,ws_url,created_at,updated_at)
      SELECT id,name,bot_id,secret_cipher,NULL,enabled,show_thinking,welcome_text,placeholder,group_session_scope,ws_url,created_at,updated_at
      FROM wecom_bots;
      DROP TABLE wecom_bots;
      ALTER TABLE wma_bots_cutover RENAME TO wecom_bots;
      UPDATE alert_jobs SET status='failed',error='Agent storage reset; rebind the Bot to a WMA Agent before retrying'
      WHERE status IN ('queued','analyzing','delivery_pending','delivering');
    `);
    if (database.prepare("PRAGMA foreign_key_check").all().length) throw new Error("WMA storage cutover failed foreign key validation");
    database.exec("COMMIT");
  } catch (error) {
    database.exec("ROLLBACK");
    throw error;
  } finally { database.exec("PRAGMA foreign_keys = ON"); }
}

module.exports = { prepareBotBindings };
