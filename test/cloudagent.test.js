"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const {
  CloudAgentAdapter,
  ConversationUnavailableError,
  createAgentTextFormatter,
  finalizeAgentText,
  isConversationUnavailable,
  safeRuntimeName,
} = require("../src/cloudagent");

function config(overrides = {}) {
  return {
    agentId: "agent-1",
    apiKey: "pt_test",
    baseUrl: "https://mock.local/v2/agentos",
    sourceApp: "wecom-test",
    agentName: "Test Agent",
    manifestVersion: "1.0",
    manifest: {},
    runtimeNamePrefix: "wecom",
    controlTimeoutMs: 5000,
    promptTimeoutMs: 10000,
    includeThinking: false,
    reconnectMaxAttempts: 3,
    reconnectBackoffMs: 300,
    reconnectMaxBackoffMs: 30000,
    heartbeatTimeoutMs: 45000,
    logLevel: "off",
    ...overrides,
  };
}

test("creates a Runtime and records a Session bound to the published Agent", async () => {
  let createOptions;
  let sessionOptions;
  const client = {
    agents: {
      async list() {
        return {
          total: 1,
          page: 1,
          pageSize: 100,
          items: [{ id: "internal-agent-7", agentId: "agent-1", enabled: true }],
        };
      },
    },
    runtimes: {
      async create(options) {
        createOptions = options;
        return {
          id: 1234567890,
          sessions: {
            async create(options) {
              sessionOptions = options;
              return { id: "agent-session-42" };
            },
          },
        };
      },
    },
  };
  const adapter = new CloudAgentAdapter(config(), client);
  const conversation = await adapter.createConversation("bot:user-sensitive-id");

  assert.equal(conversation.runtimeId, "1234567890");
  assert.equal(conversation.sessionId, "agent-session-42");
  assert.equal(conversation.version, 1);
  assert.equal(createOptions.agentManifest.id, "agent-1");
  assert.equal(createOptions.metadata.channel, "wecom-aibot");
  assert.equal(createOptions.metadata.agentId, "agent-1");
  assert.equal(createOptions.metadata.sessionMode, "published-agent");
  assert.match(createOptions.runtimeName, /^wecom-[a-f0-9]{10}-\d+$/);
  assert.doesNotMatch(createOptions.runtimeName, /sensitive/);
  assert.equal(sessionOptions.agentId, "internal-agent-7");
  assert.equal(sessionOptions.timeoutMs, 5000);
  assert.match(sessionOptions.sessionName, /^wecom-[a-f0-9]{10}-\d+-agent$/);
  assert.doesNotMatch(sessionOptions.sessionName, /sensitive/);
});

test("resolves an Agent business ID across paginated Agent results", async () => {
  const requestedPages = [];
  const client = {
    agents: {
      async list(options) {
        requestedPages.push(options.page);
        if (options.page === 1) {
          return {
            total: 101,
            page: 1,
            pageSize: 100,
            items: Array.from({ length: 100 }, (_, index) => ({
              id: `internal-${index}`,
              agentId: `decoy-agent-${index}`,
              enabled: true,
            })),
          };
        }
        return {
          total: 101,
          page: 2,
          pageSize: 100,
          items: [{ id: "internal-target", agentId: "agent-1", enabled: true }],
        };
      },
    },
  };

  const adapter = new CloudAgentAdapter(config(), client);
  assert.equal(await adapter.resolveAgentInternalId(), "internal-target");
  assert.deepEqual(requestedPages, [1, 2]);
});

test("reports when the configured Agent is not visible to the API key", async () => {
  const client = {
    agents: {
      async list() {
        return { total: 0, page: 1, pageSize: 100, items: [] };
      },
    },
  };
  const adapter = new CloudAgentAdapter(config(), client);

  await assert.rejects(
    adapter.resolveAgentInternalId(),
    /CLOUD_AGENT_ID is not visible to this API key/,
  );
});

test("lists every visible Agent across paginated results", async () => {
  const client = {
    agents: {
      async list(options) {
        if (options.page === 1) {
          return {
            total: 101,
            page: 1,
            pageSize: 100,
            items: Array.from({ length: 100 }, (_, index) => ({
              id: `internal-${index}`,
              agentId: `agent-${index}`,
              agentName: `Agent ${index}`,
              description: `desc ${index}`,
              enabled: true,
            })),
          };
        }
        return {
          total: 101,
          page: 2,
          pageSize: 100,
          items: [
            { id: "internal-100", agentId: "agent-100", agentName: "Last Agent", enabled: false },
          ],
        };
      },
    },
  };

  const adapter = new CloudAgentAdapter(config(), client);
  const agents = await adapter.listVisibleAgents();
  assert.equal(agents.length, 101);
  assert.equal(agents[0].agentId, "agent-0");
  assert.equal(agents[0].agentName, "Agent 0");
  assert.equal(agents[0].enabled, true);
  assert.equal(agents[100].agentId, "agent-100");
  assert.equal(agents[100].enabled, false);
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
  const client = {
    runtimes: {
      async get(runtimeId) {
        calls.push(["runtime", runtimeId]);
        return {
          sessions: {
            async get(sessionId) {
              calls.push(["session", sessionId]);
              return session;
            },
          },
        };
      },
    },
  };
  const adapter = new CloudAgentAdapter(config(), client);
  let answer = "";
  const response = await adapter.sendMessage(
    { runtimeId: "runtime-1", sessionId: "session-1" },
    "hi",
    (delta) => { answer += delta; },
  );

  assert.equal(
    answer,
    "💬 hello world\n\n💬 next step",
  );
  assert.equal(response.stopReason, "end_turn");
  assert.deepEqual(calls.map((item) => item[0]), [
    "runtime", "session", "connect", "prompt", "disconnect",
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

test("marks missing Runtime state as unavailable without creating a replacement", async () => {
  const client = {
    runtimes: {
      async get() {
        const error = new Error("runtime not found");
        error.httpStatus = 404;
        throw error;
      },
    },
  };
  const adapter = new CloudAgentAdapter(config(), client);

  await assert.rejects(
    adapter.sendMessage({ runtimeId: "gone", sessionId: "gone" }, "hi"),
    ConversationUnavailableError,
  );
  assert.equal(isConversationUnavailable({ httpStatus: 410 }), true);
});

test("runtime names are bounded and do not expose conversation identifiers", () => {
  const name = safeRuntimeName("wecom production !!!", "user@example.com/private-chat");
  assert.ok(name.length <= 64);
  assert.match(name, /^wecom-production-[a-f0-9]{10}-\d+$/);
  assert.doesNotMatch(name, /example|private|@/);
});
