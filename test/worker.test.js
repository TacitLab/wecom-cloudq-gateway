"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

process.env.ADMIN_PASSWORD = "test-admin-password";
process.env.SQLITE_PATH = ":memory:";
process.env.STREAM_FLUSH_INTERVAL_MS = "0";

const { db } = require("../src/database");
const registry = require("../src/registry");
const store = require("../src/store");
const notifier = require("../src/notifier");
const { adapterFor, handleTask } = require("../src/worker");

test("Bots sharing an Agent independently control progress in replies and saved task answers", async () => {
  const agent = registry.saveAgent({ credentialConfigId: registry.saveWmaCredential({ name: "WMA test", secretId: "AKID_test", secretKey: "test-secret" }).id, name: "Agent", agentId: "agent_WORKER", });
  const adapter = adapterFor(registry.getAgent(agent.id, { secrets: true }));
  const session = {
    async connect() {},
    async disconnect() {},
    async prompt(_input, options) {
      options.onChunk({ update: { sessionUpdate: "agent_message_chunk", content: { type: "text", text: "正在查询" } } });
      options.onChunk({ update: { sessionUpdate: "tool_call" } });
      options.onChunk({ update: { sessionUpdate: "agent_message_chunk", content: { type: "text", text: "最终结果" } } });
      return { stopReason: "end_turn" };
    },
  };
  adapter.client = { session: async () => session };

  // Run another visible Bot after the hidden one to catch shared-adapter state leaks.
  for (const [index, showThinking] of [true, false, true].entries()) {
    const bot = registry.saveBot({ name: "Bot", botId: `worker-${index}`, secret: "secret", agentConfigId: agent.id, showThinking });
    const conversationKey = `conversation-${index}`;
    store.setConversation(conversationKey, { botConfigId: bot.id, agentConfigId: agent.id, agentRevision: agent.revision },
      { sessionId: "session" });
    const { task } = store.enqueueTask({ botConfigId: bot.id, agentConfigId: agent.id, conversationKey,
      externalMsgId: `msg-${index}`, frame: {}, command: "message", content: "hello" });
    const replies = [];
    const client = { isConnected: true, replyStream: async (...args) => { replies.push({ content: args[2], finish: args[3] }); } };
    notifier.register(bot.id, client);
    try {
      await handleTask(task);
      const expected = showThinking ? "💬 正在查询\n\n💬 最终结果" : "最终结果";
      assert.deepEqual(replies.at(-1), { content: expected, finish: true });
      if (showThinking) assert.equal(replies.some((reply) => !reply.finish && reply.content.includes("正在查询")), true);
      else assert.deepEqual(replies, [{ content: expected, finish: true }]);
      const saved = db().prepare("SELECT status,answer FROM wma_tasks WHERE id=?").get(task.id);
      assert.equal(saved.status, "completed");
      assert.equal(saved.answer, expected);
    } finally {
      notifier.unregister(bot.id, client);
    }
  }
});

test("generated HTML reaches the originating Bot as a full attachment in both thinking modes", async () => {
  const html = '<!DOCTYPE html>\n<html lang="zh"><body>' + "周报内容".repeat(4000) + '</body></html>\n';
  for (const showThinking of [true, false]) {
    const agent = registry.saveAgent({ credentialConfigId: registry.saveWmaCredential({ name: "WMA test", secretId: "AKID_test", secretKey: "test-secret" }).id, name: "HTML Agent", agentId: `agent_html_${showThinking}`, });
    const bot = registry.saveBot({ name: "HTML Bot", botId: `html-${showThinking}`, secret: "secret", agentConfigId: agent.id, showThinking });
    const adapter = adapterFor(registry.getAgent(agent.id, { secrets: true }));
    const session = {
      async connect() {},
      async disconnect() {},
      async prompt(input, options) {
        assert.match(input, /生成一个 HTML 周报/);
        assert.match(input, /wecom-html filename=/);
        const output = '已经生成。\n```wecom-html filename="周报.html"\n' + html + '```\n';
        for (let offset = 0; offset < output.length; offset += 13) {
          options.onChunk({ update: { sessionUpdate: "agent_message_chunk", content: { type: "text", text: output.slice(offset, offset + 13) } } });
        }
        return { stopReason: "end_turn" };
      },
    };
    adapter.client = { session: async () => session };
    const conversationKey = `html-${showThinking}`;
    store.setConversation(conversationKey, { botConfigId: bot.id, agentConfigId: agent.id, agentRevision: agent.revision },
      { sessionId: "session" });
    const frame = { headers: { req_id: "original-request" }, body: { chatid: "original-chat" } };
    const { task } = store.enqueueTask({ botConfigId: bot.id, agentConfigId: agent.id, conversationKey,
      externalMsgId: conversationKey, frame, command: "message", content: "生成一个 HTML 周报" });
    const replies = [];
    const media = [];
    const client = {
      isConnected: true,
      replyStream: async (...args) => { replies.push({ content: args[2], finish: args[3] }); },
      async uploadMedia(buffer, options) {
        assert.deepEqual(buffer, Buffer.from(html, "utf8"));
        assert.deepEqual(options, { type: "file", filename: "周报.html" });
        return { media_id: "uploaded-html" };
      },
      async replyMedia(...args) { media.push(args); return { body: { errcode: 0 } }; },
    };
    notifier.register(bot.id, client);
    try {
      await handleTask(task);
      assert.deepEqual(media, [[frame, "file", "uploaded-html"]]);
      assert.equal(replies.at(-1).finish, true);
      assert.match(replies.at(-1).content, /已发送附件：周报.html/);
      for (const reply of replies) assert.doesNotMatch(reply.content, /<!DOCTYPE|<html|周报内容|wecom-html/);
      assert.equal(db().prepare("SELECT status FROM wma_tasks WHERE id=?").get(task.id).status, "completed");
    } finally {
      notifier.unregister(bot.id, client);
    }
  }
});

test("HTML attachment failures are reported without marking delivery successful", async () => {
  const agent = registry.saveAgent({ credentialConfigId: registry.saveWmaCredential({ name: "WMA test", secretId: "AKID_test", secretKey: "test-secret" }).id, name: "Fail Agent", agentId: "agent_fail_html", });
  const bot = registry.saveBot({ name: "Fail Bot", botId: "fail-html", secret: "secret", agentConfigId: agent.id });
  const adapter = adapterFor(registry.getAgent(agent.id, { secrets: true }));
  const original = adapter.sendMessage;
  adapter.sendMessage = async () => ({ stopReason: "end_turn", attachments: [{ filename: "report.html", buffer: Buffer.from("<html></html>") }] });
  const conversationKey = "fail-html";
  store.setConversation(conversationKey, { botConfigId: bot.id, agentConfigId: agent.id, agentRevision: agent.revision }, { sessionId: "s" });
  const { task } = store.enqueueTask({ botConfigId: bot.id, agentConfigId: agent.id, conversationKey, externalMsgId: "fail-html", frame: {}, command: "message", content: "HTML" });
  const replies = [];
  const client = { isConnected: true, async uploadMedia() { return { media_id: "m" }; }, async replyMedia() { return { body: { errcode: 40008, errmsg: "invalid file" } }; },
    async replyStream(_frame, _id, content) { replies.push(content); } };
  notifier.register(bot.id, client);
  try {
    await handleTask(task);
    assert.match(replies.at(-1), /发送失败/);
    assert.doesNotMatch(replies.at(-1), /已发送附件|任务已完成/);
    const saved = db().prepare("SELECT status,error FROM wma_tasks WHERE id=?").get(task.id);
    assert.equal(saved.status, "failed");
    assert.match(saved.error, /invalid file/);
  } finally {
    adapter.sendMessage = original;
    notifier.unregister(bot.id, client);
  }
});

test("cancelling during upload prevents sending the HTML attachment", async () => {
  const controller = new AbortController();
  let sent = false;
  const client = { isConnected: true, async uploadMedia() { controller.abort(); return { media_id: "m" }; }, async replyMedia() { sent = true; } };
  notifier.register("cancel-html", client);
  try {
    await assert.rejects(notifier.replyHtmlFile("cancel-html", {}, { filename: "x.html", buffer: Buffer.from("<html></html>") }, { signal: controller.signal }), { name: "AbortError" });
    assert.equal(sent, false);
  } finally {
    notifier.unregister("cancel-html", client);
  }
});
