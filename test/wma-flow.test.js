"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { Readable } = require("node:stream");

process.env.ADMIN_PASSWORD = "test-password";
process.env.SQLITE_PATH = ":memory:";

const { createServer } = require("../server");
const { db, closeDatabase } = require("../src/database");
const registry = require("../src/registry");
const store = require("../src/store");
const { handleTask } = require("../src/worker");
const notifier = require("../src/notifier");
const agentId = "01M4TBXRFJXWFBET06Z82SAJM4";
const secretId = "AKID_FLOW_TEST";
const secret = "flow-secret-only-for-tests";

test.after(() => closeDatabase());

test("WMA admin API adds key, pulls list, validates selection, binds Bot, and reuses sessions for chat and HTML", async (t) => {
  const encoder = new TextEncoder();
  const sessions = new Set();
  const connections = new Map();
  let createCount = 0;
  let promptCount = 0;
  let tokenCount = 0;
  let disabled = false;
  const pascal = (value) => Array.isArray(value) ? value.map(pascal) : value && typeof value === "object" ? Object.fromEntries(Object.entries(value).map(([k, v]) => [k.charAt(0).toUpperCase() + k.slice(1), pascal(v)])) : value;
  const envelope = (data, status = 200) => Response.json({ Response: pascal(data) }, { status });

  t.mock.method(globalThis, "fetch", async (address, options = {}) => {
    const url = new URL(address);
    const method = options.method || "GET";
    if (url.hostname === "workbuddyenterprise.tencentcloudapi.com") {
      assert.match(options.headers.Authorization, /^TC3-HMAC-SHA256 Credential=AKID_FLOW_TEST\//);
      assert.equal(options.headers["X-TC-Version"], "2026-07-09");
      const action = options.headers["X-TC-Action"];
      const params = JSON.parse(options.body);
      if (action === "DescribeAgentList") return envelope({ totalCount: 1, agentSet: [{ agentId, agentName: "WMA flow", publicApiEnabled: !disabled }] });
      if (action === "DescribeAgent") return envelope({ agentId, publicApiEnabled: !disabled });
      if (action === "CreateAgentSession") {
        assert.deepEqual(params, { AgentId: agentId });
        const sessionId = `session-${++createCount}`;
        sessions.add(sessionId);
        return envelope({ sessionId, endpointSet: [{ endpointType: "PUBLIC", url: "https://agent.test" }] });
      }
      if (action === "DescribeAgentSession") {
        const { SessionId: sessionId } = params;
        assert.deepEqual(Object.keys(params), ["SessionId"]);
        assert.ok(sessions.has(sessionId));
        return envelope({ sessionId, status: "ACTIVE", endpointSet: [{ endpointType: "PUBLIC", url: "https://agent.test" }] });
      }
      if (action === "DescribeUserAccessToken") { tokenCount += 1; return envelope({ accessToken: "user-runtime-token", expiresIn: 3600 }); }
      assert.fail(`Unexpected WMA action: ${action}`);
    }
    assert.equal(url.hostname, "agent.test");
    assert.equal(url.pathname, "/v1/agents/acp");
    assert.equal(options.headers.Authorization, "Bearer user-runtime-token");
    const sessionId = options.headers["X-Agent-Session-Id"];
    assert.ok(sessions.has(sessionId));
    if (method === "GET") return new Response(new ReadableStream({ start(controller) {
      connections.set(sessionId, controller);
      options.signal.addEventListener("abort", () => { controller.error(options.signal.reason); connections.delete(sessionId); }, { once: true });
    } }), { headers: { "Acp-Connection-Id": `connection-${sessionId}`, "Content-Type": "text/event-stream" } });
    assert.equal(options.headers["Acp-Connection-Id"], `connection-${sessionId}`);
    if (method === "DELETE") return new Response(null, { status: 204 });
    const message = JSON.parse(options.body);
    const push = (text) => connections.get(sessionId).enqueue(encoder.encode(`data: ${JSON.stringify({ jsonrpc: "2.0", method: "session/update", params: { sessionId, update: { sessionUpdate: "agent_message_chunk", content: { type: "text", text } } } })}\n\n`));
    if (message.method === "session/load") push("HISTORY SHOULD NOT BE REPLIED");
    if (message.method === "session/prompt") {
      promptCount += 1;
      const input = message.params.prompt[0].text;
      if (input.includes("生成 HTML")) push('简报已完成。\n```wecom-html filename="WMA报告.html"\n<!DOCTYPE html>\n<html><body>WMA 完整报告</body></html>\n```\n');
      else push(`回复 ${promptCount}`);
      return Response.json({ jsonrpc: "2.0", id: message.id, result: { stopReason: "end_turn" } });
    }
    return Response.json({ jsonrpc: "2.0", id: message.id, result: {} });
  });

  const { server } = createServer({ config: { adminUsername: "admin", adminPassword: "test-password", bodyLimitBytes: 1024 * 1024 }, botManager: { statuses: () => ({}), sync() {} } });
  // Exercise the real HTTP request handler without opening network listeners.
  function request(method, url, body) {
    return new Promise((resolve) => {
      const req = Readable.from([Buffer.from(JSON.stringify(body || {}))]);
      Object.assign(req, { method, url, headers: { host: "gateway.test", authorization: `Basic ${Buffer.from("admin:test-password").toString("base64")}` } });
      let status;
      server.emit("request", req, { writeHead(value) { status = value; }, end(value) { resolve({ status, body: JSON.parse(value) }); } });
    });
  }

  const key = await request("POST", "/api/admin/wma-credentials", { name: "WMA flow", secretId, secretKey: secret, region: "ap-guangzhou" });
  assert.equal(key.status, 201);
  assert.equal(key.body.secretKey, undefined);
  const list = await request("POST", `/api/admin/wma-credentials/${key.body.id}/agents`);
  assert.equal(list.status, 200);
  assert.equal(list.body.items[0].agentId, agentId);
  assert.equal(list.body.items[0].existingConfigId, null);
  assert.equal(createCount, 0); // Credential/list checks do not allocate sandboxes.
  const agent = await request("POST", "/api/admin/agents", { credentialConfigId: key.body.id, agentId, name: "WMA flow" });
  assert.equal(agent.status, 201);
  assert.equal(createCount, 0);
  const repeatedList = await request("POST", `/api/admin/wma-credentials/${key.body.id}/agents`);
  assert.equal(repeatedList.body.items[0].existingConfigId, agent.body.id);
  assert.equal((await request("POST", `/api/admin/agents/${agent.body.id}/test`)).body.agentId, agentId);
  disabled = true;
  const denied = await request("PUT", `/api/admin/agents/${agent.body.id}`, { credentialConfigId: key.body.id, agentId, name: "Must not save" });
  assert.equal(denied.status, 400);
  assert.equal(registry.getAgent(agent.body.id).name, "WMA flow");
  disabled = false;
  const bot = await request("POST", "/api/admin/bots", { name: "Bot", botId: "bot-wma", secret: "bot-secret", agentConfigId: agent.body.id, showThinking: false });
  assert.equal(bot.status, 201);
  const replies = [];
  const files = [];
  const botClient = { isConnected: true, async replyStream(_frame, _stream, text) { replies.push(text); }, async uploadMedia(buffer, options) { files.push({ html: buffer.toString(), ...options }); return { media_id: "html-report" }; }, async replyMedia() {} };
  notifier.register(bot.body.id, botClient);
  t.after(() => notifier.unregister(bot.body.id, botClient));
  const frame = { headers: { req_id: "wma-original" }, body: { chatid: "wma-chat" } };
  const conversationKey = "wma-flow-conversation";
  async function run(content, command = "message") {
    const { task } = store.enqueueTask({ botConfigId: bot.body.id, agentConfigId: agent.body.id, conversationKey, externalMsgId: `message-${Date.now()}-${Math.random()}`, content, command, frame });
    await handleTask(task);
    assert.equal(db().prepare("SELECT status FROM wma_tasks WHERE id=?").get(task.id).status, "completed");
  }
  await run("第一轮");
  await run("第二轮");
  assert.equal(createCount, 1);
  assert.equal(promptCount, 2);
  assert.equal(tokenCount, 1);
  assert.deepEqual(replies, ["回复 1", "回复 2"]);
  await run("生成 HTML 报告");
  assert.equal(files.length, 1);
  assert.match(files[0].html, /WMA 完整报告/);
  assert.ok(replies.every((text) => !text.includes("<html>") && !text.includes("HISTORY")));
  await run("/new", "new");
  await run("新会话");
  assert.equal(createCount, 2);
  assert.equal(store.conversation(conversationKey).sessionId, "session-2");
  assert.equal(connections.size, 0);
  const state = await request("GET", "/api/admin/state");
  assert.doesNotMatch(JSON.stringify(state), /AKID_FLOW_TEST|flow-secret-only-for-tests|user-runtime-token|bot-secret/);
});
