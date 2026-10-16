"use strict";

const alertStore = require("./alert-store");
const notifier = require("./notifier");
const registry = require("./registry");
const { adapterFor } = require("./worker");
const { finalizeAgentText } = require("./cloudagent");
const { safeError } = require("./utils");
const { defaultPrompt, renderPrompt } = require("./alert-prompt");
const { credentialRedactor, INJECTED_CREDENTIAL_NOTICE, withDiagnosticCredential } = require("./alert-credentials");

let active;

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
  const credential = integration.diagnosticCredentialId
    ? registry.getTencentCredential(integration.diagnosticCredentialId, { secrets: true }) : undefined;
  if (integration.diagnosticCredentialId && !credential) throw new Error("CloudQ diagnostic credential not found");
  const redact = credentialRedactor(credential);
  const adapter = adapterFor(pair.agent, { sensitive: Boolean(credential) });
  const prompt = renderPrompt(integration, job.payload);
  try {
    const conversation = await adapter.createConversation(`alert:${integration.id}:${job.eventKey}`);
    let answer = "";
    const response = await adapter.sendMessage(conversation,
      withDiagnosticCredential(prompt, credential, integration.region), (delta) => { answer += delta; },
      { showThinking: pair.bot.showThinking });
    const finalAnswer = redact(finalizeAgentText(answer || "诊断任务已完成，但 Agent 未返回文本结果。"));
    const recordedPrompt = redact(credential ? `${prompt}\n\n${INJECTED_CREDENTIAL_NOTICE}` : prompt);
    alertStore.updateJob(job.id, {
      prompt: recordedPrompt,
      answer: finalAnswer,
      runtimeId: conversation.runtimeId,
      sessionId: conversation.sessionId,
      status: "delivery_pending",
      nextAttemptAt: 0,
      error: response?.stopReason ? redact(`stopReason=${response.stopReason}`) : null,
    });
    return { ...job, prompt: recordedPrompt, answer: finalAnswer, runtimeId: conversation.runtimeId, sessionId: conversation.sessionId };
  } catch (error) {
    // SDK failures may include the sent request body. Do not propagate it to job history or logs.
    throw new Error(redact(safeError(error)));
  }
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
