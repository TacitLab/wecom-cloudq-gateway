"use strict";

const crypto = require("node:crypto");
const { db } = require("./database");
const registry = require("./registry");
const watches = require("./architecture-watch");
const { normalizeApplications } = require("./apm");

const DEFAULTS = { pollIntervalSeconds: 60,
  rcaEnabled: false, schedule: { allDay: true, start: "09:00", end: "18:00", days: [0, 1, 2, 3, 4, 5, 6] }, products: {}, apmApplications: [] };

function getSettings(id) {
  watches.getWatch(id);
  let row = db().prepare("SELECT * FROM architecture_watch_settings WHERE watch_id=?").get(id);
  if (!row) {
    db().prepare(`INSERT INTO architecture_watch_settings(watch_id,bind_code,config_json,updated_at) VALUES(?,?,?,?)`)
      .run(id, crypto.randomBytes(8).toString("hex").toUpperCase(), JSON.stringify(DEFAULTS), Date.now());
    row = db().prepare("SELECT * FROM architecture_watch_settings WHERE watch_id=?").get(id);
  }
  const stored = JSON.parse(row.config_json);
  // Drop the retired local CPU/memory thresholds when reading old settings.
  const config = { pollIntervalSeconds: stored.pollIntervalSeconds ?? 60, rcaEnabled: Boolean(stored.rcaEnabled),
    apmApplications: normalizeApplications(stored.apmApplications),
    schedule: stored.schedule || structuredClone(DEFAULTS.schedule),
    products: Object.fromEntries(Object.entries(stored.products || {}).map(([key, value]) => [key, {
      enabled: Boolean(value.enabled), alarms: Boolean(value.alarms), metrics: Boolean(value.metrics), resourceIds: value.resourceIds || [],
    }])) };
  return { ...config, enabled: Boolean(row.enabled), botConfigId: row.bot_config_id || "",
    targetChatId: row.target_chat_id || "", targetChatName: row.target_chat_name || "",
    bindCode: row.bind_code, revision: row.revision, lastAttemptAt: row.last_attempt_at, lastSuccessAt: row.last_success_at,
    lastError: row.last_error || "", updatedAt: row.updated_at };
}

function integer(value, min, max, label) {
  if (!Number.isSafeInteger(value) || value < min || value > max) throw new Error(`Invalid ${label}: ${min}–${max}`);
  return value;
}

function validateConfig(input, detail) {
  const config = {
    pollIntervalSeconds: integer(input.pollIntervalSeconds, 30, 3600, "检查间隔"),
    rcaEnabled: Boolean(input.rcaEnabled), products: {}, apmApplications: normalizeApplications(input.apmApplications),
  };
  const schedule = input.schedule;
  if (!schedule || !/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(schedule.start) || !/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(schedule.end)
    || !Array.isArray(schedule.days) || !schedule.days.length || schedule.days.some(day => !Number.isInteger(day) || day < 0 || day > 6)
    || (!schedule.allDay && schedule.start === schedule.end)) throw new Error("Invalid 值守时段，请选择星期和有效的起止时间");
  config.schedule = { allDay: Boolean(schedule.allDay), start: schedule.start, end: schedule.end, days: [...new Set(schedule.days)] };
  if (!input.products || typeof input.products !== "object" || Array.isArray(input.products)) throw new Error("Invalid 产品值守设置");
  for (const [key, value] of Object.entries(input.products)) {
    const product = detail.products.find(p => p.id === key);
    if (!product || !value || typeof value !== "object") throw new Error("Invalid 产品选择，请刷新架构图后重新选择");
    if (value.metrics && !product.capacitySupported) throw new Error(`Invalid ${product.product} 无法读取智能顾问容量监测`);
    const ids = value.resourceIds ?? [];
    if (!Array.isArray(ids) || ids.some(id => typeof id !== "string" || !detail.resources.some(r => r.productKey === key && r.id === id))) {
      throw new Error("Invalid 指定资源范围，资源必须属于当前架构图及产品");
    }
    config.products[key] = { enabled: Boolean(value.enabled), alarms: Boolean(value.alarms), metrics: Boolean(value.metrics),
      resourceIds: [...new Set(ids)] };
  }
  return config;
}

function saveSettings(id, input, detail) {
  const previous = getSettings(id), config = validateConfig({ ...input, apmApplications: input.apmApplications ?? previous.apmApplications }, detail);
  const botConfigId = input.botConfigId || null;
  const bot = botConfigId ? registry.getBot(botConfigId) : undefined;
  if (botConfigId && (!bot || !bot.enabled || !bot.agentConfigId)) throw new Error("Invalid Bot，请选择已启用并绑定 Agent 的 Bot");
  if (input.enabled && (!bot || (!Object.values(config.products).some(p => p.enabled) && !config.apmApplications.length))) throw new Error("Invalid 启用值守前请选择推送 Bot 及至少一个产品或 APM 应用");
  const botChanged = previous.botConfigId !== (botConfigId || "");
  // A new Bot requires a fresh in-group binding. Enabling is allowed before
  // binding, but the scheduler will not collect or deliver until it is bound.
  db().prepare(`UPDATE architecture_watch_settings SET enabled=?,bot_config_id=?,diagnostic_credential_id=?,config_json=?,
    bind_code=?,target_chat_id=?,target_chat_name=?,revision=revision+1,last_attempt_at=NULL,last_success_at=NULL,last_error=NULL,updated_at=? WHERE watch_id=?`)
    .run(input.enabled ? 1 : 0, botConfigId, null, JSON.stringify(config),
      botChanged ? crypto.randomBytes(8).toString("hex").toUpperCase() : previous.bindCode,
      botChanged ? null : previous.targetChatId || null, botChanged ? null : previous.targetChatName || null, Date.now(), id);
  db().prepare("DELETE FROM architecture_watch_signals WHERE watch_id=?").run(id);
  if (botChanged) db().prepare("DELETE FROM architecture_capacity_signals WHERE watch_id=?").run(id);
  return getSettings(id);
}

function setEnabled(id, enabled, detail) {
  if (typeof enabled !== "boolean") throw new Error("Invalid 值守开关");
  const current = getSettings(id);
  if (enabled) {
    validateConfig(current, detail);
    const bot = registry.getBot(current.botConfigId);
    if (!bot?.enabled || !bot.agentConfigId || (!Object.values(current.products).some(p => p.enabled) && !current.apmApplications.length)) {
      throw new Error("Invalid 请先在值守设置中配置推送 Bot 和产品范围或 APM 应用");
    }
  }
  db().prepare("UPDATE architecture_watch_settings SET enabled=?,revision=revision+1,updated_at=? WHERE watch_id=?")
    .run(enabled ? 1 : 0, Date.now(), id);
  return getSettings(id);
}

function bindChat(code, botConfigId, chatId) {
  const row = db().prepare("SELECT * FROM architecture_watch_settings WHERE bind_code=?").get(String(code).toUpperCase());
  if (!row || row.bot_config_id !== botConfigId) throw new Error("Invalid 值守绑定码或接收 Bot 不匹配");
  if (row.target_chat_id && row.target_chat_id !== chatId) throw new Error("值守已绑定其他群，请先在详情页解除绑定");
  db().prepare("UPDATE architecture_watch_settings SET target_chat_id=?,revision=revision+1,updated_at=? WHERE watch_id=?").run(chatId, Date.now(), row.watch_id);
  return watches.getWatch(row.watch_id);
}

function unbind(id) {
  getSettings(id);
  db().prepare("UPDATE architecture_watch_settings SET enabled=0,target_chat_id=NULL,target_chat_name=NULL,bind_code=?,revision=revision+1,updated_at=? WHERE watch_id=?")
    .run(crypto.randomBytes(8).toString("hex").toUpperCase(), Date.now(), id);
  db().prepare("DELETE FROM architecture_capacity_signals WHERE watch_id=?").run(id);
  return getSettings(id);
}

function scheduleWindow(schedule, now = Date.now()) {
  // Duty schedules use Asia/Shanghai, independent of server host timezone.
  const local = new Date(now + 8 * 3600000), midnight = Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate()) - 8 * 3600000;
  const minute = local.getUTCHours() * 60 + local.getUTCMinutes(), day = local.getUTCDay();
  if (schedule.allDay) return schedule.days.includes(day) ? { start: midnight, end: midnight + 86400000 } : null;
  const minutes = value => Number(value.slice(0, 2)) * 60 + Number(value.slice(3));
  const start = minutes(schedule.start), end = minutes(schedule.end);
  if (start < end) return schedule.days.includes(day) && minute >= start && minute < end
    ? { start: midnight + start * 60000, end: midnight + end * 60000 } : null;
  if (minute >= start && schedule.days.includes(day)) return { start: midnight + start * 60000, end: midnight + (1440 + end) * 60000 };
  if (minute < end && schedule.days.includes((day + 6) % 7)) return { start: midnight + (start - 1440) * 60000, end: midnight + end * 60000 };
  return null;
}

function enqueue(id, settings, event) {
  const eventId = event.id || crypto.randomUUID();
  const destination = { botConfigId: settings.botConfigId, chatId: settings.targetChatId,
    revision: settings.revision };
  const result = db().prepare(`INSERT OR IGNORE INTO architecture_watch_events
    (id,watch_id,event_key,type,title,resource_id,product,region,payload_json,destination_json,rca_enabled,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`)
    .run(eventId, id, event.key, event.type, event.title, event.resourceId, event.product, event.region || "",
      JSON.stringify(event.payload), JSON.stringify(destination), settings.rcaEnabled && event.type !== "recovery" ? 1 : 0, Date.now());
  return Boolean(result.changes);
}

function eventFromRow(row) {
  return { id: row.id, watchId: row.watch_id, type: row.type, title: row.title, resourceId: row.resource_id, product: row.product,
    region: row.region, payload: JSON.parse(row.payload_json), notifiedAt: row.notified_at, rcaEnabled: Boolean(row.rca_enabled),
    analysisStatus: row.analysis_status, analysis: row.analysis, completedAt: row.completed_at, attempts: row.attempts,
    error: row.error || "", createdAt: row.created_at };
}

function history(id, page = 1) {
  watches.getWatch(id); integer(Number(page), 1, 100000, "历史页码");
  const totalCount = db().prepare("SELECT COUNT(*) AS count FROM architecture_watch_events WHERE watch_id=?").get(id).count;
  const items = db().prepare("SELECT * FROM architecture_watch_events WHERE watch_id=? ORDER BY created_at DESC,id LIMIT 20 OFFSET ?").all(id, (Number(page) - 1) * 20).map(eventFromRow);
  const checks = db().prepare("SELECT * FROM architecture_watch_checks WHERE watch_id=? ORDER BY created_at DESC LIMIT 20").all(id)
    .map(row => ({ id: row.id, ...JSON.parse(row.summary_json), error: row.error || "", createdAt: row.created_at }));
  return { items, checks, totalCount, pageNumber: Number(page), pageSize: 20 };
}

function retryEvent(watchId, eventId) {
  const row = db().prepare("SELECT * FROM architecture_watch_events WHERE id=? AND watch_id=?").get(eventId, watchId);
  if (!row) throw new Error("Duty event not found");
  if (row.completed_at || row.analysis_status === "running") throw new Error("Invalid 事件已完成或仍在分析中");
  db().prepare("UPDATE architecture_watch_events SET attempts=0,next_attempt_at=0,error=NULL,analysis_status=CASE WHEN analysis_status='failed' THEN 'pending' ELSE analysis_status END WHERE id=?").run(eventId);
}

module.exports = { DEFAULTS, getSettings, saveSettings, setEnabled, bindChat, unbind, scheduleWindow, enqueue, history, eventFromRow, retryEvent };
