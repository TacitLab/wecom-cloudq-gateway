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
  const result = value === undefined || value === "" ? fallback : Number(value);
  if (!Number.isSafeInteger(result) || result <= 0) throw new Error(`${label} must be a positive integer`);
  return result;
}

function maskSecret(value) {
  const key = String(value || "");
  if (!key) return "";
  if (key.length <= 10) return "****" + key.slice(-2);
  return key.slice(0, 6) + "****" + key.slice(-4);
}

function wmaCredentialFromRow(row, { secrets = false } = {}) {
  if (!row) return undefined;
  return {
    id: row.id, name: row.name, region: row.region,
    ...(secrets ? { secretId: row.secret_id, secretKey: row.secret_key }
      : { secretIdMasked: maskSecret(row.secret_id), secretKeyConfigured: Boolean(row.secret_key) }),
    createdAt: row.created_at, updatedAt: row.updated_at,
  };
}

function listWmaCredentials(options) {
  return db().prepare("SELECT * FROM wma_credentials ORDER BY name,created_at").all().map((row) => wmaCredentialFromRow(row, options));
}

function getWmaCredential(id, options) {
  return wmaCredentialFromRow(db().prepare("SELECT * FROM wma_credentials WHERE id=?").get(id), options);
}

function saveWmaCredential(input, id) {
  const database = db();
  const existing = id ? database.prepare("SELECT * FROM wma_credentials WHERE id=?").get(id) : undefined;
  if (id && !existing) throw new Error("WMA credential configuration not found");
  const record = {
    id: existing?.id || crypto.randomUUID(),
    name: text(input.name, "Credential name", { max: 100 }),
    secretId: text(input.secretId, "WMA SecretId", { required: !existing, max: 256 }) || existing.secret_id,
    secretKey: text(input.secretKey, "WMA SecretKey", { required: !existing, max: 256 }) || existing.secret_key,
    region: text(input.region || existing?.region || "ap-guangzhou", "WMA region", { max: 60 }),
  };
  if (!/^[a-z]+-[a-z]+(?:-\d+)?$/.test(record.region)) throw new Error("Invalid WMA region");
  const rotated = existing && (record.secretId !== existing.secret_id || record.secretKey !== existing.secret_key || record.region !== existing.region);
  const now = Date.now();
  database.exec("BEGIN");
  try {
    database.prepare(`
      INSERT INTO wma_credentials (id,name,secret_id,secret_key,region,created_at,updated_at) VALUES (?,?,?,?,?,?,?)
      ON CONFLICT(id) DO UPDATE SET name=excluded.name,secret_id=excluded.secret_id,secret_key=excluded.secret_key,region=excluded.region,updated_at=excluded.updated_at
    `).run(record.id, record.name, record.secretId, record.secretKey, record.region, existing?.created_at || now, now);
    if (rotated) database.prepare("UPDATE wma_agents SET revision=revision+1,updated_at=? WHERE credential_config_id=?").run(now, record.id);
    database.exec("COMMIT");
  } catch (error) { database.exec("ROLLBACK"); throw error; }
  return getWmaCredential(record.id);
}

function deleteWmaCredential(id) {
  if (db().prepare("SELECT COUNT(*) AS count FROM wma_agents WHERE credential_config_id=?").get(id).count) throw new Error("WMA credential is still used by one or more Agents");
  if (!db().prepare("DELETE FROM wma_credentials WHERE id=?").run(id).changes) throw new Error("WMA credential configuration not found");
}

const AGENT_SELECT = `SELECT a.*, c.name AS credential_name,c.region,c.secret_id,c.secret_key,COALESCE(r.name,v.runtime_credential_name) AS runtime_credential_name,r.updated_at AS runtime_credential_current_updated_at,v.runtime_credential_id AS recorded_runtime_credential_id FROM wma_agents a JOIN wma_credentials c ON c.id=a.credential_config_id LEFT JOIN tencent_credentials r ON r.id=a.runtime_credential_id LEFT JOIN wma_credential_versions v ON v.credential_config_id=a.credential_config_id AND v.business_agent_id=a.business_agent_id AND v.version_id=a.wma_version_id`;
function agentFromRow(row, { secrets = false } = {}) {
  if (!row) return undefined;
  return {
    id: row.id, name: row.name, agentId: row.business_agent_id,
    credentialConfigId: row.credential_config_id, credentialName: row.credential_name,
    region: row.region, credentialsConfigured: true,
    ...(secrets ? { secretId: row.secret_id, secretKey: row.secret_key } : {}),
    controlTimeoutMs: row.control_timeout_ms, promptTimeoutMs: row.prompt_timeout_ms,
    includeThinking: Boolean(row.include_thinking), revision: row.revision,
    runtimeCredentialId: row.runtime_credential_id || null,
    runtimeCredentialName: row.runtime_credential_name || null,
    runtimeRegion: row.runtime_region || null,
    wmaVersionId: row.wma_version_id || null, wmaVersionName: row.wma_version_name || null,
    runtimeCredentialUpdatedAt: row.runtime_credential_updated_at || null,
    runtimeCredentialOutdated: Boolean((row.runtime_credential_id || row.recorded_runtime_credential_id) && row.runtime_credential_updated_at !== row.runtime_credential_current_updated_at),
    createdAt: row.created_at, updatedAt: row.updated_at,
  };
}
function listAgents(options) {
  return db().prepare(`${AGENT_SELECT} ORDER BY a.name,a.created_at`).all().map((row) => agentFromRow(row, options));
}
function getAgent(id, options) {
  return agentFromRow(db().prepare(`${AGENT_SELECT} WHERE a.id=?`).get(id), options);
}
function findAgentByBusinessId(agentId, credentialConfigId) {
  return agentFromRow(db().prepare(`${AGENT_SELECT} WHERE a.business_agent_id=? AND a.credential_config_id=?`).get(String(agentId || "").trim(), credentialConfigId));
}
function credentialVersionFromRow(row) {
  if (!row) return undefined;
  return {
    versionId: row.version_id, versionName: row.version_name, sourceVersionId: row.source_version_id,
    sourceVersionName: row.source_version_name, runtimeCredentialId: row.runtime_credential_id,
    runtimeCredentialName: row.current_credential_name || row.runtime_credential_name,
    runtimeRegion: row.runtime_region, runtimeCredentialUpdatedAt: row.runtime_credential_updated_at,
    runtimeCredentialOutdated: row.current_credential_updated_at !== row.runtime_credential_updated_at,
    createdAt: row.created_at, injected: true,
  };
}
function getCredentialVersion(credentialConfigId, agentId, versionId) {
  return credentialVersionFromRow(db().prepare(`
    SELECT v.*,c.name AS current_credential_name,c.updated_at AS current_credential_updated_at
    FROM wma_credential_versions v LEFT JOIN tencent_credentials c ON c.id=v.runtime_credential_id
    WHERE v.credential_config_id=? AND v.business_agent_id=? AND v.version_id=?
  `).get(credentialConfigId, agentId, versionId));
}
function saveCredentialVersion(credentialConfigId, agentId, version, source, credential, region) {
  db().prepare(`
    INSERT INTO wma_credential_versions
      (credential_config_id,business_agent_id,version_id,version_name,source_version_id,source_version_name,runtime_credential_id,runtime_credential_name,runtime_region,runtime_credential_updated_at,created_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?)
  `).run(credentialConfigId, agentId, version.versionId, String(version.versionName || ""), source.versionId,
    String(source.versionName || ""), credential.id, credential.name, region, credential.updatedAt, Date.now());
  return getCredentialVersion(credentialConfigId, agentId, version.versionId);
}
function validateAgentInput(input, id) {
  const existing = id ? getAgent(id) : undefined;
  if (id && !existing) throw new Error("WMA Agent configuration not found");
  const credentialConfigId = text(input.credentialConfigId, "WMA credential configuration", { max: 100 });
  if (!getWmaCredential(credentialConfigId)) throw new Error("Selected WMA credential configuration not found");
  const agentId = text(input.agentId, "Agent ID", { max: 200 });
  if (!/^[a-zA-Z0-9_-]+$/.test(agentId)) throw new Error("Invalid WMA Agent ID");
  const duplicate = findAgentByBusinessId(agentId, credentialConfigId);
  if (duplicate && duplicate.id !== id) throw new Error("WMA Agent is already added for this credential");
  return {
    existing, credentialConfigId, agentId,
    name: text(input.name || agentId, "Agent name", { max: 100 }),
    controlTimeoutMs: positiveInteger(input.controlTimeoutMs, 30000, "Control timeout"),
    promptTimeoutMs: positiveInteger(input.promptTimeoutMs, 1200000, "Prompt timeout"),
    includeThinking: Boolean(input.includeThinking),
  };
}
function saveAgent(input, id, { runtimeVersion } = {}) {
  const database = db();
  const record = validateAgentInput(input, id);
  const { existing, credentialConfigId, agentId } = record;
  const sameIdentity = existing?.agentId === agentId && existing?.credentialConfigId === credentialConfigId;
  const runtime = runtimeVersion === undefined ? (sameIdentity ? existing : {}) : runtimeVersion || {};
  const now = Date.now();
  const recordId = id || crypto.randomUUID();
  database.prepare(`
    INSERT INTO wma_agents (id,name,business_agent_id,credential_config_id,control_timeout_ms,prompt_timeout_ms,include_thinking,revision,created_at,updated_at,runtime_credential_id,runtime_region,wma_version_id,wma_version_name,runtime_credential_updated_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
    ON CONFLICT(id) DO UPDATE SET name=excluded.name,business_agent_id=excluded.business_agent_id,credential_config_id=excluded.credential_config_id,control_timeout_ms=excluded.control_timeout_ms,prompt_timeout_ms=excluded.prompt_timeout_ms,include_thinking=excluded.include_thinking,revision=excluded.revision,updated_at=excluded.updated_at,runtime_credential_id=excluded.runtime_credential_id,runtime_region=excluded.runtime_region,wma_version_id=excluded.wma_version_id,wma_version_name=excluded.wma_version_name,runtime_credential_updated_at=excluded.runtime_credential_updated_at
  `).run(recordId,record.name,agentId,credentialConfigId,record.controlTimeoutMs,record.promptTimeoutMs,
    record.includeThinking?1:0,(existing?.revision||0)+1,existing?.createdAt||now,now,
    runtime.runtimeCredentialId || null,runtime.runtimeRegion || null,runtime.wmaVersionId || null,
    runtime.wmaVersionName || null,runtime.runtimeCredentialUpdatedAt || null);
  if (existing && (!sameIdentity || existing.wmaVersionId !== (runtime.wmaVersionId || null))) {
    database.prepare("DELETE FROM wma_conversations WHERE agent_config_id=?").run(recordId);
  }
  return getAgent(recordId);
}
function deleteAgent(id) {
  if (db().prepare("SELECT COUNT(*) AS count FROM wecom_bots WHERE agent_config_id=?").get(id).count) throw new Error("WMA Agent is still paired with one or more WeCom Bots");
  if (!db().prepare("DELETE FROM wma_agents WHERE id=?").run(id).changes) throw new Error("WMA Agent configuration not found");
}
function resetAgentSessions(id) {
  const database = db();
  if (!getAgent(id)) throw new Error("WMA Agent configuration not found");
  const cleared = database.prepare("DELETE FROM wma_conversations WHERE agent_config_id=?").run(id).changes;
  database.prepare("UPDATE wma_agents SET revision=revision+1,updated_at=? WHERE id=?").run(Date.now(),id);
  return { cleared, revision: getAgent(id).revision };
}
function botFromRow(row, { secrets = false } = {}) {
  if (!row) return undefined;
  return {
    id: row.id,name: row.name,botId: row.bot_id,
    ...(secrets ? { secret: row.secret } : { secretConfigured: true }),
    agentConfigId: row.agent_config_id || null,agentName: row.agent_name || "",
    enabled: Boolean(row.enabled),showThinking: Boolean(row.show_thinking),
    welcomeText: row.welcome_text,placeholder: row.placeholder,
    groupSessionScope: row.group_session_scope,wsUrl: row.ws_url || "",
    createdAt: row.created_at,updatedAt: row.updated_at,
  };
}

function credentialFromRow(row, { secrets = false } = {}) {
  if (!row) return undefined;
  return {
    id: row.id,
    name: row.name,
    ...(secrets
      ? { secretId: row.secret_id, secretKey: row.secret_key }
      : { secretIdMasked: maskSecret(row.secret_id), secretKeyConfigured: Boolean(row.secret_key) }),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function listTencentCredentials(options) {
  return db().prepare("SELECT * FROM tencent_credentials ORDER BY name, created_at").all()
    .map((row) => credentialFromRow(row, options));
}

function getTencentCredential(id, options) {
  return credentialFromRow(db().prepare("SELECT * FROM tencent_credentials WHERE id = ?").get(id), options);
}

function saveTencentCredential(input, id) {
  const database = db();
  const existing = id ? database.prepare("SELECT * FROM tencent_credentials WHERE id = ?").get(id) : undefined;
  if (id && !existing) throw new Error("Tencent Cloud credential not found");
  const secretId = text(input.secretId, "Tencent Cloud SecretId", { required: !existing, max: 256 });
  const secretKey = text(input.secretKey, "Tencent Cloud SecretKey", { required: !existing, max: 256 });
  const now = Math.max(Date.now(), (existing?.updated_at || 0) + 1);
  const record = {
    id: existing?.id || crypto.randomUUID(),
    name: text(input.name, "Credential name", { max: 100 }),
    secretId: secretId || existing.secret_id,
    secretKey: secretKey || existing.secret_key,
  };
  const rotated = Boolean(existing) &&
    (record.secretId !== existing.secret_id || record.secretKey !== existing.secret_key);
  database.prepare(`
    INSERT INTO tencent_credentials (id,name,secret_id,secret_key,created_at,updated_at)
    VALUES (?,?,?,?,?,?)
    ON CONFLICT(id) DO UPDATE SET name=excluded.name,secret_id=excluded.secret_id,secret_key=excluded.secret_key,updated_at=excluded.updated_at
  `).run(record.id, record.name, record.secretId, record.secretKey, existing?.created_at || now, now);
  if (rotated) {
    // Keep the inline AK/SK copy on referencing alert integrations in sync.
    database.prepare("UPDATE alert_integrations SET secret_id=?, secret_key=?, updated_at=? WHERE credential_id=?")
      .run(record.secretId, record.secretKey, now, record.id);
  }
  return getTencentCredential(record.id);
}

function deleteTencentCredential(id) {
  if (db().prepare("SELECT COUNT(*) AS count FROM wma_agents WHERE runtime_credential_id=?").get(id).count) {
    throw new Error("Tencent Cloud credential is still used by one or more WMA Agent versions");
  }
  const refs = db().prepare("SELECT COUNT(*) AS count FROM alert_integrations WHERE credential_id = ? OR diagnostic_credential_id = ?").get(id, id).count;
  if (refs) throw new Error("Tencent Cloud credential is still used by one or more alert integrations");
  if (!db().prepare("DELETE FROM tencent_credentials WHERE id = ?").run(id).changes) {
    throw new Error("Tencent Cloud credential not found");
  }
}

function listBots(options) {
  return db().prepare(`SELECT b.*, a.name AS agent_name FROM wecom_bots b LEFT JOIN wma_agents a ON a.id=b.agent_config_id ORDER BY b.name,b.created_at`).all().map((row) => botFromRow(row, options));
}

function getBot(id, options) {
  return botFromRow(db().prepare(`SELECT b.*, a.name AS agent_name FROM wecom_bots b LEFT JOIN wma_agents a ON a.id=b.agent_config_id WHERE b.id=?`).get(id), options);
}

function saveBot(input, id) {
  const database = db();
  const existing = id ? database.prepare("SELECT * FROM wecom_bots WHERE id = ?").get(id) : undefined;
  if (id && !existing) throw new Error("WeCom Bot configuration not found");
  const agentId = text(input.agentConfigId, "WMA Agent pairing", { max: 100 });
  if (!getAgent(agentId)) throw new Error("Selected WMA Agent configuration not found");
  const secret = text(input.secret, "Bot Secret", { required: !existing, max: 2000 });
  const now = Date.now();
  const record = {
    id: existing?.id || crypto.randomUUID(),
    name: text(input.name, "Bot name", { max: 100 }),
    botId: text(input.botId, "Bot ID", { max: 200 }),
    secretStored: secret || existing.secret,
    agentConfigId: agentId,
    enabled: input.enabled === false ? 0 : 1,
    showThinking: input.showThinking === undefined ? (existing?.show_thinking ?? 1) : (input.showThinking === false ? 0 : 1),
    welcomeText: text(input.welcomeText || "你好，我是企业智能助手。发送 /new 可以开始一个新会话。", "Welcome text", { max: 2000 }),
    placeholder: text(input.placeholder || "正在处理…", "Placeholder", { max: 500 }),
    groupSessionScope: input.groupSessionScope === "user" ? "user" : "chat",
    wsUrl: text(input.wsUrl, "WebSocket URL", { required: false, max: 500 }) || null,
  };
  database.prepare(`
    INSERT INTO wecom_bots (id,name,bot_id,secret,agent_config_id,enabled,show_thinking,welcome_text,placeholder,group_session_scope,ws_url,created_at,updated_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)
    ON CONFLICT(id) DO UPDATE SET name=excluded.name,bot_id=excluded.bot_id,secret=excluded.secret,agent_config_id=excluded.agent_config_id,enabled=excluded.enabled,show_thinking=excluded.show_thinking,welcome_text=excluded.welcome_text,placeholder=excluded.placeholder,group_session_scope=excluded.group_session_scope,ws_url=excluded.ws_url,updated_at=excluded.updated_at
  `).run(record.id, record.name, record.botId, record.secretStored, record.agentConfigId, record.enabled, record.showThinking, record.welcomeText, record.placeholder, record.groupSessionScope, record.wsUrl, existing?.created_at || now, now);
  return getBot(record.id);
}

function deleteBot(id) {
  const alertRefs = db().prepare("SELECT COUNT(*) AS count FROM alert_integrations WHERE bot_config_id=?").get(id).count;
  if (alertRefs) throw new Error("WeCom Bot is still used by one or more alert integrations");
  if (!db().prepare("DELETE FROM wecom_bots WHERE id = ?").run(id).changes) throw new Error("WeCom Bot configuration not found");
}

function pairForBot(id) {
  const bot = getBot(id, { secrets: true });
  if (!bot?.agentConfigId) return undefined;
  const agent = getAgent(bot.agentConfigId, { secrets: true });
  if (!agent) return undefined;
  return { bot, agent, pairKey: `${bot.id}:${agent.id}:r${agent.revision}` };
}

module.exports = {
  deleteAgent,
  deleteBot,
  deleteWmaCredential,
  deleteTencentCredential,
  findAgentByBusinessId,
  getCredentialVersion,
  saveCredentialVersion,
  getAgent,
  getBot,
  getWmaCredential,
  getTencentCredential,
  listAgents,
  listBots,
  listWmaCredentials,
  listTencentCredentials,
  pairForBot,
  resetAgentSessions,
  saveAgent,
  validateAgentInput,
  saveBot,
  saveWmaCredential,
  saveTencentCredential,
};
