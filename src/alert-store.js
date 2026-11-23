"use strict";

const crypto = require("node:crypto");
const { validateMonitorType, validateRegion } = require("./alert-config");
const { db } = require("./database");
const { runtimeConfig } = require("./config");
const { expectsHtmlAttachment } = require("./html-reply");

function text(value, label, { required = true, max = 1000 } = {}) {
  const result = String(value ?? "").trim();
  if (required && !result) throw new Error(`${label} is required`);
  if (result.length > max) throw new Error(`${label} is too long`);
  return result;
}

function integer(value, fallback, label, minimum = 1) {
  const result = value === undefined || value === "" ? fallback : Number.parseInt(value, 10);
  if (!Number.isFinite(result) || result < minimum) throw new Error(`${label} must be at least ${minimum}`);
  return result;
}

function parsePolicyIds(value) {
  const values = Array.isArray(value) ? value : String(value || "").split(/[\s,，]+/);
  return [...new Set(values.map((item) => String(item).trim()).filter(Boolean))].slice(0, 100);
}

function newBindCode() {
  return crypto.randomBytes(5).toString("base64url").replace(/[-_]/g, "A").slice(0, 8).toUpperCase();
}

function integrationFromRow(row, { secrets = false } = {}) {
  if (!row) return undefined;
  return {
    id: row.id,
    name: row.name,
    botConfigId: row.bot_config_id,
    botName: row.bot_name,
    agentName: row.agent_name || "",
    agentConfigId: row.bound_agent_id || null,
    credentialId: row.credential_id || null,
    credentialName: row.credential_name || null,
    ...(secrets ? { secretId: row.secret_id, secretKey: row.secret_key } : {
      secretIdConfigured: Boolean(row.secret_id),
      secretKeyConfigured: Boolean(row.secret_key),
    }),
    region: row.region || "",
    monitorType: row.monitor_type,
    namespace: row.namespace,
    policyIds: JSON.parse(row.policy_ids_json || "[]"),
    pollIntervalSeconds: row.poll_interval_seconds,
    initialLookbackSeconds: row.initial_lookback_seconds,
    overlapSeconds: row.overlap_seconds,
    promptTemplate: row.prompt_template,
    includeRecovery: Boolean(row.include_recovery),
    enabled: Boolean(row.enabled),
    bindCode: row.bind_code,
    targetChatId: row.target_chat_id || "",
    targetChatName: row.target_chat_name || "",
    lastAttemptAt: row.last_attempt_at,
    lastSuccessAt: row.last_success_at,
    lastError: row.last_error || "",
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

const INTEGRATION_SELECT = `
  SELECT i.*, b.agent_config_id AS bound_agent_id, b.name AS bot_name, a.name AS agent_name, c.name AS credential_name
  FROM alert_integrations i
  JOIN wecom_bots b ON b.id=i.bot_config_id
  LEFT JOIN wma_agents a ON a.id=b.agent_config_id
  LEFT JOIN tencent_credentials c ON c.id=i.credential_id
`;

function listIntegrations(options) {
  return db().prepare(`${INTEGRATION_SELECT} ORDER BY i.name,i.created_at`).all()
    .map((row) => integrationFromRow(row, options));
}

function getIntegration(id, options) {
  return integrationFromRow(db().prepare(`${INTEGRATION_SELECT} WHERE i.id=?`).get(id), options);
}

function saveIntegration(input, id) {
  const database = db();
  const existing = id ? database.prepare("SELECT * FROM alert_integrations WHERE id=?").get(id) : undefined;
  if (id && !existing) throw new Error("Alert integration not found");
  const botConfigId = text(input.botConfigId, "Bot", { max: 100 });
  if (!database.prepare("SELECT id FROM wecom_bots WHERE id=?").get(botConfigId)) throw new Error("Selected Bot not found");
  const credentialId = text(input.credentialId, "Tencent Cloud credential", { required: !existing, max: 100 })
    || existing.credential_id;
  const credential = credentialId
    ? database.prepare("SELECT * FROM tencent_credentials WHERE id=?").get(credentialId)
    : undefined;
  if (!credential) throw new Error("Selected Tencent Cloud credential not found");
  const monitorType = validateMonitorType(input.monitorType || existing?.monitor_type || "MT_QCE");
  const policyIds = parsePolicyIds(input.policyIds);
  if (input.policyScope && !["selected", "all"].includes(input.policyScope)) throw new Error("Invalid policy scope");
  if (input.policyScope === "selected" && !policyIds.length) throw new Error("At least one alarm policy is required");
  if (input.policyScope === "all" && policyIds.length) throw new Error("Invalid policy scope: all-policy scope cannot include selected policies");
  const now = Date.now();
  const record = {
    id: existing?.id || crypto.randomUUID(),
    name: text(input.name, "Integration name", { max: 100 }),
    botConfigId,
    credentialId,
    secretId: credential.secret_id,
    secretKey: credential.secret_key,
    region: validateRegion(input.region),
    monitorType,
    namespace: monitorType === "MT_CLS" ? "" : text(input.namespace ?? (monitorType === "MT_QCE" ? "cvm_device" : ""), "Namespace", { required: false, max: 100 }),
    policyIdsJson: JSON.stringify(policyIds),
    pollIntervalSeconds: integer(input.pollIntervalSeconds, 60, "Poll interval", 30),
    initialLookbackSeconds: integer(input.initialLookbackSeconds, 600, "Initial lookback", 60),
    overlapSeconds: integer(input.overlapSeconds, 300, "Overlap window", 0),
    promptTemplate: text(input.promptTemplate, "Prompt template", { required: false, max: 20000 }),
    includeRecovery: input.includeRecovery ? 1 : 0,
    enabled: input.enabled === false ? 0 : 1,
    bindCode: existing && existing.bot_config_id === botConfigId ? existing.bind_code : newBindCode(),
  };
  const policySelectionChanged = existing &&
    JSON.stringify(JSON.parse(existing.policy_ids_json).sort()) !== JSON.stringify([...policyIds].sort());
  const scopeChanged = existing && (existing.credential_id !== credentialId || existing.region !== record.region ||
    existing.monitor_type !== monitorType || policySelectionChanged ||
    (!policyIds.length && existing.namespace !== record.namespace) || existing.include_recovery !== record.includeRecovery);
  const botChanged = existing && existing.bot_config_id !== botConfigId;
  database.prepare(`
    INSERT INTO alert_integrations
      (id,name,bot_config_id,credential_id,secret_id,secret_key,region,monitor_type,namespace,policy_ids_json,poll_interval_seconds,initial_lookback_seconds,overlap_seconds,prompt_template,include_recovery,enabled,bind_code,target_chat_id,target_chat_name,last_attempt_at,last_success_at,last_error,created_at,updated_at,diagnostic_credential_id)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
    ON CONFLICT(id) DO UPDATE SET
      name=excluded.name,bot_config_id=excluded.bot_config_id,credential_id=excluded.credential_id,diagnostic_credential_id=excluded.diagnostic_credential_id,secret_id=excluded.secret_id,secret_key=excluded.secret_key,
      region=excluded.region,monitor_type=excluded.monitor_type,namespace=excluded.namespace,policy_ids_json=excluded.policy_ids_json,
      poll_interval_seconds=excluded.poll_interval_seconds,initial_lookback_seconds=excluded.initial_lookback_seconds,
      overlap_seconds=excluded.overlap_seconds,prompt_template=excluded.prompt_template,include_recovery=excluded.include_recovery,
      enabled=excluded.enabled,bind_code=excluded.bind_code,target_chat_id=excluded.target_chat_id,target_chat_name=excluded.target_chat_name,
      last_attempt_at=excluded.last_attempt_at,last_success_at=excluded.last_success_at,last_error=excluded.last_error,updated_at=excluded.updated_at
  `).run(
    record.id, record.name, record.botConfigId, record.credentialId, record.secretId, record.secretKey, record.region,
    record.monitorType, record.namespace, record.policyIdsJson, record.pollIntervalSeconds,
    record.initialLookbackSeconds, record.overlapSeconds, record.promptTemplate, record.includeRecovery,
    record.enabled, record.bindCode, botChanged ? null : existing?.target_chat_id || null, botChanged ? null : existing?.target_chat_name || null,
    scopeChanged ? null : existing?.last_attempt_at || null, scopeChanged ? null : existing?.last_success_at || null, scopeChanged ? null : existing?.last_error || null,
    existing?.created_at || now, now, null,
  );
  return getIntegration(record.id);
}

function deleteIntegration(id) {
  if (!db().prepare("DELETE FROM alert_integrations WHERE id=?").run(id).changes) throw new Error("Alert integration not found");
}

function setIntegrationEnabled(id, enabled) {
  const value = enabled ? 1 : 0;
  const result = db().prepare(`
    UPDATE alert_integrations
    SET enabled=?,last_attempt_at=CASE WHEN ?=1 THEN NULL ELSE last_attempt_at END,updated_at=?
    WHERE id=?
  `).run(value, value, Date.now(), id);
  if (!result.changes) throw new Error("Alert integration not found");
  return getIntegration(id);
}

function bindChat(bindCode, botConfigId, chatId) {
  const code = text(bindCode, "Bind code", { max: 32 }).toUpperCase();
  const integration = db().prepare("SELECT * FROM alert_integrations WHERE bind_code=?").get(code);
  if (!integration) throw new Error("绑定码无效或已过期");
  if (integration.bot_config_id !== botConfigId) throw new Error("该绑定码不属于当前 Bot");
  db().prepare("UPDATE alert_integrations SET target_chat_id=?,target_chat_name=?,bind_code=?,updated_at=? WHERE id=?")
    .run(String(chatId), `群聊 ${String(chatId).slice(-8)}`, newBindCode(), Date.now(), integration.id);
  return getIntegration(integration.id);
}

function unbindChat(id) {
  if (!db().prepare("UPDATE alert_integrations SET target_chat_id=NULL,target_chat_name=NULL,bind_code=?,updated_at=? WHERE id=?")
    .run(newBindCode(), Date.now(), id).changes) throw new Error("Alert integration not found");
  return getIntegration(id);
}

function updatePollState(id, { attemptedAt, succeededAt, error }) {
  db().prepare(`UPDATE alert_integrations SET last_attempt_at=?,last_success_at=COALESCE(?,last_success_at),last_error=?,updated_at=? WHERE id=?`)
    .run(attemptedAt || Date.now(), succeededAt || null, error || null, Date.now(), id);
}

function dueIntegrations(now = Date.now()) {
  return listIntegrations({ secrets: true }).filter((item) => item.enabled && item.agentConfigId && item.targetChatId &&
    (!item.lastAttemptAt || now - item.lastAttemptAt >= item.pollIntervalSeconds * 1000));
}

function jobFromRow(row) {
  if (!row) return undefined;
  return {
    id: row.id,
    integrationId: row.integration_id,
    integrationName: row.integration_name,
    eventKey: row.event_key,
    alarmId: row.alarm_id,
    alarmStatus: row.alarm_status,
    firstOccurTime: row.first_occur_time,
    payload: JSON.parse(row.payload_json || "{}"),
    prompt: row.prompt,
    answer: row.answer,
    textDelivered: Boolean(row.text_delivered),
    attachmentError: row.attachment_error || "",
    sessionId: row.session_id,
    status: row.status,
    attemptCount: row.attempt_count,
    nextAttemptAt: row.next_attempt_at,
    error: row.error || "",
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function enqueueHistory(integrationId, history) {
  const alarmId = String(history.AlarmId || "").trim();
  if (!alarmId) return { claimed: false };
  const alarmStatus = String(history.AlarmStatus || "ALARM").trim().toUpperCase();
  const eventKey = `${alarmId}:${alarmStatus}`;
  const now = Date.now();
  const id = crypto.randomUUID();
  try {
    db().prepare(`
      INSERT INTO alert_jobs
        (id,integration_id,event_key,alarm_id,alarm_status,first_occur_time,payload_json,status,next_attempt_at,created_at,updated_at)
      VALUES (?,?,?,?,?,?,?,'queued',0,?,?)
    `).run(id, integrationId, eventKey, alarmId, alarmStatus, history.FirstOccurTime || null, JSON.stringify(history), now, now);
    return { claimed: true, id };
  } catch (error) {
    if (!/UNIQUE constraint failed/i.test(String(error?.message))) throw error;
    return { claimed: false };
  }
}

function nextJob(now = Date.now()) {
  const database = db();
  const row = database.prepare(`
    SELECT j.*,i.name AS integration_name FROM alert_jobs j
    JOIN alert_integrations i ON i.id=j.integration_id
    WHERE j.status IN ('queued','delivery_pending') AND j.next_attempt_at<=?
    ORDER BY CASE j.status WHEN 'delivery_pending' THEN 0 ELSE 1 END,j.created_at LIMIT 1
  `).get(now);
  if (!row) return undefined;
  const claimedStatus = row.status === "queued" ? "analyzing" : "delivering";
  const result = database.prepare("UPDATE alert_jobs SET status=?,updated_at=? WHERE id=? AND status=?")
    .run(claimedStatus, now, row.id, row.status);
  if (!result.changes) return undefined;
  return jobFromRow({ ...row, status: claimedStatus });
}

function updateJob(id, patch) {
  const allowed = {
    prompt: "prompt", answer: "answer", sessionId: "session_id",
    status: "status", attemptCount: "attempt_count", nextAttemptAt: "next_attempt_at", error: "error",
    textDelivered: "text_delivered", attachmentError: "attachment_error",
  };
  const entries = Object.entries(patch).filter(([key]) => allowed[key]);
  if (!entries.length) return;
  const sql = entries.map(([key]) => `${allowed[key]}=?`).join(",");
  db().prepare(`UPDATE alert_jobs SET ${sql},updated_at=? WHERE id=?`)
    .run(...entries.map(([, value]) => value == null ? null : value), Date.now(), id);
}

function saveJobAttachments(jobId, attachments) {
  const database = db();
  database.exec("BEGIN IMMEDIATE");
  try {
    database.prepare("DELETE FROM alert_job_attachments WHERE job_id=?").run(jobId);
    const insert = database.prepare("INSERT INTO alert_job_attachments(job_id,ordinal,filename,content) VALUES (?,?,?,?)");
    attachments.forEach((item, index) => insert.run(jobId, index, item.filename, item.buffer));
    database.exec("COMMIT");
  } catch (error) {
    database.exec("ROLLBACK");
    throw error;
  }
}

function pendingJobAttachments(jobId) {
  return db().prepare("SELECT ordinal,filename,content FROM alert_job_attachments WHERE job_id=? AND sent_at IS NULL ORDER BY ordinal")
    .all(jobId).map((row) => ({ ordinal: row.ordinal, filename: row.filename, buffer: Buffer.from(row.content) }));
}

function markJobAttachmentSent(jobId, ordinal) {
  db().prepare("UPDATE alert_job_attachments SET sent_at=? WHERE job_id=? AND ordinal=?").run(Date.now(), jobId, ordinal);
}

function listJobs(limit = 100) {
  return db().prepare(`
    SELECT j.*,i.name AS integration_name FROM alert_jobs j
    JOIN alert_integrations i ON i.id=j.integration_id
    ORDER BY j.created_at DESC LIMIT ?
  `).all(Math.max(1, Math.min(Number(limit) || 100, 500))).map(jobFromRow);
}

function retryJob(id) {
  const row = db().prepare("SELECT * FROM alert_jobs WHERE id=?").get(id);
  if (!row) throw new Error("Alert job not found");
  const hasAttachments = db().prepare("SELECT 1 FROM alert_job_attachments WHERE job_id=? LIMIT 1").get(id);
  const missingLegacyHtml = expectsHtmlAttachment(row.prompt) && !hasAttachments;
  const status = row.answer && !row.attachment_error && !missingLegacyHtml ? "delivery_pending" : "queued";
  if (status === "queued" || row.status === "delivered") {
    db().prepare("UPDATE alert_jobs SET text_delivered=0 WHERE id=?").run(id);
    db().prepare("UPDATE alert_job_attachments SET sent_at=NULL WHERE job_id=?").run(id);
  }
  db().prepare("UPDATE alert_jobs SET status=?,attempt_count=0,next_attempt_at=0,error=NULL,updated_at=? WHERE id=?")
    .run(status, Date.now(), id);
  return jobFromRow(db().prepare("SELECT * FROM alert_jobs WHERE id=?").get(id));
}

function markInterruptedJobs() {
  const now = Date.now();
  const analyses = db().prepare("UPDATE alert_jobs SET status='failed',error='Gateway restarted during RCA',updated_at=? WHERE status='analyzing'").run(now).changes;
  const deliveries = db().prepare("UPDATE alert_jobs SET status='delivery_pending',next_attempt_at=0,error='Gateway restarted during delivery',updated_at=? WHERE status='delivering'").run(now).changes;
  return analyses + deliveries;
}

function cleanupJobs() {
  const cutoff = Date.now() - runtimeConfig().alertJobRetentionDays * 86400 * 1000;
  return db().prepare("DELETE FROM alert_jobs WHERE updated_at<? AND status IN ('delivered','failed')").run(cutoff).changes;
}

module.exports = {
  bindChat,
  cleanupJobs,
  deleteIntegration,
  dueIntegrations,
  enqueueHistory,
  getIntegration,
  listIntegrations,
  listJobs,
  markInterruptedJobs,
  nextJob,
  saveJobAttachments,
  pendingJobAttachments,
  markJobAttachmentSent,
  retryJob,
  saveIntegration,
  setIntegrationEnabled,
  unbindChat,
  updateJob,
  updatePollState,
};
