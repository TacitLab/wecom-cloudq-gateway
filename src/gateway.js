"use strict";

const { generateReqId } = require("@wecom/aibot-node-sdk");
const {
  buildConversationKey,
  extractPrompt,
  isNewCommand,
  isStopCommand,
  normalizeGatewayCommand,
} = require("./conversation");
const alertStore = require("./alert-store");
const registry = require("./registry");
const store = require("./store");
const scheduler = require("./scheduler");
const { safeError } = require("./utils");
const taskControl = require("./task-control");

async function replyOnce(client, frame, content) {
  return client.replyStream(frame, generateReqId("stream"), content, true);
}

async function handleMessage(botConfigId, client, frame) {
  const pair = registry.pairForBot(botConfigId);
  if (!pair?.bot.enabled) return;
  const message = frame?.body || {};
  const rawPrompt = extractPrompt(message);
  if (!rawPrompt) {
    await replyOnce(client, frame, "当前版本暂只支持文本、语音转文字和图文混排中的文字。");
    return;
  }
  const prompt = normalizeGatewayCommand(rawPrompt, message.chattype, pair.bot.name);

  const watchBind = prompt.trim().match(/^\/bind-watch\s+([a-z0-9_-]+)$/i);
  if (watchBind) {
    if (message.chattype !== "group" || !message.chatid) {
      await replyOnce(client, frame, "请在需要接收值守事件的企业微信群内发送绑定指令。"); return;
    }
    try {
      const watch = require("./architecture-duty-store").bindChat(watchBind[1], botConfigId, message.chatid);
      await replyOnce(client, frame, `✅ 当前群已绑定为「${watch.archName}」的架构值守推送群。`);
    } catch (error) { await replyOnce(client, frame, `绑定失败：${safeError(error)}`); }
    return;
  }

  const bindMatch = prompt.trim().match(/^\/bind-alert\s+([a-z0-9_-]+)$/i);
  if (bindMatch) {
    if (message.chattype !== "group" || !message.chatid) {
      await replyOnce(client, frame, "请在需要接收告警的企业微信群内发送绑定指令。");
      return;
    }
    try {
      const integration = alertStore.bindChat(bindMatch[1], botConfigId, message.chatid);
      await replyOnce(client, frame, `✅ 当前群已绑定为「${integration.name}」的告警 RCA 推送群。`);
    } catch (error) {
      await replyOnce(client, frame, `绑定失败：${safeError(error)}`);
    }
    return;
  }

  const conversationKey = buildConversationKey(message, pair.pairKey, pair.bot.groupSessionScope);
  if (isStopCommand(prompt)) {
    const stoppedRunning = taskControl.stop(conversationKey);
    const cancelledQueued = store.cancelQueuedTasks(conversationKey);
    await Promise.allSettled(cancelledQueued.map((task) =>
      client.replyStream(task.frame, task.streamId, "⏹️ 当前任务已停止。", true)));
    const answer = stoppedRunning || cancelledQueued.length
      ? "⏹️ 已停止当前任务。会话上下文仍然保留。"
      : "当前会话没有正在执行的任务。";
    await replyOnce(client, frame, answer);
    return;
  }

  const externalMsgId = String(message.msgid || frame?.headers?.req_id || generateReqId("msg"));
  const claimed = store.enqueueTask({
    botConfigId: pair.bot.id,
    agentConfigId: pair.agent.id,
    conversationKey,
    externalMsgId,
    frame,
    command: isNewCommand(prompt) ? "new" : "message",
    content: prompt,
  });
  const task = claimed.task;

  if (!claimed.claimed) {
    const finished = ["completed", "failed", "cancelled"].includes(task.status);
    await client.replyStream(frame, task.streamId, task.answer || pair.bot.placeholder, finished);
    return;
  }

  await client.replyStream(frame, task.streamId, pair.bot.placeholder, false);
  scheduler.schedule(conversationKey);
}

async function handleEnterChat(botConfigId, client, frame) {
  const bot = registry.getBot(botConfigId);
  if (!bot?.enabled) return;
  await client.replyWelcome(frame, {
    msgtype: "text",
    text: { content: bot.welcomeText },
  });
}

function safeMessageHandler(botConfigId, client, frame) {
  handleMessage(botConfigId, client, frame).catch(async (error) => {
    console.error("wecom_message_failed", { botConfigId, message: safeError(error) });
    await replyOnce(client, frame, "消息网关处理失败，请稍后重试。").catch(() => {});
  });
}

module.exports = { handleEnterChat, handleMessage, safeMessageHandler };
