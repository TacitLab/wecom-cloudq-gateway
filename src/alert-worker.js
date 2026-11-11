"use strict";

const alertStore = require("./alert-store");
const notifier = require("./notifier");
const registry = require("./registry");
const { adapterFor } = require("./worker");
const { finalizeAgentText } = require("./agent");
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
      { showThinking: pair.bot.showThinking, htmlAttachments: true });
    const warnings = [...(response?.warnings || [])];
    const attachments = response?.stopReason === "end_turn" ? response.attachments || [] : [];
    if (response?.attachments?.length && response.stopReason !== "end_turn") warnings.push("Agent 未正常完成，HTML 附件未发送。请重新诊断。");
    const attachmentError = redact(warnings.join("\n"));
    const finalAnswer = redact(finalizeAgentText([answer || "诊断任务已完成，但 Agent 未返回文本结果。", ...warnings].join("\n\n")));
    const recordedPrompt = redact(credential ? `${prompt}\n\n${INJECTED_CREDENTIAL_NOTICE}` : prompt);
    alertStore.saveJobAttachments(job.id, attachments.map((item) => ({
      filename: redact(item.filename), buffer: Buffer.from(redact(item.buffer.toString("utf8")), "utf8"),
    })));
    alertStore.updateJob(job.id, {
      prompt: recordedPrompt,
      answer: finalAnswer,
      sessionId: conversation.sessionId,
      status: "delivery_pending",
      textDelivered: 0,
      attachmentError,
      nextAttemptAt: 0,
      error: response?.stopReason ? redact(`stopReason=${response.stopReason}`) : null,
    });
    console.info("alert_html_result", { jobId: job.id, attachmentCount: attachments.length, warningCount: warnings.length });
    return { ...job, prompt: recordedPrompt, answer: finalAnswer, textDelivered: false, attachmentError, sessionId: conversation.sessionId };
  } catch (error) {
    // SDK failures may include the sent request body. Do not propagate it to job history or logs.
    throw new Error(redact(safeError(error)));
  }
}

async function deliver(job, integration) {
  if (!integration.targetChatId) throw new Error("Target WeCom group is not bound");
  if (!job.textDelivered) {
    const parts = splitUtf8(job.answer);
    for (let index = 0; index < parts.length; index += 1) {
      const suffix = parts.length > 1 ? `\n\n（${index + 1}/${parts.length}）` : "";
      await notifier.sendMessage(integration.botConfigId, integration.targetChatId, parts[index] + suffix);
    }
    alertStore.updateJob(job.id, { textDelivered: 1 });
  }
  for (const attachment of alertStore.pendingJobAttachments(job.id)) {
    await notifier.sendHtmlAttachment(integration.botConfigId, integration.targetChatId, attachment);
    alertStore.markJobAttachmentSent(job.id, attachment.ordinal);
  }
  alertStore.updateJob(job.id, { status: job.attachmentError ? "failed" : "delivered", error: job.attachmentError || null });
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
