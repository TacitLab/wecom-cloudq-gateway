"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { WmaClient, WmaSession, readSse } = require("../src/wma");
const { authorization } = require("../src/monitor-client");
const { AgentAdapter, ConversationUnavailableError } = require("../src/agent");

const agentId = "736918300000000001";
const sessionId = "736918300000000002";
const config = { agentId, secretId: "AKID_test", secretKey: "test-secret", controlTimeoutMs: 1000, promptTimeoutMs: 2000 };
const json = (data) => Response.json({ Response: { AccessToken: data.accessToken, ExpiresIn: data.expiresIn } });
const frame = (message) => `data: ${JSON.stringify(message)}\r\n\r\n`;
const update = (text) => ({ jsonrpc: "2.0", method: "session/update", params: { sessionId, update: { sessionUpdate: "agent_message_chunk", content: { type: "text", text } } } });

test("SSE handles byte-fragmented Chinese, CRLF, comments, and multi-line data", async () => {
  const bytes = new TextEncoder().encode(': heartbeat\r\ndata: {"text":\r\ndata: "中文"}\r\n\r\n');
  const messages = [];
  await readSse(new ReadableStream({ start(controller) { for (const byte of bytes) controller.enqueue(Uint8Array.of(byte)); controller.close(); } }), (m) => messages.push(m));
  assert.deepEqual(messages, [{ text: "中文" }]);
});

function acpFixture({ prompt, unauthorized = false, shortControlTimeout = 1000 } = {}) {
  let stream;
  let tokenCalls = 0;
  let getCalls = 0;
  const calls = [];
  const encoder = new TextEncoder();
  const push = (message) => stream.enqueue(encoder.encode(frame(message)));
  const client = new WmaClient({ ...config, controlTimeoutMs: shortControlTimeout }, async (_url, options = {}) => {
    if (options.headers?.["X-TC-Action"] === "DescribeUserAccessToken") return json({ accessToken: `access-${++tokenCalls}`, expiresIn: 3600 });
    const method = options.method || "GET";
    assert.equal(options.headers["X-Agent-Session-Id"], sessionId);
    assert.match(options.headers.Authorization, /^Bearer access-/);
    calls.push({ method, ...(options.body ? JSON.parse(options.body) : {}) });
    if (method === "GET") {
      getCalls += 1;
      if (unauthorized && getCalls === 1) return new Response("expired", { status: 401 });
      return new Response(new ReadableStream({ start(controller) {
        stream = controller;
        options.signal.addEventListener("abort", () => controller.error(options.signal.reason), { once: true });
      } }), { headers: { "Acp-Connection-Id": "connection-1", "Content-Type": "text/event-stream" } });
    }
    assert.equal(options.headers["Acp-Connection-Id"], "connection-1");
    if (method === "DELETE") return new Response(null, { status: 204 });
    const m = JSON.parse(options.body);
    if (m.method === "session/load") {
      assert.equal(m.params.cwd, "/workspace");
      push(update("OLD HISTORY MUST NOT APPEAR"));
    }
    if (m.method === "session/prompt" && prompt) return prompt({ m, push, stream });
    if (m.id != null && m.method) push({ jsonrpc: "2.0", id: m.id, result: {} });
    return new Response(null, { status: 202 });
  });
  return { session: new WmaSession(client, sessionId, "https://acp.example/v1/agents/acp"), calls, get tokenCalls() { return tokenCalls; } };
}

test("ACP loads history before listening, handles both SSE channels, and refreshes a 401 handshake once", async () => {
  let turns = 0;
  const fixture = acpFixture({ unauthorized: true, prompt({ m, push }) {
    turns += 1;
    const final = { jsonrpc: "2.0", id: m.id, result: { stopReason: "end_turn" } };
    if (turns === 1) {
      push(update("第一轮")); push(final);
      return new Response(null, { status: 202 });
    }
    return new Response(frame(update("第二轮")) + frame(final), { headers: { "Content-Type": "text/event-stream" } });
  } });
  try {
    await fixture.session.connect();
    for (const text of ["第一轮", "第二轮"]) {
      const seen = [];
      const result = await fixture.session.prompt("hi", { onChunk: (n) => seen.push(n.update.content.text) });
      assert.deepEqual(result, { stopReason: "end_turn" });
      assert.deepEqual(seen, [text]);
    }
    assert.equal(fixture.tokenCalls, 2);
    assert.deepEqual(fixture.calls.filter((c) => c.id && c.method).map((c) => c.method), ["initialize", "session/load", "session/prompt", "session/prompt"]);
  } finally { await fixture.session.disconnect(); }
  assert.equal(fixture.calls.at(-1).method, "DELETE");
});

test("ACP does not apply the short handshake timeout to a long-running stream", async () => {
  const fixture = acpFixture({ shortControlTimeout: 30, prompt({ m, push }) {
    setTimeout(() => { push(update("done")); push({ jsonrpc: "2.0", id: m.id, result: { stopReason: "end_turn" } }); }, 65);
    return new Response(null, { status: 202 });
  } });
  try {
    await fixture.session.connect();
    assert.equal((await fixture.session.prompt("hi", { timeoutMs: 500 })).stopReason, "end_turn");
  } finally { await fixture.session.disconnect(); }
});

for (const cancel of ["abort", "timeout", "stream-close"]) {
  test(`ACP stops an interrupted turn without replay: ${cancel}`, async () => {
    const abort = new AbortController();
    const fixture = acpFixture({ prompt({ stream }) {
      if (cancel === "stream-close") stream.close();
      if (cancel === "abort") abort.abort(new Error("user stop"));
      return new Response(null, { status: 202 });
    } });
    try {
      await fixture.session.connect();
      await assert.rejects(fixture.session.prompt("hi", { signal: abort.signal, timeoutMs: 30 }));
      assert.equal(fixture.calls.filter((c) => c.method === "session/prompt").length, 1);
      if (cancel !== "stream-close") assert.equal(fixture.calls.some((c) => c.method === "session/cancel"), true);
    } finally { await fixture.session.disconnect(); }
  });
}

test("ACP cancels reverse permission and question requests in unattended conversations", async () => {
  const fixture = acpFixture({ prompt({ m, push }) {
    push({ jsonrpc: "2.0", id: "permission", method: "session/request_permission", params: {} });
    push({ jsonrpc: "2.0", id: "question", method: "_codebuddy.ai/question", params: {} });
    push({ jsonrpc: "2.0", id: m.id, result: { stopReason: "end_turn" } });
    return new Response(null, { status: 202 });
  } });
  try {
    await fixture.session.connect();
    await fixture.session.prompt("hi");
    for (const id of ["permission", "question"]) assert.deepEqual(fixture.calls.find((c) => c.id === id).result, { outcome: { outcome: "cancelled" } });
  } finally { await fixture.session.disconnect(); }
});

test("WMA CAPI signs requests for the correct service and uses Offset/Limit pagination", async () => {
  const offsets = [];
  const c = new WmaClient({ secretId: "AKID_sign_test", secretKey: "signing-secret", region: "ap-beijing" }, async (url, options) => {
    assert.equal(url, "https://workbuddyenterprise.tencentcloudapi.com");
    const h = options.headers;
    assert.equal(h["X-TC-Action"], "DescribeAgentList");
    assert.equal(h["X-TC-Version"], "2026-07-09");
    assert.equal(h["X-TC-Region"], "ap-beijing");
    assert.equal(h.Authorization, authorization("AKID_sign_test", "signing-secret", Number(h["X-TC-Timestamp"]), options.body, h["Content-Type"], "workbuddyenterprise"));
    const params = JSON.parse(options.body);
    offsets.push(params.Offset);
    assert.equal(params.Limit, 100);
    return Response.json({ Response: { TotalCount: 101, AgentSet: params.Offset === 0 ? Array.from({ length: 100 }, (_, i) => ({ AgentId: `01AGENT${i}`, PublicApiEnabled: true })) : [{ AgentId: agentId, AgentName: "SRE", PublicApiEnabled: false }] } });
  });
  const agents = await c.listVisibleAgents();
  assert.deepEqual(offsets, [0, 100]);
  assert.equal(agents[100].agentId, agentId);
  assert.equal(agents[100].enabled, false);
});

test("CAPI authorization errors preserve codes without leaking secret echoes or retrying", async () => {
  let calls = 0;
  const c = new WmaClient({ secretId: "AKID_test", secretKey: "test-secret" }, async () => {
    calls += 1;
    return Response.json({ Response: { Error: { Code: "AuthFailure.SignatureFailure", Message: "echo AKID_test and test-secret" }, RequestId: "request-capi" } });
  });
  await assert.rejects(c.listVisibleAgents(), (error) => {
    assert.equal(error.code, "AuthFailure.SignatureFailure");
    assert.equal(error.httpStatus, 401);
    assert.match(error.message, /request-capi/);
    assert.doesNotMatch(error.message, /AKID_test|test-secret/);
    return true;
  });
  assert.equal(calls, 1);
  assert.throws(() => new WmaClient({ secretId: "AKID_test" }), /SecretKey.*required/);
});
