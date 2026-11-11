"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const {
  AgentAdapter,
  ConversationUnavailableError,
  createAgentTextFormatter,
  finalizeAgentText,
  isConversationUnavailable,
} = require("../src/agent");

function config(overrides = {}) {
  return {
    agentId: "agent-1",

    controlTimeoutMs: 5000,
    promptTimeoutMs: 10000,
    includeThinking: false,
    ...overrides,
  };
}

test("creates WMA sessions through the managed Agent client", async () => {
  const client = { async createConversation(name) { assert.equal(name, "test"); return { sessionId: "wma-session" }; } };
  const adapter = new AgentAdapter(config(), client);
  assert.deepEqual(await adapter.createConversation("test"), { sessionId: "wma-session" });
});

test("loads the recorded Session, streams text, and disconnects", async () => {
  const calls = [];
  const session = {
    async connect(options) { calls.push(["connect", options]); },
    async prompt(input, options) {
      calls.push(["prompt", input]);
      options.onChunk({
        update: {
          sessionUpdate: "agent_message_chunk",
          messageId: "message-1",
          content: { type: "text", text: "hello " },
        },
      });
      options.onChunk({
        update: {
          sessionUpdate: "agent_message_chunk",
          messageId: "message-1",
          content: { type: "text", text: "world" },
        },
      });
      options.onChunk({
        update: {
          sessionUpdate: "tool_call",
          content: { type: "text", text: "ignored" },
        },
      });
      options.onChunk({
        update: {
          sessionUpdate: "agent_message_chunk",
          messageId: "message-2",
          content: { type: "text", text: "next step" },
        },
      });
      return { stopReason: "end_turn" };
    },
    async disconnect() { calls.push(["disconnect"]); },
  };
  const client = { async session(conversation) { calls.push(["session", conversation.sessionId]); return session; } };
  const adapter = new AgentAdapter(config(), client);
  let answer = "";
  const response = await adapter.sendMessage(
    { sessionId: "session-1" },
    "hi",
    (delta) => { answer += delta; },
  );

  assert.equal(
    answer,
    "💬 hello world\n\n💬 next step",
  );
  assert.equal(response.stopReason, "end_turn");
  assert.deepEqual(calls.map((item) => item[0]), [
    "session", "connect", "prompt", "disconnect",
  ]);
});

test("formats separate Agent messages as paragraphs without duplicating newlines", () => {
  let text = "";
  const format = createAgentTextFormatter((delta) => { text += delta; });

  format({ update: {
    sessionUpdate: "agent_message_chunk",
    messageId: "one",
    content: { type: "text", text: "第一步\n" },
  } });
  format({ update: {
    sessionUpdate: "agent_message_chunk",
    messageId: "two",
    content: { type: "text", text: "\n第二步" },
  } });

  assert.equal(
    text,
    "💬 第一步\n\n💬 第二步",
  );
});

function textChunk(text, messageId) {
  return { update: { sessionUpdate: "agent_message_chunk", messageId, content: { type: "text", text } } };
}

for (const [name, notifications, expected] of [
  ["tool calls with message IDs", [textChunk("开始查询", "one"), { update: { sessionUpdate: "tool_call" } },
    textChunk("继续检查", "two"), { update: { sessionUpdate: "tool_call" } },
    textChunk("最终", "three"), textChunk("结果", "three")], "最终结果"],
  ["tool calls without message IDs", [textChunk("开始查询"), { update: { sessionUpdate: "tool_call" } },
    textChunk("最终"), textChunk("结果")], "最终结果"],
  ["distinct messages without tools", [textChunk("正在分析", "one"), textChunk("最终结果", "two")], "最终结果"],
  ["a direct answer", [textChunk("直接"), textChunk("回答")], "直接回答"],
  ["no final text after tools", [textChunk("开始查询"), { update: { sessionUpdate: "tool_call" } }], ""],
]) {
  test(`hides progress and emits only final text after completion: ${name}`, async () => {
    const deltas = [];
    const session = {
      async connect() {},
      async disconnect() {},
      async prompt(_input, options) {
        assert.equal(options.includeThinking, false);
        options.onChunk({ update: { sessionUpdate: "agent_thought_chunk", content: { type: "text", text: "隐藏思考" } } });
        for (const notification of notifications) options.onChunk(notification);
        assert.deepEqual(deltas, []);
        return { stopReason: "end_turn" };
      },
    };
    const adapter = new AgentAdapter(config({ includeThinking: true }), {
      session: async () => session,
    });
    const response = await adapter.sendMessage({ sessionId: "session" }, "hi",
      (delta) => deltas.push(delta), { showThinking: false });
    assert.deepEqual(deltas, expected ? [expected] : []);
    assert.equal(response.stopReason, "end_turn");
  });
}

test("does not expose buffered progress when a hidden-thinking turn fails", async () => {
  const deltas = [];
  let disconnected = false;
  const session = {
    async connect() {},
    async disconnect() { disconnected = true; },
    async prompt(_input, options) {
      options.onChunk(textChunk("正在分析"));
      throw new Error("cancelled");
    },
  };
  const adapter = new AgentAdapter(config(), {
    session: async () => session,
  });
  await assert.rejects(adapter.sendMessage({ sessionId: "session" }, "hi",
    (delta) => deltas.push(delta), { showThinking: false }), /cancelled/);
  assert.deepEqual(deltas, []);
  assert.equal(disconnected, true);
});

test("uses one neutral prefix for every section and closes orphaned colons", () => {
  const text = [
    "💬 好的，我来查询资源：",
    "",
    "💬 查询完成，结果如下：",
    "",
    "| 实例 | 状态 |",
    "| --- | --- |",
    "| cvm-1 | RUNNING |",
  ].join("\n");

  assert.equal(finalizeAgentText(text), [
    "💬 好的，我来查询资源。",
    "",
    "💬 查询完成，结果如下：",
    "",
    "| 实例 | 状态 |",
    "| --- | --- |",
    "| cvm-1 | RUNNING |",
  ].join("\n"));
});

test("marks a missing WMA Session unavailable without creating a replacement", async () => {
  const adapter = new AgentAdapter(config(), { async session() { throw Object.assign(new Error("session not found"), { httpStatus: 404 }); } });
  await assert.rejects(adapter.sendMessage({ sessionId: "gone" }, "hi"), ConversationUnavailableError);
  assert.equal(isConversationUnavailable({ httpStatus: 410 }), true);
});

for (const showThinking of [true, false]) {
  test(`exports a sandbox report in the same Session when the Agent only returns a summary (thinking=${showThinking})`, async () => {
    let prompts = 0;
    let disconnected = false;
    const html = '<!DOCTYPE html>\n<html><body>报告原文，置信度 85%</body></html>\n';
    const session = {
      async connect() {},
      async disconnect() { disconnected = true; },
      async prompt(input, options) {
        prompts += 1;
        if (prompts === 1) {
          assert.match(input, /wecom_attachment_delivery/);
          options.onChunk(textChunk("报告已生成并展示完毕。诊断总结：Redis 延迟突增。", "summary"));
        } else {
          assert.equal(prompts, 2);
          assert.match(input, /读取那份报告文件/);
          assert.match(input, /不要重复诊断/);
          assert.equal(options.includeThinking, false);
          options.onChunk({ update: { sessionUpdate: "tool_call" } });
          options.onChunk(textChunk('```wecom-html filename="诊断报告.html"\n' + html + '```\n', "export"));
        }
        return { stopReason: "end_turn" };
      },
    };
    const adapter = new AgentAdapter(config(), { session: async () => session });
    let visible = "";
    const response = await adapter.sendMessage({ sessionId: "s" }, "先输出简报，再输出完整 HTML 报告", (delta) => { visible += delta; }, { htmlAttachments: true, showThinking });
    assert.equal(prompts, 2);
    assert.equal(disconnected, true);
    assert.match(visible, /诊断总结：Redis 延迟突增/);
    assert.doesNotMatch(visible, /报告原文|<html>|wecom-html/);
    assert.deepEqual(response.warnings, []);
    assert.equal(response.attachments[0].buffer.toString(), html);
    assert.equal(response.attachments[0].filename, "诊断报告.html");
  });
}

for (const failure of ["summary", "throw", "max_tokens"]) {
  test(`missing HTML produces an explicit warning after one export attempt: ${failure}`, async () => {
    let prompts = 0;
    const session = {
      async connect() {}, async disconnect() {},
      async prompt(_input, options) {
        prompts += 1;
        if (prompts === 2 && failure === "throw") throw new Error("export failed");
        options.onChunk(textChunk("报告已生成。", "summary"));
        return { stopReason: prompts === 2 && failure === "max_tokens" ? "max_tokens" : "end_turn" };
      },
    };
    const adapter = new AgentAdapter(config(), { session: async () => session });
    const response = await adapter.sendMessage({ sessionId: "s" }, "输出 HTML 报告", () => {}, { htmlAttachments: true });
    assert.equal(prompts, 2);
    assert.equal(response.attachments.length, 0);
    assert.match(response.warnings.join(""), /报告附件未发送/);
  });
}

test("a complete ordinary HTML fence satisfies a report request without a second prompt", async () => {
  let prompts = 0;
  const session = {
    async connect() {}, async disconnect() {},
    async prompt(_input, options) {
      prompts += 1;
      options.onChunk(textChunk('简报\n```html\n<!DOCTYPE html>\n<html>完整报告</html>\n```\n'));
      return { stopReason: "end_turn" };
    },
  };
  const adapter = new AgentAdapter(config(), { session: async () => session });
  let visible = "";
  const response = await adapter.sendMessage({ sessionId: "s" }, "输出完整 HTML 报告", (delta) => { visible += delta; }, { htmlAttachments: true });
  assert.equal(prompts, 1);
  assert.equal(response.attachments.length, 1);
  assert.doesNotMatch(visible, /<html>|完整报告/);
});
