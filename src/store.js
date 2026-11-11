"use strict";

const crypto = require("node:crypto");
const { db } = require("./database");
const { runtimeConfig } = require("./config");

function conversation(key) {
  const row = db().prepare("SELECT * FROM wma_conversations WHERE conversation_key = ?").get(key);
  if (!row) return undefined;
  return {
    sessionId: row.session_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function setConversation(key, route, value) {
  const now = Date.now();
  db().prepare(`
    INSERT INTO wma_conversations (conversation_key,bot_config_id,agent_config_id,agent_revision,session_id,created_at,updated_at)
    VALUES (?,?,?,?,?,?,?)
    ON CONFLICT(conversation_key) DO UPDATE SET session_id=excluded.session_id,updated_at=excluded.updated_at
  `).run(key, route.botConfigId, route.agentConfigId, route.agentRevision, String(value.sessionId), value.createdAt || now, now);
}

function enqueueTask(input) {
  const now = Date.now();
  const task = {
    id: crypto.randomUUID(),
    streamId: crypto.randomUUID(),
    ...input,
    status: "queued",
    answer: "",
    createdAt: now,
    updatedAt: now,
  };
  try {
    db().prepare(`
      INSERT INTO wma_tasks (id,bot_config_id,agent_config_id,conversation_key,external_msg_id,frame_json,stream_id,command,content,status,answer,created_at,updated_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)
    `).run(task.id, task.botConfigId, task.agentConfigId, task.conversationKey, task.externalMsgId, JSON.stringify(task.frame), task.streamId, task.command, task.content, task.status, task.answer, now, now);
    return { claimed: true, task };
  } catch (error) {
    if (!/UNIQUE constraint failed/i.test(String(error?.message))) throw error;
    const existing = db().prepare("SELECT * FROM wma_tasks WHERE bot_config_id=? AND external_msg_id=?").get(input.botConfigId, input.externalMsgId);
    return { claimed: false, task: taskFromRow(existing) };
  }
}

function taskFromRow(row) {
  if (!row) return undefined;
  return {
    id: row.id,
    botConfigId: row.bot_config_id,
    agentConfigId: row.agent_config_id,
    conversationKey: row.conversation_key,
    externalMsgId: row.external_msg_id,
    frame: JSON.parse(row.frame_json),
    streamId: row.stream_id,
    command: row.command,
    content: row.content,
    status: row.status,
    answer: row.answer,
    error: row.error,
    sessionId: row.session_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function nextTask(conversationKey) {
  const database = db();
  const row = database.prepare("SELECT * FROM wma_tasks WHERE conversation_key=? AND status='queued' ORDER BY created_at LIMIT 1").get(conversationKey);
  if (!row) return undefined;
  database.prepare("UPDATE wma_tasks SET status='running',updated_at=? WHERE id=? AND status='queued'").run(Date.now(), row.id);
  return taskFromRow({ ...row, status: "running" });
}

function updateTask(id, patch) {
  const allowed = {
    status: "status",
    answer: "answer",
    error: "error",
    sessionId: "session_id",
  };
  const entries = Object.entries(patch).filter(([key]) => allowed[key]);
  if (!entries.length) return;
  const sql = entries.map(([key]) => `${allowed[key]}=?`).join(",");
  db().prepare(`UPDATE wma_tasks SET ${sql},updated_at=? WHERE id=?`).run(...entries.map(([, value]) => value == null ? null : String(value)), Date.now(), id);
}

function redactTask(id) {
  db().prepare("UPDATE wma_tasks SET content='',frame_json='{}',updated_at=? WHERE id=?").run(Date.now(), id);
}

function queuedConversationKeys() {
  return db().prepare("SELECT DISTINCT conversation_key FROM wma_tasks WHERE status='queued'").all().map((row) => row.conversation_key);
}

function cancelQueuedTasks(conversationKey) {
  const database = db();
  const rows = database.prepare(
    "SELECT * FROM wma_tasks WHERE conversation_key=? AND status='queued' ORDER BY created_at",
  ).all(conversationKey);
  if (!rows.length) return [];
  const now = Date.now();
  database.prepare(`
    UPDATE wma_tasks
    SET status='cancelled',answer='任务已停止。',error='Cancelled by user',content='',frame_json='{}',updated_at=?
    WHERE conversation_key=? AND status='queued'
  `).run(now, conversationKey);
  return rows.map((row) => taskFromRow({
    ...row,
    status: "cancelled",
    answer: "任务已停止。",
    error: "Cancelled by user",
    updated_at: now,
  }));
}

function markInterruptedTasks() {
  return db().prepare("UPDATE wma_tasks SET status='failed',answer='网关在任务完成前发生重启，请重新发送消息。',error='Gateway restarted before task completion',content='',frame_json='{}',updated_at=? WHERE status IN ('queued','running')").run(Date.now()).changes;
}

function cleanup() {
  const cutoff = Date.now() - runtimeConfig().taskRetentionSeconds * 1000;
  return db().prepare("DELETE FROM wma_tasks WHERE updated_at < ? AND status IN ('completed','failed','cancelled')").run(cutoff).changes;
}

module.exports = {
  cleanup,
  cancelQueuedTasks,
  conversation,
  enqueueTask,
  markInterruptedTasks,
  nextTask,
  queuedConversationKeys,
  redactTask,
  setConversation,
  updateTask,
};
