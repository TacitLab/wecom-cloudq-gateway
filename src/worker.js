"use strict";

const { CloudAgentAdapter, finalizeAgentText, isConversationUnavailable } = require("./cloudagent");
const notifier = require("./notifier");
const registry = require("./registry");
const store = require("./store");
const taskControl = require("./task-control");
const { runtimeConfig } = require("./config");
const { safeError, truncateUtf8 } = require("./utils");

const adapters = new Map();

function adapterFor(agent, { sensitive = false } = {}) {
  const key = `${agent.id}:${agent.revision}${sensitive ? ":sensitive" : ""}`;
  if (!adapters.has(key)) adapters.set(key, new CloudAgentAdapter({
    ...agent, agentName: agent.name, ...(sensitive ? { logLevel: "off" } : {}),
  }));
  return adapters.get(key);
}

function failureMessage(error) {
  if (isConversationUnavailable(error)) return "当前会话已过期或不可用，请发送 /new 创建新会话。";
  return "处理失败，请稍后重试。发送 /new 可以重新开始会话。";
}

async function sendUpdate(task, content, finish) {
  const limit = runtimeConfig().streamMaxBytes;
  const answer = truncateUtf8(content, limit);
  store.updateTask(task.id, { answer });
  await notifier.replyStream(task.botConfigId, task.frame, task.streamId, answer, finish);
}

async function handleTask(task, options = {}) {
  const bot = registry.getBot(task.botConfigId);
  const agent = registry.getAgent(task.cloudAgentId, { secrets: true });
  if (!bot || !agent) throw new Error("Bot-Agent pairing was removed before the task started");
  const adapter = adapterFor(agent);
  const route = { botConfigId: bot.id, cloudAgentId: agent.id, agentRevision: agent.revision };

  if (task.command === "new") {
    const created = await adapter.createConversation(`${task.conversationKey}:${Date.now()}`, options);
    store.setConversation(task.conversationKey, route, created);
    const answer = "新会话已创建。接下来的消息会使用新的上下文。";
    await sendUpdate(task, answer, true);
    store.updateTask(task.id, { status: "completed", runtimeId: created.runtimeId, sessionId: created.sessionId });
    store.redactTask(task.id);
    return;
  }

  let conversation = store.conversation(task.conversationKey);
  if (!conversation) {
    conversation = await adapter.createConversation(`${task.conversationKey}:${Date.now()}`, options);
    store.setConversation(task.conversationKey, route, conversation);
  }

  let answer = "";
  let lastFlushAt = 0;
  let sendChain = Promise.resolve();
  let response;
  try {
    response = await adapter.sendMessage(conversation, task.content, (delta) => {
      answer += delta;
      const now = Date.now();
      if (now - lastFlushAt >= runtimeConfig().streamFlushIntervalMs) {
        lastFlushAt = now;
        const snapshot = answer;
        sendChain = sendChain.then(() => sendUpdate(task, snapshot, false)).catch((error) => {
          console.error("wecom_stream_update_failed", { taskId: task.id, message: safeError(error) });
        });
      }
    }, options);
  } finally {
    await sendChain;
  }

  const finalAnswer = finalizeAgentText(answer || "任务已完成。");
  await sendUpdate(task, finalAnswer, true);
  store.updateTask(task.id, {
    status: "completed",
    answer: finalAnswer,
    runtimeId: conversation.runtimeId,
    sessionId: conversation.sessionId,
    error: response?.stopReason ? `stopReason=${response.stopReason}` : null,
  });
  store.redactTask(task.id);
}

async function processConversation(conversationKey) {
  let processed = 0;
  while (true) {
    const task = store.nextTask(conversationKey);
    if (!task) break;
    processed += 1;
    const control = taskControl.begin(conversationKey, task.id);
    try {
      await handleTask(task, { signal: control.signal });
    } catch (error) {
      const cancelled = control.signal.aborted;
      const answer = cancelled ? "⏹️ 当前任务已停止。" : failureMessage(error);
      console.error("cloudagent_task_failed", {
        conversationKey,
        taskId: task.id,
        message: cancelled ? "Cancelled by user" : safeError(error),
      });
      store.updateTask(task.id, {
        status: cancelled ? "cancelled" : "failed",
        answer,
        error: cancelled ? "Cancelled by user" : safeError(error).slice(0, 500),
      });
      store.redactTask(task.id);
      await notifier.replyStream(task.botConfigId, task.frame, task.streamId, answer, true).catch(() => {});
    } finally {
      taskControl.finish(conversationKey, task.id);
    }
  }
  return { processed };
}

module.exports = { adapterFor, failureMessage, handleTask, processConversation };
