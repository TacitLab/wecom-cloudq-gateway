"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "alert-html-"));
process.env.ADMIN_PASSWORD = "test-password";
process.env.SQLITE_PATH = path.join(temporary, "test.db");

const { db, closeDatabase } = require("../src/database");
const registry = require("../src/registry");
const alertStore = require("../src/alert-store");
const alertWorker = require("../src/alert-worker");
const notifier = require("../src/notifier");
const { adapterFor } = require("../src/worker");

test.after(() => { closeDatabase(); fs.rmSync(temporary, { recursive: true, force: true }); });

let sequence = 0;
function fixture({ showThinking = false, credential = false } = {}) {
  const index = sequence++;
  const agent = registry.saveAgent({ credentialConfigId: registry.saveWmaCredential({ name: "WMA test", secretId: "AKID_test", secretKey: "test-secret" }).id, name: "CloudQ", agentId: `agent_HTML_${index}`, });
  const bot = registry.saveBot({ name: "Bot", botId: `alert-html-${index}`, secret: "bot-secret", agentConfigId: agent.id, showThinking });
  const polling = registry.saveTencentCredential({ name: "Poll", secretId: "AKID_POLL", secretKey: "poll-key" });
  const diagnostic = credential ? registry.saveTencentCredential({ name: "Diag", secretId: "AKID_DIAG_HTML", secretKey: "diag-html-secret-example" }) : undefined;
  const integration = alertStore.saveIntegration({ name: "APM 诊断 Demo", botConfigId: bot.id, credentialId: polling.id,
    diagnosticCredentialId: diagnostic?.id, region: "ap-guangzhou", promptTemplate: "请先输出简报，再输出完整的 HTML 报告：{{alarm_content}}" });
  const chatId = `group-${index}`;
  alertStore.bindChat(integration.bindCode, bot.id, chatId);
  const { id: jobId } = alertStore.enqueueHistory(integration.id, { AlarmId: `alarm-${index}`, Content: "Redis 慢查询" });
  const adapter = adapterFor(registry.getAgent(agent.id, { secrets: true }), { sensitive: credential });
  adapter.createConversation = async () => ({ sessionId: "s" });
  return { agent, bot, integration, chatId, jobId, adapter,
    diagnostic: diagnostic ? registry.getTencentCredential(diagnostic.id, { secrets: true }) : undefined };
}

function installSession(adapter, prompt) {
  adapter.client = { session: async () => ({ connect: async () => {}, disconnect: async () => {}, prompt }) };
}

function textChunk(text, messageId) {
  return { update: { sessionUpdate: "agent_message_chunk", messageId, content: { type: "text", text } } };
}

for (const showThinking of [true, false]) {
  test(`RCA summary-only reply is exported as a proactive HTML attachment (thinking=${showThinking})`, async () => {
    const f = fixture({ showThinking });
    let prompts = 0;
    const html = '<!DOCTYPE html>\n<html lang="zh"><head><meta charset="utf-8"></head><body>证据链与处置建议</body></html>\n';
    installSession(f.adapter, async (input, options) => {
      prompts += 1;
      if (prompts === 1) {
        assert.match(input, /先输出简报/);
        assert.match(input, /wecom_attachment_delivery/);
        options.onChunk(textChunk("报告已生成并展示完毕。根因：Redis 延迟。置信度 85%。", "brief"));
      } else options.onChunk(textChunk('```wecom-html filename="根因报告.html"\n' + html + '```\n', "export"));
      return { stopReason: "end_turn" };
    });
    const messages = [];
    const files = [];
    notifier.register(f.bot.id, { isConnected: true,
      async sendMessage(chatId, message) { messages.push({ chatId, message }); return {}; },
      async uploadMedia(buffer, options) { files.push({ buffer, options }); return { media_id: "media-html" }; },
      async sendMediaMessage(...args) { assert.deepEqual(args, [f.chatId, "file", "media-html"]); return { body: { errcode: 0 } }; },
    });
    try {
      await alertWorker.processPending();
      assert.equal(prompts, 2);
      assert.equal(messages.length, 1);
      assert.equal(messages[0].chatId, f.chatId);
      assert.equal(messages[0].message.markdown.content.startsWith(showThinking ? "💬 报告已生成" : "报告已生成"), true);
      assert.doesNotMatch(messages[0].message.markdown.content, /<html>|证据链与处置建议/);
      assert.deepEqual(files[0], { buffer: Buffer.from(html), options: { type: "file", filename: "根因报告.html" } });
      const job = alertStore.listJobs().find((job) => job.id === f.jobId);
      assert.equal(job.status, "delivered");
      assert.equal(job.textDelivered, true);
      assert.equal(alertStore.pendingJobAttachments(f.jobId).length, 0);
      assert.equal("attachments" in job, false);
    } finally { notifier.unregister(f.bot.id); }
  });
}

test("attachment retries survive reopening SQLite and do not resend the brief or successful files", async () => {
  const f = fixture();
  let prompts = 0;
  installSession(f.adapter, async (_input, options) => {
    prompts += 1;
    options.onChunk(textChunk('简报\n```wecom-html filename="one.html"\n<html>one</html>\n```\n```wecom-html filename="two.html"\n<html>two</html>\n```\n'));
    return { stopReason: "end_turn" };
  });
  let messages = 0;
  let failSecond = true;
  const uploads = [];
  notifier.register(f.bot.id, { isConnected: true,
    async sendMessage() { messages += 1; return {}; },
    async uploadMedia(_buffer, options) { uploads.push(options.filename); return { media_id: options.filename }; },
    async sendMediaMessage(_chat, _type, mediaId) { if (mediaId === "two.html" && failSecond) throw new Error("connection lost"); return {}; },
  });
  try {
    await alertWorker.processPending();
    assert.equal(alertStore.listJobs().find((job) => job.id === f.jobId).status, "delivery_pending");
    assert.deepEqual(alertStore.pendingJobAttachments(f.jobId).map((item) => item.filename), ["two.html"]);
    closeDatabase();
    alertStore.updateJob(f.jobId, { nextAttemptAt: 0 });
    failSecond = false;
    await alertWorker.processPending();
    assert.equal(prompts, 1);
    assert.equal(messages, 1);
    assert.deepEqual(uploads, ["one.html", "two.html", "two.html"]);
    assert.equal(alertStore.listJobs().find((job) => job.id === f.jobId).status, "delivered");
  } finally { notifier.unregister(f.bot.id); }
});

test("missing HTML fails explicitly and retry regenerates rather than resending only the summary", async () => {
  const f = fixture();
  let prompts = 0;
  installSession(f.adapter, async (_input, options) => { prompts += 1; options.onChunk(textChunk("报告已生成并展示完毕。")); return { stopReason: "end_turn" }; });
  const messages = [];
  notifier.register(f.bot.id, { isConnected: true, async sendMessage(_chat, message) { messages.push(message.markdown.content); return {}; } });
  try {
    await alertWorker.processPending();
    assert.equal(prompts, 2);
    const job = alertStore.listJobs().find((job) => job.id === f.jobId);
    assert.equal(job.status, "failed");
    assert.match(job.error, /报告附件未发送/);
    assert.match(messages[0], /报告附件未发送/);
    assert.equal(alertStore.retryJob(f.jobId).status, "queued");
    // Simulate an old job from the previous release with no attachment_error.
    alertStore.updateJob(f.jobId, { status: "delivered", attachmentError: "" });
    assert.equal(alertStore.retryJob(f.jobId).status, "queued");
    alertStore.updateJob(f.jobId, { status: "failed" });
  } finally { notifier.unregister(f.bot.id); }
});

test("diagnostic credentials are redacted from stored and sent HTML attachments", async () => {
  const f = fixture({ credential: true });
  installSession(f.adapter, async (_input, options) => {
    options.onChunk(textChunk(`简报\n\`\`\`wecom-html filename="report.html"\n<html>${f.diagnostic.secretId} ${f.diagnostic.secretKey}</html>\n\`\`\`\n`));
    return { stopReason: "end_turn" };
  });
  let sentHtml;
  notifier.register(f.bot.id, { isConnected: true, async sendMessage() { return {}; },
    async uploadMedia(buffer) { sentHtml = buffer.toString(); return { media_id: "m" }; }, async sendMediaMessage() { return {}; } });
  try {
    await alertWorker.processPending();
    assert.match(sentHtml, /REDACTED/);
    const stored = Buffer.from(db().prepare("SELECT content FROM alert_job_attachments WHERE job_id=?").get(f.jobId).content).toString();
    for (const value of [f.diagnostic.secretId, f.diagnostic.secretKey]) {
      assert.equal(sentHtml.includes(value), false);
      assert.equal(stored.includes(value), false);
    }
    assert.equal(alertStore.listJobs().find((job) => job.id === f.jobId).status, "delivered");
  } finally { notifier.unregister(f.bot.id); }
});
