"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "duty-html-"));
process.env.ADMIN_PASSWORD = "test-password";
process.env.SQLITE_PATH = path.join(temporary, "test.db");

const { db, closeDatabase } = require("../src/database");
const registry = require("../src/registry");
const duty = require("../src/architecture-duty-store");
const worker = require("../src/architecture-duty-worker");
const notifier = require("../src/notifier");
const { adapterFor } = require("../src/worker");

test.beforeEach(() => db().exec(`DELETE FROM architecture_watches; DELETE FROM wecom_bots;
  DELETE FROM wma_agents; DELETE FROM wma_credentials; DELETE FROM tencent_credentials;`));
test.after(() => { closeDatabase(); fs.rmSync(temporary, { recursive: true, force: true }); });

let sequence = 0;
async function fixture(t, prompt) {
  const credential = registry.saveTencentCredential({ name: "Cloud", secretId: "AKID_DUTY_HTML", secretKey: "cloud-html-secret" });
  const key = registry.saveWmaCredential({ name: "WMA", secretId: "AKID_CONTROL", secretKey: "wma-secret" });
  const agent = registry.saveAgent({ name: "SRE", credentialConfigId: key.id, agentId: `agent-duty-html-${sequence++}` });
  const bot = registry.saveBot({ name: "Duty", botId: `bot-html-${sequence}`, secret: "bot-secret", agentConfigId: agent.id });
  db().prepare("INSERT INTO architecture_watches(id,credential_id,arch_id,arch_name,created_at) VALUES(?,?,?,?,?)")
    .run("watch-html", credential.id, "arch-html", "生产架构", Date.now());
  const detail = { products: [{ id: "cvm", product: "CVM" }], resources: [] };
  const settings = duty.saveSettings("watch-html", { ...duty.DEFAULTS, enabled: true, botConfigId: bot.id,
    rcaEnabled: true, products: { cvm: { enabled: true, alarms: true } } }, detail);
  duty.bindChat(settings.bindCode, bot.id, "group-html");
  duty.enqueue("watch-html", duty.getSettings("watch-html"), { key: "alarm", type: "alarm", title: "延迟异常",
    product: "CVM", region: "ap-guangzhou", resourceId: "ins-test", payload: {} });
  await worker.deliverNotifications({ sendMessage: async () => {} });
  const adapter = adapterFor(registry.getAgent(agent.id, { secrets: true }));
  adapter.createConversation = async () => ({ sessionId: "duty-session" });
  adapter.client = { session: async () => ({ connect: async () => {}, disconnect: async () => {}, prompt }) };
  t.after(() => notifier.unregister(bot.id));
  return { bot, agent, credential, adapter, eventId: duty.history("watch-html").items[0].id };
}

const chunk = text => ({ update: { sessionUpdate: "agent_message_chunk", content: { type: "text", text } } });
const report = (filename, html) => `\n\`\`\`wecom-html filename="${filename}"\n${html}\n\`\`\`\n`;
const event = () => duty.history("watch-html").items[0];

test("duty RCA sends a clean brief and exports detailed HTML in the same conversation", async t => {
  let prompts = 0;
  const html = '<!DOCTYPE html><html lang="zh"><head><meta charset="utf-8"></head><body>生产架构 arch-html：关键证据、时间线与建议</body></html>';
  const f = await fixture(t, async (input, options) => {
    prompts++;
    if (prompts === 1) {
      assert.match(input, /只读 RCA/); assert.match(input, /不执行修复或资源变更/);
      assert.match(input, /完整 HTML 报告附件/); assert.match(input, /wecom_attachment_delivery/);
      options.onChunk(chunk("已完成只读 RCA 分析，云端专家返回结果如下（原样呈现）：\n---\n**架构图：生产架构 | ID： `arch-html`**\n\n### 结论\nRedis 拨号超时；置信度高。建议检查连接与网络。"));
    } else {
      assert.match(input, /不要重复诊断/);
      options.onChunk(chunk(report("值守分析.html", html)));
    }
    return { stopReason: "end_turn" };
  });
  const messages = [], uploads = [];
  notifier.register(f.bot.id, { isConnected: true,
    async sendMessage(group, message) { assert.equal(group, "group-html"); messages.push(message.markdown.content); return {}; },
    async uploadMedia(buffer, options) { uploads.push({ buffer, options }); return { media_id: "report" }; },
    async sendMediaMessage(...args) { assert.deepEqual(args, ["group-html", "file", "report"]); return {}; },
  });
  await worker.processAnalyses();
  assert.equal(prompts, 2); assert.equal(messages.length, 1);
  assert.match(messages[0], /Redis 拨号超时/); assert.match(messages[0], /详细分析见 HTML 报告附件/);
  assert.doesNotMatch(messages[0], /已完成只读|云端专家|原样呈现|生产架构 \| ID|<html|关键证据、时间线|已生成 HTML 文件/);
  assert.equal((messages[0].match(/\*\*架构图 ID：/g) || []).length, 1);
  assert.deepEqual(uploads, [{ buffer: Buffer.from(`${html}\n`), options: { type: "file", filename: "值守分析.html" } }]);
  assert.equal(event().analysisStatus, "completed");
  assert.equal(duty.pendingAttachments(f.eventId).length, 0);
  assert.doesNotMatch(JSON.stringify(duty.history("watch-html")), /<!DOCTYPE|<html/);
});

test("HTML delivery retries survive restart and exhaustion without resending the brief or successful files", async t => {
  let prompts = 0;
  const f = await fixture(t, async (_input, options) => {
    prompts++; options.onChunk(chunk(`简报${report("one.html", "<html>证据一</html>")}${report("two.html", "<html>证据二</html>")}`));
    return { stopReason: "end_turn" };
  });
  let messages = 0, failSecond = true;
  const uploads = [];
  notifier.register(f.bot.id, { isConnected: true,
    async sendMessage() { messages++; return {}; },
    async uploadMedia(_buffer, options) { uploads.push(options.filename); return { media_id: options.filename }; },
    async sendMediaMessage(_group, _type, mediaId) { if (mediaId === "two.html" && failSecond) throw new Error("offline"); return {}; },
  });
  await worker.processAnalyses();
  assert.equal(event().analysisStatus, "ready"); assert.equal(event().completedAt, null);
  assert.deepEqual(duty.pendingAttachments(f.eventId).map(item => item.filename), ["two.html"]);
  closeDatabase();
  for (let retry = 0; retry < 4; retry++) {
    db().prepare("UPDATE architecture_watch_events SET next_attempt_at=0").run();
    await worker.processAnalyses();
  }
  assert.equal(event().attempts, 5);
  failSecond = false;
  duty.retryEvent("watch-html", f.eventId);
  await worker.processAnalyses();
  assert.equal(prompts, 1); assert.equal(messages, 1);
  assert.equal(uploads.filter(name => name === "one.html").length, 1);
  assert.equal(uploads.filter(name => name === "two.html").length, 6);
  assert.equal(event().analysisStatus, "completed");
});

test("missing HTML remains failed and a manual retry regenerates the report and resets brief progress", async t => {
  let prompts = 0, provideReport = false;
  const f = await fixture(t, async (_input, options) => {
    prompts++; options.onChunk(chunk(`结论：Redis 超时。${provideReport ? report("fixed.html", "<html>详细证据</html>") : ""}`));
    return { stopReason: "end_turn" };
  });
  const messages = [], files = [];
  const options = { sendMessage: async (_bot, _group, text) => messages.push(text), sendHtmlAttachment: async (_bot, _group, file) => files.push(file) };
  await worker.processAnalyses(options);
  assert.equal(prompts, 2); assert.equal(event().analysisStatus, "failed");
  assert.equal(event().completedAt, null); assert.match(event().error, /HTML/);
  assert.match(messages[0], /HTML 报告未完整生成/); assert.equal(files.length, 0);
  provideReport = true;
  duty.retryEvent("watch-html", f.eventId);
  await worker.processAnalyses(options);
  assert.equal(prompts, 3); assert.equal(messages.length, 2); assert.equal(files.length, 1);
  assert.doesNotMatch(messages[1], /未完整生成/); assert.equal(event().analysisStatus, "completed");
});

test("runtime and watch credentials are removed from brief, filenames, saved and sent HTML", async t => {
  const f = await fixture(t, async (_input, options) => {
    options.onChunk(chunk(`结论 cloud-html-secret runtime-html-secret${report("AKID_RUNTIME_HTML.html", "<html>AKID_RUNTIME_HTML runtime-html-secret AKID_DUTY_HTML cloud-html-secret</html>")}`));
    return { stopReason: "end_turn" };
  });
  const runtime = registry.saveTencentCredential({ name: "Runtime", secretId: "AKID_RUNTIME_HTML", secretKey: "runtime-html-secret" });
  registry.saveAgent(f.agent, f.agent.id, { runtimeVersion: { runtimeCredentialId: runtime.id, runtimeRegion: "ap-guangzhou",
    wmaVersionId: "html-version", wmaVersionName: "凭证注入版", runtimeCredentialUpdatedAt: runtime.updatedAt } });
  const delivered = [];
  await worker.processAnalyses({ adapter: f.adapter, sendMessage: async (_bot, _group, text) => delivered.push(text),
    sendHtmlAttachment: async (_bot, _group, file) => delivered.push(file.filename, file.buffer.toString()) });
  const saved = db().prepare("SELECT filename,content FROM architecture_event_attachments WHERE event_id=?").get(f.eventId);
  const combined = [...delivered, saved.filename, Buffer.from(saved.content).toString(), event().analysis].join("\n");
  assert.doesNotMatch(combined, /cloud-html-secret|runtime-html-secret|AKID_RUNTIME_HTML|AKID_DUTY_HTML/);
  assert.match(combined, /REDACTED/); assert.equal(event().analysisStatus, "completed");
});

test("long agent prose is bounded to one brief while the complete report remains intact", async t => {
  const detail = "详细证据与影响。".repeat(1000), messages = [], files = [];
  await fixture(t, async (_input, options) => {
    options.onChunk(chunk(`### 结论\n${detail}${report("full.html", `<html>${detail}</html>`)}`));
    return { stopReason: "end_turn" };
  });
  await worker.processAnalyses({ sendMessage: async (_bot, _group, text) => messages.push(text), sendHtmlAttachment: async (_bot, _group, file) => files.push(file) });
  assert.equal(messages.length, 1); assert.ok(Buffer.byteLength(messages[0]) < 2000);
  assert.ok(Buffer.byteLength(event().analysis) <= 1200);
  assert.equal(files[0].buffer.toString(), `<html>${detail}</html>\n`);
  assert.equal(event().analysisStatus, "completed");
});

test("credentials spanning the brief cutoff are redacted before truncation", async t => {
  await fixture(t, async (_input, options) => {
    options.onChunk(chunk(`${"a".repeat(1185)}cloud-html-secret${report("report.html", "<html>详细证据</html>")}`));
    return { stopReason: "end_turn" };
  });
  const messages = [];
  await worker.processAnalyses({ sendMessage: async (_bot, _group, text) => messages.push(text), sendHtmlAttachment: async () => {} });
  assert.doesNotMatch(event().analysis + messages.join(""), /cloud-html/);
  assert.match(event().analysis, /REDACTED/); assert.equal(event().analysisStatus, "completed");
});

test("disabling duty after the brief cancels the pending report", async t => {
  const f = await fixture(t, async (_input, options) => {
    options.onChunk(chunk(`简报${report("report.html", "<html>证据</html>")}`)); return { stopReason: "end_turn" };
  });
  await worker.processAnalyses({ sendMessage: async () => { duty.setEnabled("watch-html", false); },
    sendHtmlAttachment: async () => assert.fail("must not send after disabling") });
  assert.equal(event().analysisStatus, "cancelled"); assert.equal(duty.pendingAttachments(f.eventId).length, 1);
  db().prepare("DELETE FROM architecture_watches WHERE id='watch-html'").run();
  assert.equal(db().prepare("SELECT COUNT(*) AS count FROM architecture_event_attachments").get().count, 0);
});

test("an interrupted response never delivers its HTML or claims success", async t => {
  await fixture(t, async (_input, options) => {
    options.onChunk(chunk(`简报${report("report.html", "<html>未完成分析</html>")}`)); return { stopReason: "max_tokens" };
  });
  await worker.processAnalyses({ sendMessage: async () => assert.fail("must not deliver"), sendHtmlAttachment: async () => assert.fail("must not deliver") });
  assert.equal(event().analysisStatus, "failed"); assert.match(event().error, /未正常完成/);
  assert.equal(db().prepare("SELECT COUNT(*) AS count FROM architecture_event_attachments").get().count, 0);
});

test("opening an older database adds HTML persistence without altering queued legacy analysis", async t => {
  await fixture(t, async () => assert.fail("must not reanalyze"));
  db().prepare("UPDATE architecture_watch_events SET analysis_status='ready',analysis='旧版结论'").run();
  db().exec("DROP TABLE architecture_event_attachments; ALTER TABLE architecture_watch_events DROP COLUMN analysis_attachment_error;");
  closeDatabase();
  const messages = [];
  await worker.processAnalyses({ sendMessage: async (_bot, _group, text) => messages.push(text), sendHtmlAttachment: async () => assert.fail("legacy has no report") });
  assert.match(messages[0], /旧版结论/); assert.equal(event().analysisStatus, "completed");
  assert.equal(db().prepare("SELECT analysis_attachment_error FROM architecture_watch_events").get().analysis_attachment_error, null);
});
