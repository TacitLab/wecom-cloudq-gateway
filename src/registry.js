"use strict";

const crypto = require("node:crypto");
const { db } = require("./database");

function text(value, label, { required = true, max = 500 } = {}) {
  const result = String(value ?? "").trim();
  if (required && !result) throw new Error(`${label} is required`);
  if (result.length > max) throw new Error(`${label} is too long`);
  return result;
}

function positiveInteger(value, fallback, label) {
  const result = value === undefined || value === "" ? fallback : Number.parseInt(value, 10);
  if (!Number.isFinite(result) || result <= 0) throw new Error(`${label} must be a positive integer`);
  return result;
}

function legacyEncryptionKey() {
  const raw = process.env.CONFIG_ENCRYPTION_KEY?.trim() || "";
  const key = /^[0-9a-f]{64}$/i.test(raw) ? Buffer.from(raw, "hex") : Buffer.from(raw, "base64");
  if (key.length !== 32) {
    throw new Error("This database contains secrets from an encrypted older version. Temporarily set its original CONFIG_ENCRYPTION_KEY once to migrate them to plaintext");
  }
  return key;
}

function decryptLegacySecret(value) {
  const [version, iv, tag, encrypted] = String(value || "").split(":");
  if (version !== "v1" || !iv || !tag || !encrypted) throw new Error("Invalid encrypted secret");
  const decipher = crypto.createDecipheriv("aes-256-gcm", legacyEncryptionKey(), Buffer.from(iv, "base64url"));
  decipher.setAuthTag(Buffer.from(tag, "base64url"));
  return Buffer.concat([decipher.update(Buffer.from(encrypted, "base64url")), decipher.final()]).toString("utf8");
}

function storedSecret(row, table, column) {
  const value = String(row[column] || "");
  if (!value.startsWith("v1:")) return value;
  const plaintext = decryptLegacySecret(value);
  db().prepare(`UPDATE ${table} SET ${column} = ? WHERE id = ?`).run(plaintext, row.id);
  return plaintext;
}

function parseManifest(value) {
  if (value == null || value === "") return {};
  const parsed = typeof value === "string" ? JSON.parse(value) : value;
  if (!parsed || Array.isArray(parsed) || typeof parsed !== "object") throw new Error("Manifest must be a JSON object");
  return parsed;
}

function maskSecret(value) {
  const key = String(value || "");
  if (!key) return "";
  if (key.length <= 10) return "****" + key.slice(-2);
  return key.slice(0, 6) + "****" + key.slice(-4);
}

function keyFromRow(row, { secrets = false } = {}) {
  if (!row) return undefined;
  return {
    id: row.id,
    name: row.name,
    ...(secrets
      ? { apiKey: storedSecret(row, "api_keys", "api_key_cipher") }
      : { apiKeyConfigured: true, apiKeyMasked: maskSecret(storedSecret(row, "api_keys", "api_key_cipher")) }),
    baseUrl: row.base_url,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function resolveAgentApiKey(row, secrets) {
  if (row.api_key_config_id) {
    if (!secrets) return undefined;
    const keyRow = db().prepare("SELECT * FROM api_keys WHERE id = ?").get(row.api_key_config_id);
    return storedSecret(keyRow, "api_keys", "api_key_cipher");
  }
  return secrets ? storedSecret(row, "cloud_agents", "api_key_cipher") : undefined;
}

function agentFromRow(row, { secrets = false } = {}) {
  if (!row) return undefined;
  return {
    id: row.id,
    name: row.name,
    agentId: row.business_agent_id,
    ...(secrets ? { apiKey: resolveAgentApiKey(row, true) } : { apiKeyConfigured: true }),
    apiKeyConfigId: row.api_key_config_id || null,
    apiKeyName: row.api_key_name || null,
    baseUrl: row.base_url,
    sourceApp: row.source_app,
    runtimeNamePrefix: row.runtime_name_prefix,
    manifestVersion: row.manifest_version,
    manifest: JSON.parse(row.manifest_json || "{}"),
    controlTimeoutMs: row.control_timeout_ms,
    promptTimeoutMs: row.prompt_timeout_ms,
    includeThinking: Boolean(row.include_thinking),
    reconnectMaxAttempts: 3,
    reconnectBackoffMs: 300,
    reconnectMaxBackoffMs: 30000,
    heartbeatTimeoutMs: 45000,
    logLevel: row.log_level,
    revision: row.revision,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function botFromRow(row, { secrets = false } = {}) {
  if (!row) return undefined;
  return {
    id: row.id,
    name: row.name,
    botId: row.bot_id,
    ...(secrets ? { secret: storedSecret(row, "wecom_bots", "secret_cipher") } : { secretConfigured: true }),
    cloudAgentId: row.cloud_agent_id,
    cloudAgentName: row.cloud_agent_name,
    enabled: Boolean(row.enabled),
    welcomeText: row.welcome_text,
    placeholder: row.placeholder,
    groupSessionScope: row.group_session_scope,
    wsUrl: row.ws_url || "",
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function listAgents(options) {
  return db().prepare(`
    SELECT a.*, k.name AS api_key_name
    FROM cloud_agents a LEFT JOIN api_keys k ON k.id = a.api_key_config_id
    ORDER BY a.name, a.created_at
  `).all().map((row) => agentFromRow(row, options));
}

function getAgent(id, options) {
  return agentFromRow(db().prepare(`
    SELECT a.*, k.name AS api_key_name
    FROM cloud_agents a LEFT JOIN api_keys k ON k.id = a.api_key_config_id
    WHERE a.id = ?
  `).get(id), options);
}

function findAgentByBusinessId(businessAgentId) {
  const value = String(businessAgentId || "").trim();
  if (!value) return undefined;
  return agentFromRow(db().prepare("SELECT * FROM cloud_agents WHERE business_agent_id = ?").get(value));
}

function saveAgent(input, id) {
  const database = db();
  const existing = id ? database.prepare("SELECT * FROM cloud_agents WHERE id = ?").get(id) : undefined;
  if (id && !existing) throw new Error("CloudAgent configuration not found");
  const now = Date.now();
  const apiKeyConfigId = input.apiKeyConfigId ? text(input.apiKeyConfigId, "API Key configuration", { max: 100 }) : "";
  if (apiKeyConfigId && !database.prepare("SELECT id FROM api_keys WHERE id = ?").get(apiKeyConfigId)) {
    throw new Error("Selected API Key configuration not found");
  }
  const apiKey = text(input.apiKey, "API Key", { required: !existing && !apiKeyConfigId, max: 2000 });
  const apiKeyStored = apiKey || existing?.api_key_cipher || "";
  if (!apiKeyConfigId && !apiKeyStored) throw new Error("API Key is required");
  const record = {
    id: existing?.id || crypto.randomUUID(),
    name: text(input.name || input.agentId, "Agent name", { max: 100 }),
    agentId: text(input.agentId, "Agent ID", { max: 200 }),
    apiKeyConfigId: apiKeyConfigId || null,
    apiKeyStored,
    baseUrl: text(input.baseUrl || "https://www.codebuddy.cn/v2/agentos", "Base URL", { max: 500 }),
    sourceApp: text(input.sourceApp || "wecom-cloudagent-gateway", "Source App", { max: 100 }),
    runtimeNamePrefix: text(input.runtimeNamePrefix || "wecom", "Runtime name prefix", { max: 40 }),
    manifestVersion: text(input.manifestVersion || "1.0", "Manifest version", { max: 30 }),
    manifestJson: JSON.stringify(parseManifest(input.manifest)),
    controlTimeoutMs: positiveInteger(input.controlTimeoutMs, 1200000, "Control timeout"),
    promptTimeoutMs: positiveInteger(input.promptTimeoutMs, 1200000, "Prompt timeout"),
    includeThinking: input.includeThinking ? 1 : 0,
    logLevel: ["off", "error", "warn", "info", "debug"].includes(input.logLevel) ? input.logLevel : "warn",
    revision: (existing?.revision || 0) + 1,
  };
  if (!/^agent[-_]/i.test(record.agentId)) throw new Error("Agent ID must start with agent_");
  database.prepare(`
    INSERT INTO cloud_agents (id,name,business_agent_id,api_key_cipher,api_key_config_id,base_url,source_app,runtime_name_prefix,manifest_version,manifest_json,control_timeout_ms,prompt_timeout_ms,include_thinking,log_level,revision,created_at,updated_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
    ON CONFLICT(id) DO UPDATE SET name=excluded.name,business_agent_id=excluded.business_agent_id,api_key_cipher=excluded.api_key_cipher,api_key_config_id=excluded.api_key_config_id,base_url=excluded.base_url,source_app=excluded.source_app,runtime_name_prefix=excluded.runtime_name_prefix,manifest_version=excluded.manifest_version,manifest_json=excluded.manifest_json,control_timeout_ms=excluded.control_timeout_ms,prompt_timeout_ms=excluded.prompt_timeout_ms,include_thinking=excluded.include_thinking,log_level=excluded.log_level,revision=excluded.revision,updated_at=excluded.updated_at
  `).run(record.id, record.name, record.agentId, record.apiKeyStored, record.apiKeyConfigId, record.baseUrl, record.sourceApp, record.runtimeNamePrefix, record.manifestVersion, record.manifestJson, record.controlTimeoutMs, record.promptTimeoutMs, record.includeThinking, record.logLevel, record.revision, existing?.created_at || now, now);
  return getAgent(record.id);
}

function deleteAgent(id) {
  const refs = db().prepare("SELECT COUNT(*) AS count FROM wecom_bots WHERE cloud_agent_id = ?").get(id).count;
  if (refs) throw new Error("CloudAgent is still paired with one or more WeCom Bots");
  if (!db().prepare("DELETE FROM cloud_agents WHERE id = ?").run(id).changes) throw new Error("CloudAgent configuration not found");
}

function listKeys(options) {
  return db().prepare("SELECT * FROM api_keys ORDER BY name, created_at").all().map((row) => keyFromRow(row, options));
}

function getKey(id, options) {
  return keyFromRow(db().prepare("SELECT * FROM api_keys WHERE id = ?").get(id), options);
}

function saveKey(input, id) {
  const database = db();
  const existing = id ? database.prepare("SELECT * FROM api_keys WHERE id = ?").get(id) : undefined;
  if (id && !existing) throw new Error("API Key configuration not found");
  const apiKey = text(input.apiKey, "API Key", { required: !existing, max: 2000 });
  const now = Date.now();
  const record = {
    id: existing?.id || crypto.randomUUID(),
    name: text(input.name, "API Key name", { max: 100 }),
    apiKeyStored: apiKey || existing.api_key_cipher,
    baseUrl: text(input.baseUrl || "https://www.codebuddy.cn/v2/agentos", "Base URL", { max: 500 }),
  };
  const keyRotated = Boolean(existing) && record.apiKeyStored !== existing.api_key_cipher;
  database.prepare(`
    INSERT INTO api_keys (id,name,api_key_cipher,base_url,created_at,updated_at)
    VALUES (?,?,?,?,?,?)
    ON CONFLICT(id) DO UPDATE SET name=excluded.name,api_key_cipher=excluded.api_key_cipher,base_url=excluded.base_url,updated_at=excluded.updated_at
  `).run(record.id, record.name, record.apiKeyStored, record.baseUrl, existing?.created_at || now, now);
  if (keyRotated) {
    // Rotating the key value must invalidate cached SDK clients and rotate
    // session namespaces for agents that resolve credentials from this key.
    database.prepare("UPDATE cloud_agents SET revision = revision + 1, updated_at = ? WHERE api_key_config_id = ?").run(now, record.id);
  }
  return getKey(record.id);
}

function deleteKey(id) {
  const refs = db().prepare("SELECT COUNT(*) AS count FROM cloud_agents WHERE api_key_config_id = ?").get(id).count;
  if (refs) throw new Error("API Key is still used by one or more CloudAgents");
  if (!db().prepare("DELETE FROM api_keys WHERE id = ?").run(id).changes) throw new Error("API Key configuration not found");
}

function listBots(options) {
  return db().prepare(`SELECT b.*, a.name AS cloud_agent_name FROM wecom_bots b JOIN cloud_agents a ON a.id=b.cloud_agent_id ORDER BY b.name,b.created_at`).all().map((row) => botFromRow(row, options));
}

function getBot(id, options) {
  return botFromRow(db().prepare(`SELECT b.*, a.name AS cloud_agent_name FROM wecom_bots b JOIN cloud_agents a ON a.id=b.cloud_agent_id WHERE b.id=?`).get(id), options);
}

function saveBot(input, id) {
  const database = db();
  const existing = id ? database.prepare("SELECT * FROM wecom_bots WHERE id = ?").get(id) : undefined;
  if (id && !existing) throw new Error("WeCom Bot configuration not found");
  const agentId = text(input.cloudAgentId, "CloudAgent pairing", { max: 100 });
  if (!getAgent(agentId)) throw new Error("Selected CloudAgent configuration not found");
  const secret = text(input.secret, "Bot Secret", { required: !existing, max: 2000 });
  const now = Date.now();
  const record = {
    id: existing?.id || crypto.randomUUID(),
    name: text(input.name, "Bot name", { max: 100 }),
    botId: text(input.botId, "Bot ID", { max: 200 }),
    secretStored: secret || existing.secret_cipher,
    cloudAgentId: agentId,
    enabled: input.enabled === false ? 0 : 1,
    welcomeText: text(input.welcomeText || "你好，我是企业智能助手。发送 /new 可以开始一个新会话。", "Welcome text", { max: 2000 }),
    placeholder: text(input.placeholder || "正在处理…", "Placeholder", { max: 500 }),
    groupSessionScope: input.groupSessionScope === "user" ? "user" : "chat",
    wsUrl: text(input.wsUrl, "WebSocket URL", { required: false, max: 500 }) || null,
  };
  database.prepare(`
    INSERT INTO wecom_bots (id,name,bot_id,secret_cipher,cloud_agent_id,enabled,welcome_text,placeholder,group_session_scope,ws_url,created_at,updated_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?)
    ON CONFLICT(id) DO UPDATE SET name=excluded.name,bot_id=excluded.bot_id,secret_cipher=excluded.secret_cipher,cloud_agent_id=excluded.cloud_agent_id,enabled=excluded.enabled,welcome_text=excluded.welcome_text,placeholder=excluded.placeholder,group_session_scope=excluded.group_session_scope,ws_url=excluded.ws_url,updated_at=excluded.updated_at
  `).run(record.id, record.name, record.botId, record.secretStored, record.cloudAgentId, record.enabled, record.welcomeText, record.placeholder, record.groupSessionScope, record.wsUrl, existing?.created_at || now, now);
  return getBot(record.id);
}

function deleteBot(id) {
  const alertRefs = db().prepare("SELECT COUNT(*) AS count FROM alert_integrations WHERE bot_config_id=?").get(id).count;
  if (alertRefs) throw new Error("WeCom Bot is still used by one or more alert integrations");
  if (!db().prepare("DELETE FROM wecom_bots WHERE id = ?").run(id).changes) throw new Error("WeCom Bot configuration not found");
}

function pairForBot(id) {
  const bot = getBot(id, { secrets: true });
  if (!bot) return undefined;
  const agent = getAgent(bot.cloudAgentId, { secrets: true });
  if (!agent) return undefined;
  return { bot, agent, pairKey: `${bot.id}:${agent.id}:r${agent.revision}` };
}

module.exports = {
  deleteAgent,
  deleteBot,
  deleteKey,
  findAgentByBusinessId,
  getAgent,
  getBot,
  getKey,
  listAgents,
  listBots,
  listKeys,
  pairForBot,
  saveAgent,
  saveBot,
  saveKey,
};
