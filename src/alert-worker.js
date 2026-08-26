"use strict";

const alertStore = require("./alert-store");
const notifier = require("./notifier");
const registry = require("./registry");
const { adapterFor } = require("./worker");
const { finalizeAgentText } = require("./cloudagent");
const { safeError } = require("./utils");

let active;

function defaultPrompt(history) {
  const metrics = Array.isArray(history.MetricsInfo) ? history.MetricsInfo : [];
  return [
    "请对以下腾讯云可观测告警执行根因分析。使用企业智能体已配置并发布的诊断技能查询真实数据；不要编造未查询到的指标或根因。",
    "",
    "请按以下结构输出：",
    "### 告警概述",
    "### 根因分析",
    "### 影响范围",
    "### 处置建议",
    "### 数据与权限异常（没有则省略）",
    "",
    "【告警数据】",
    `告警 ID：${history.AlarmId || ""}`,
    `状态：${history.AlarmStatus || ""}`,
    `对象：${history.AlarmObject || ""}`,
    `地域：${history.Region || ""}`,
    `策略：${history.PolicyName || ""} (${history.PolicyId || ""})`,
    `类型：${history.MonitorType || ""}/${history.Namespace || ""}`,
    `级别：${history.AlarmLevel || ""}`,
    `首次发生：${history.FirstOccurTime || ""}`,
    `最后发生：${history.LastOccurTime || ""}`,
    `内容：${history.Content || ""}`,
    `维度：${history.Dimensions || history.InternalDimensions || ""}`,
    `指标：${JSON.stringify(metrics)}`,
  ].join("\n");
}

function renderPrompt(integration, history) {
  if (!integration.promptTemplate) return defaultPrompt(history);
  const replacements = {
    alarm_json: JSON.stringify(history, null, 2),
    alarm_id: history.AlarmId || "",
    alarm_object: history.AlarmObject || "",
    alarm_content: history.Content || "",
    policy_name: history.PolicyName || "",
    region: history.Region || "",
  };
  return integration.promptTemplate.replace(/\{\{([a-z_]+)\}\}/gi, (match, key) =>
    Object.hasOwn(replacements, key) ? String(replacements[key]) : match);
}

function splitUtf8(value, maxBytes = 3800) {
  const parts = [];
  let current = "";
  for (const char of String(value || "")) {
    if (current && Buffer.byteLength(current + char, "utf8") > maxBytes) {
      parts.push(current);
      current = char;
    } else {
      current += char;
    }
  }
  if (current || !parts.length) parts.push(current);
  return parts;
}

async function analyze(job, integration) {
  const pair = registry.pairForBot(integration.botConfigId);
  if (!pair?.bot.enabled) throw new Error("Configured Bot is disabled or unavailable");
  const adapter = adapterFor(pair.agent);
  const prompt = renderPrompt(integration, job.payload);
  const conversation = await adapter.createConversation(`alert:${integration.id}:${job.eventKey}`);
  let answer = "";
  const response = await adapter.sendMessage(conversation, prompt, (delta) => { answer += delta; });
  const finalAnswer = finalizeAgentText(answer || "诊断任务已完成，但 Agent 未返回文本结果。");
  alertStore.updateJob(job.id, {
    prompt,
    answer: finalAnswer,
    runtimeId: conversation.runtimeId,
    sessionId: conversation.sessionId,
    status: "delivery_pending",
    nextAttemptAt: 0,
    error: response?.stopReason ? `stopReason=${response.stopReason}` : null,
  });
  return { ...job, prompt, answer: finalAnswer, runtimeId: conversation.runtimeId, sessionId: conversation.sessionId };
}

async function deliver(job, integration) {
  if (!integration.targetChatId) throw new Error("Target WeCom group is not bound");
  const prefix = `🚨 **${integration.name}**\n\n`;
  const parts = splitUtf8(prefix + job.answer);
  for (let index = 0; index < parts.length; index += 1) {
    const suffix = parts.length > 1 ? `\n\n（${index + 1}/${parts.length}）` : "";
    await notifier.sendMessage(integration.botConfigId, integration.targetChatId, parts[index] + suffix);
  }
  alertStore.updateJob(job.id, { status: "delivered", error: null });
}

async function handleJob(job) {
  const integration = alertStore.getIntegration(job.integrationId, { secrets: true });
  if (!integration) throw new Error("Alert integration was removed");
  if (job.status === "analyzing") job = await analyze(job, integration);
  try {
    await deliver(job, integration);
  } catch (error) {
    const attemptCount = Number(job.attemptCount || 0) + 1;
    const retryable = attemptCount < 5;
    alertStore.updateJob(job.id, {
      status: retryable ? "delivery_pending" : "failed",
      attemptCount,
      nextAttemptAt: retryable ? Date.now() + Math.min(600000, 15000 * 2 ** (attemptCount - 1)) : 0,
      error: safeError(error).slice(0, 500),
    });
    if (!retryable) throw error;
  }
}

async function processPending() {
  let processed = 0;
  while (true) {
    const job = alertStore.nextJob();
    if (!job) break;
    processed += 1;
    try {
      await handleJob(job);
    } catch (error) {
      if (job.status === "analyzing") {
        alertStore.updateJob(job.id, { status: "failed", error: safeError(error).slice(0, 500) });
      }
      console.error("alert_job_failed", { jobId: job.id, message: safeError(error) });
    }
  }
  return { processed };
}

function schedule() {
  if (active) return active;
  active = processPending().finally(() => { active = undefined; });
  return active;
}

async function drain() {
  if (active) await active;
}

module.exports = { defaultPrompt, drain, handleJob, processPending, renderPrompt, schedule, splitUtf8 };
