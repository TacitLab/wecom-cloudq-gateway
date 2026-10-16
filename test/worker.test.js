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
  const agent = registry.saveAgent({ name: "Agent", agentId: "agent_WORKER", apiKey: "pt_test" });
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
  adapter.client = { runtimes: { get: async () => ({ sessions: { get: async () => session } }) } };

  // Run another visible Bot after the hidden one to catch shared-adapter state leaks.
  for (const [index, showThinking] of [true, false, true].entries()) {
    const bot = registry.saveBot({ name: "Bot", botId: `worker-${index}`, secret: "secret", cloudAgentId: agent.id, showThinking });
    const conversationKey = `conversation-${index}`;
    store.setConversation(conversationKey, { botConfigId: bot.id, cloudAgentId: agent.id, agentRevision: agent.revision },
      { runtimeId: "runtime", sessionId: "session" });
    const { task } = store.enqueueTask({ botConfigId: bot.id, cloudAgentId: agent.id, conversationKey,
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
      const saved = db().prepare("SELECT status,answer FROM tasks WHERE id=?").get(task.id);
      assert.equal(saved.status, "completed");
      assert.equal(saved.answer, expected);
    } finally {
      notifier.unregister(bot.id, client);
    }
  }
});
