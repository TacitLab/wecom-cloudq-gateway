"use strict";

// WMA Tencent Cloud API 3.0 control plane and direct ACP data plane. Protocol reference:
// https://cloud.tencent.com/document/product/1831/140759
const { authorization } = require("./monitor-client");
const DEFAULT_WMA_CAPI_URL = "https://workbuddyenterprise.tencentcloudapi.com";
function requiredId(value, name) {
  // WMA IDs can exceed Number.MAX_SAFE_INTEGER; never coerce JSON numbers.
  if (typeof value !== "string" || !/^[a-zA-Z0-9_-]+$/.test(value)) throw new Error(`Invalid WMA ${name}: expected a string ID`);
  return value;
}

function remoteError(status, code, requestId) {
  const clean = (s) => String(s || "").replace(/[^a-zA-Z0-9_.-]/g, "").slice(0, 100);
  const error = new Error(`WMA request failed (HTTP ${status}${code ? `, ${clean(code)}` : ""}${requestId ? `, requestId=${clean(requestId)}` : ""})`);
  error.httpStatus = status;
  error.code = clean(code);
  return error;
}

function timedSignal(signal, timeoutMs) {
  const timeout = AbortSignal.timeout(timeoutMs || 30000);
  return signal ? AbortSignal.any([signal, timeout]) : timeout;
}

class WmaClient {
  constructor(config, fetchImpl = globalThis.fetch) {
    this.config = config;
    this.fetch = fetchImpl;
    if (!config.secretId || !config.secretKey) throw new Error("WMA SecretId and SecretKey are required");
    this.region = config.region || "ap-guangzhou";
    if (!/^[a-z]+-[a-z]+(?:-\d+)?$/.test(this.region)) throw new Error("Invalid WMA region");
  }

  async request(action, params, { signal } = {}) {
    const timestamp = Math.floor(Date.now() / 1000);
    const payload = JSON.stringify(params);
    const contentType = "application/json; charset=utf-8";
    const response = await this.fetch(DEFAULT_WMA_CAPI_URL, {
      method: "POST",
      headers: {
        Authorization: authorization(this.config.secretId, this.config.secretKey, timestamp, payload, contentType, "workbuddyenterprise"),
        "Content-Type": contentType, Host: "workbuddyenterprise.tencentcloudapi.com",
        "X-TC-Action": action, "X-TC-Version": "2026-07-09",
        "X-TC-Timestamp": String(timestamp), "X-TC-Region": this.region,
      },
      body: payload, signal: timedSignal(signal, this.config.controlTimeoutMs), redirect: "error",
    });
    const result = (await response.json().catch(() => null))?.Response;
    if (!response.ok || !result || result.Error) {
      const code = result?.Error?.Code;
      const status = !response.ok ? response.status
        : /^AuthFailure/.test(code) ? 401
        : /^UnauthorizedOperation/.test(code) ? 403
        : /^ResourceNotFound/.test(code) ? 404
        : /^(InvalidParameter|MissingParameter)/.test(code) ? 400 : 502;
      throw remoteError(status, code, result?.RequestId);
    }
    // Normalize known CAPI response fields to the common OpenAPI/ACP adapter.
    const camel = (value) => Array.isArray(value) ? value.map(camel) : value && typeof value === "object"
      ? Object.fromEntries(Object.entries(value).map(([key, item]) => [key.charAt(0).toLowerCase() + key.slice(1), camel(item)])) : value;
    return camel(result);
  }

  async listVisibleAgents(signal) {
    const agents = [];
    for (let page = 1; ; page += 1) {
      const data = await this.request("DescribeAgentList", { Offset: (page - 1) * 100, Limit: 100 }, { signal });
      if (!Array.isArray(data.agentSet) || !Number.isSafeInteger(data.totalCount) || data.totalCount < 0) throw new Error("Invalid WMA Agent list response");
      for (const item of data.agentSet) {
        const id = requiredId(item.agentId, "Agent ID");
        agents.push({ id, agentId: id, agentName: String(item.agentName || id), description: String(item.description || ""), enabled: item.publicApiEnabled !== false, publicApiEnabled: item.publicApiEnabled });
      }
      if (!data.agentSet.length || page * 100 >= data.totalCount) break;
    }
    return agents;
  }

  async resolveAgentId(signal) {
    const id = requiredId(this.config.agentId, "Agent ID");
    const agent = await this.request("DescribeAgent", { AgentId: id }, { signal });
    if (requiredId(agent.agentId, "Agent ID") !== id) throw new Error("Invalid WMA Agent response: ID mismatch");
    if (agent.publicApiEnabled === false) throw new Error("WMA Agent public API is unavailable; enable public access in the WMA console");
    return id;
  }

  async createConversation(_name, options = {}) {
    const id = requiredId(this.config.agentId, "Agent ID");
    // Non-idempotent: create once; never retry a session allocation automatically.
    const data = await this.request("CreateAgentSession", {
      AgentId: id,
      ...(this.config.wmaVersionId ? { VersionId: requiredId(this.config.wmaVersionId, "Version ID") } : {}),
    }, options);
    return {
      sessionId: requiredId(data.sessionId, "Session ID"),
      createdAt: Date.now(),
    };
  }

  async accessToken(signal, refresh = false) {
    if (refresh) this.token = undefined;
    if (this.token && Date.now() < this.token.expiresAt) return this.token.value;
    const data = await this.request("DescribeUserAccessToken", {}, { signal });
    if (typeof data.accessToken !== "string" || !data.accessToken) throw new Error("Invalid WMA response: missing access token");
    const seconds = Number(data.expiresIn) || 0;
    this.token = { value: data.accessToken, expiresAt: Date.now() + Math.max(0, seconds - 300) * 1000 };
    return this.token.value;
  }

  async session(conversation, options = {}) {
    const id = requiredId(this.config.agentId, "Agent ID");
    const sessionId = requiredId(conversation.sessionId, "Session ID");
    const data = await this.request("DescribeAgentSession", { SessionId: sessionId }, options);
    if (data.agentId && data.agentId !== id) throw Object.assign(new Error("WMA session does not belong to this Agent"), { httpStatus: 410 });
    if (this.config.wmaVersionId && data.versionId !== this.config.wmaVersionId) {
      throw Object.assign(new Error("WMA session does not match the configured version"), { httpStatus: 410 });
    }
    if (["FAILED", "ARCHIVED"].includes(data.status)) throw Object.assign(new Error("WMA session is unavailable"), { httpStatus: 410 });
    const endpoint = data.endpointSet?.find((item) => item.endpointType === "PUBLIC")?.url;
    if (!endpoint) throw new Error("WMA public chat endpoint is unavailable; enable public access in the WMA console");
    const url = new URL(endpoint);
    if (!["https:", "http:"].includes(url.protocol) || url.username || url.password || url.search || url.hash) throw new Error("Invalid WMA ACP endpoint");
    url.pathname = `${url.pathname.replace(/\/$/, "")}/v1/agents/acp`;
    return new WmaSession(this, sessionId, url.toString());
  }
}

// SSE frames may be split across UTF-8 bytes, use CRLF, or span data lines.
async function readSse(body, onMessage) {
  if (!body) throw new Error("Invalid WMA ACP response: missing SSE body");
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let data = [];
  function line(value) {
    if (!value) {
      if (data.length) {
        let message;
        try { message = JSON.parse(data.join("\n")); }
        catch { throw new Error("Invalid WMA ACP event: malformed JSON"); }
        onMessage(message);
      }
      data = [];
    } else if (value.startsWith("data:")) data.push(value.slice(5).replace(/^ /, ""));
  }
  try {
    while (true) {
      const chunk = await reader.read();
      buffer += chunk.done ? decoder.decode() : decoder.decode(chunk.value, { stream: true });
      let match;
      while ((match = /\r\n|\r(?!$)|\n/.exec(buffer))) {
        line(buffer.slice(0, match.index));
        buffer = buffer.slice(match.index + match[0].length);
      }
      if (buffer.length > 8 * 1024 * 1024 || data.join("").length > 8 * 1024 * 1024) throw new Error("WMA ACP event is too large");
      if (chunk.done) break;
    }
    if (buffer) line(buffer.replace(/\r$/, ""));
    line("");
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}

class WmaSession {
  constructor(client, id, endpoint) {
    this.client = client;
    this.id = id;
    this.endpoint = endpoint;
    this.pending = new Map();
    this.nextId = 1;
    this.controller = new AbortController();
  }

  headers() {
    return { Authorization: `Bearer ${this.token}`, "X-Agent-Session-Id": this.id, ...(this.connectionId ? { "Acp-Connection-Id": this.connectionId } : {}) };
  }

  fail(error) {
    this.failure = error;
    for (const entry of this.pending.values()) entry.reject(error);
  }

  dispatch(message) {
    if (message.method && message.id != null) {
      // There is no interactive permission UI in the WeCom gateway.
      const reply = { jsonrpc: "2.0", id: message.id };
      if (message.method === "session/request_permission") reply.result = { outcome: { outcome: "cancelled" } };
      else if (message.method === "_codebuddy.ai/question") reply.result = { outcome: { outcome: "cancelled" } };
      else reply.error = { code: -32601, message: "Method not supported" };
      this.post(reply).catch((error) => this.fail(error));
    } else if (message.method === "session/update" && message.params?.sessionId === this.id) {
      this.onChunk?.(message.params);
    } else if (message.id != null) {
      const entry = this.pending.get(message.id);
      if (entry) {
        if (message.error) entry.reject(remoteError(200, `ACP.${message.error.code}`));
        else entry.resolve(message.result);
      }
    }
  }

  async post(message, signal = this.controller.signal) {
    const response = await this.client.fetch(this.endpoint, {
      method: "POST", headers: { ...this.headers(), "Content-Type": "application/json", Accept: "application/json, text/event-stream" },
      body: JSON.stringify(message), signal, redirect: "error",
    });
    if (!response.ok) throw remoteError(response.status);
    if (response.headers.get("content-type")?.includes("text/event-stream")) await readSse(response.body, (item) => this.dispatch(item));
    else if (response.status !== 202 && response.status !== 204) {
      const result = await response.json().catch(() => { throw new Error("Invalid WMA ACP response: malformed JSON"); });
      this.dispatch(result);
    }
  }

  async rpc(method, params, options = {}) {
    if (this.failure) throw this.failure;
    const id = this.nextId++;
    const signal = timedSignal(options.signal, options.timeoutMs || this.client.config.controlTimeoutMs);
    const requestSignal = AbortSignal.any([signal, this.controller.signal]);
    let abort;
    const result = new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      abort = () => {
        if (method === "session/prompt") this.cancellation = this.post({ jsonrpc: "2.0", method: "session/cancel", params: { sessionId: this.id } }, AbortSignal.timeout(2000)).catch(() => {});
        reject(requestSignal.reason);
      };
      requestSignal.addEventListener("abort", abort, { once: true });
      if (requestSignal.aborted) abort();
    });
    if (!requestSignal.aborted) this.post({ jsonrpc: "2.0", id, method, params }, requestSignal).catch((error) => this.pending.get(id)?.reject(error));
    try { return await result; }
    finally {
      requestSignal.removeEventListener("abort", abort);
      this.pending.delete(id);
    }
  }

  async connect(options = {}) {
    this.token = await this.client.accessToken(options.signal);
    // Retry only an unauthorized handshake, never a submitted prompt.
    for (let attempt = 0; ; attempt += 1) {
      const handshake = new AbortController();
      const timer = setTimeout(() => handshake.abort(new Error("WMA ACP connection timed out")), this.client.config.controlTimeoutMs || 30000);
      const signal = AbortSignal.any([this.controller.signal, handshake.signal, ...(options.signal ? [options.signal] : [])]);
      let response;
      try {
        response = await this.client.fetch(this.endpoint, { headers: { ...this.headers(), Accept: "text/event-stream" }, signal, redirect: "error" });
      } finally { clearTimeout(timer); }
      if (response.status === 401 && attempt === 0) {
        await response.body?.cancel();
        this.token = await this.client.accessToken(options.signal, true);
        continue;
      }
      if (!response.ok) throw remoteError(response.status);
      this.connectionId = response.headers.get("Acp-Connection-Id");
      if (!this.connectionId) { await response.body?.cancel(); throw new Error("Invalid WMA ACP response: missing connection ID"); }
      this.stream = readSse(response.body, (message) => this.dispatch(message))
        .then(() => { if (!this.controller.signal.aborted) this.fail(new Error("WMA ACP connection closed before the turn completed")); })
        .catch((error) => { if (!this.controller.signal.aborted) this.fail(error); });
      break;
    }
    await this.rpc("initialize", { protocolVersion: 1, clientCapabilities: { fs: { readTextFile: false, writeTextFile: false }, terminal: false }, clientInfo: { name: "wecom-wma-gateway", version: "1.0" } }, options);
    // Load history before installing the turn listener, preventing replay.
    await this.rpc("session/load", { sessionId: this.id, cwd: "/workspace", mcpServers: [] }, options);
  }

  async prompt(input, options = {}) {
    this.onChunk = (notification) => {
      if (!options.includeThinking && notification.update?.sessionUpdate === "agent_thought_chunk") return;
      options.onChunk?.(notification);
    };
    try { return await this.rpc("session/prompt", { sessionId: this.id, prompt: [{ type: "text", text: String(input) }] }, options); }
    finally { this.onChunk = undefined; }
  }

  async disconnect() {
    await this.cancellation;
    if (this.connectionId) {
      await this.client.fetch(this.endpoint, { method: "DELETE", headers: this.headers(), signal: AbortSignal.timeout(2000), redirect: "error" }).catch(() => {});
    }
    this.controller.abort();
    this.fail(new Error("WMA ACP disconnected"));
    await this.stream;
  }
}

module.exports = { WmaClient, WmaSession, readSse };
