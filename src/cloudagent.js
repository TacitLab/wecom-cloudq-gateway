"use strict";

const crypto = require("node:crypto");
const { createHtmlReply, expectsHtmlAttachment, HTML_DELIVERY_INSTRUCTION, HTML_EXPORT_REQUEST } = require("./html-reply");
const {
  CloudAgentClient,
  NotFoundError,
} = require("@tencent-ai/cloud-agent-sdk");

class ConversationUnavailableError extends Error {
  constructor(message, options = {}) {
    super(message, options);
    this.name = "ConversationUnavailableError";
  }
}

function normalizeId(value, label) {
  const id = String(value ?? "").trim();
  if (!id) throw new Error(`CloudAgent did not return ${label}`);
  return id;
}

function safeRuntimeName(prefix, conversationName) {
  const normalizedPrefix = String(prefix || "wecom")
    .replace(/[^a-zA-Z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 24) || "wecom";
  const digest = crypto.createHash("sha256")
    .update(String(conversationName || "conversation"))
    .digest("hex")
    .slice(0, 10);
  return `${normalizedPrefix}-${digest}-${Date.now()}`.slice(0, 64);
}

function isConversationUnavailable(error) {
  if (error instanceof ConversationUnavailableError || error instanceof NotFoundError) return true;
  if ([404, 410].includes(Number(error?.httpStatus))) return true;
  const message = String(error?.message || "");
  return /(runtime|session).*(not found|does not exist|deleted|terminated|does not have acp link)/i.test(message);
}

function paragraphSeparator(tail, nextText) {
  const trailingNewlines = tail.match(/\n+$/)?.[0].length || 0;
  const leadingNewlines = nextText.match(/^\n+/)?.[0].length || 0;
  return "\n".repeat(Math.max(0, 2 - trailingNewlines - leadingNewlines));
}

function finalizeAgentText(value) {
  let text = String(value || "");
  // Agent transition messages often end in a colon because they expect the
  // next message to follow immediately. Once a progress marker is inserted,
  // that colon becomes visually orphaned, so close the sentence instead.
  text = text.replace(/[：:](?=\n\n💬 )/g, "。");
  return text;
}

function createAgentTextFormatter(onDelta) {
  let hasText = false;
  let lastMessageId;
  let boundaryAfterTool = false;
  let tail = "";

  const append = (value) => {
    if (!value) return;
    onDelta(value);
    tail = (tail + value).slice(-32);
  };

  return (notification) => {
    const update = notification?.update;
    if (update?.sessionUpdate !== "agent_message_chunk") {
      if (hasText && update?.sessionUpdate === "tool_call") boundaryAfterTool = true;
      return;
    }
    if (update.content?.type !== "text" || !update.content.text) return;

    const text = update.content.text;
    const messageId = update.messageId == null ? undefined : String(update.messageId);
    const newMessage = Boolean(
      hasText && messageId && lastMessageId && messageId !== lastMessageId,
    );
    const startsNewProgress = !hasText || newMessage || boundaryAfterTool;
    let formattedText = text;
    if (startsNewProgress) {
      if (hasText) append(paragraphSeparator(tail, ""));
      append("💬 ");
      formattedText = text.replace(/^\n+/, "");
    }

    append(formattedText);
    hasText = true;
    boundaryAfterTool = false;
    if (messageId) lastMessageId = messageId;
  };
}

function createFinalAgentTextCollector() {
  let text = "";
  let lastMessageId;
  return {
    onNotification(notification) {
      const update = notification?.update;
      // Text before a tool call describes work in progress. Buffer the last
      // Agent message until the turn ends so none of that text is pushed.
      if (update?.sessionUpdate === "tool_call") {
        text = "";
        lastMessageId = undefined;
        return;
      }
      if (update?.sessionUpdate !== "agent_message_chunk" || update.content?.type !== "text") return;
      if (!update.content.text) return;
      const messageId = update.messageId == null ? undefined : String(update.messageId);
      if (messageId && lastMessageId && messageId !== lastMessageId) text = "";
      text += update.content.text;
      if (messageId) lastMessageId = messageId;
    },
    getText: () => text,
  };
}

class CloudAgentAdapter {
  constructor(config, client) {
    this.config = config;
    this.client = client || new CloudAgentClient({
      apiKey: config.apiKey,
      baseUrl: config.baseUrl,
      sourceApp: config.sourceApp,
      timeoutMs: config.controlTimeoutMs,
      logLevel: config.logLevel,
      retry: {
        maxAttempts: 3,
        backoffMs: 300,
        backoffFactor: 2,
        jitter: true,
      },
    });
  }

  agentManifest() {
    return {
      id: this.config.agentId,
      name: this.config.agentName,
      manifestVersion: this.config.manifestVersion,
      ...this.config.manifest,
    };
  }

  async listVisibleAgents(signal) {
    const pageSize = 100;
    const agents = [];
    let page = 1;

    while (true) {
      const result = await this.client.agents.list({
        page,
        pageSize,
        timeoutMs: this.config.controlTimeoutMs,
        signal,
      });
      const items = Array.isArray(result?.items) ? result.items : [];
      for (const item of items) {
        agents.push({
          id: String(item?.id || "").trim(),
          agentId: String(item?.agentId || item?.id || "").trim(),
          agentName: String(item?.agentName || item?.name || "").trim(),
          description: String(item?.description || "").trim(),
          enabled: item?.enabled !== false,
        });
      }
      const total = Number(result?.total || 0);
      if (items.length === 0 || page * pageSize >= total) break;
      page += 1;
    }

    return agents;
  }

  async resolveAgentInternalId(signal) {
    const configuredId = normalizeId(this.config.agentId, "configured Agent ID");
    const pageSize = 100;
    let page = 1;

    while (true) {
      const result = await this.client.agents.list({
        page,
        pageSize,
        timeoutMs: this.config.controlTimeoutMs,
        signal,
      });
      const items = Array.isArray(result?.items) ? result.items : [];
      const matched = items.find((item) =>
        String(item?.agentId || "").trim() === configuredId ||
        String(item?.id || "").trim() === configuredId,
      );
      if (matched) {
        if (matched.enabled === false) {
          throw new Error(`Configured CloudAgent is disabled: ${configuredId}`);
        }
        return normalizeId(matched.id, "internal Agent ID");
      }

      const total = Number(result?.total || 0);
      if (items.length === 0 || page * pageSize >= total) break;
      page += 1;
    }

    throw new Error(
      `Configured CLOUD_AGENT_ID is not visible to this API key: ${configuredId}`,
    );
  }

  async createConversation(conversationName, options = {}) {
    // WorkBuddy displays a stable business ID such as `agent_...`, while the
    // Agent Session API expects the Agent record's internal `id`. Resolve the
    // mapping through the authenticated Agent list before creating a Session.
    const internalAgentId = await this.resolveAgentInternalId(options.signal);
    const runtimeName = safeRuntimeName(this.config.runtimeNamePrefix, conversationName);
    const runtime = await this.client.runtimes.create({
      runtimeName,
      agentManifest: this.agentManifest(),
      metadata: {
        channel: "wecom-aibot",
        agentId: this.config.agentId,
        sessionMode: "published-agent",
      },
      timeoutMs: this.config.controlTimeoutMs,
      signal: options.signal,
    });
    // The Runtime's default Session only uses the bootstrap manifest above.
    // Creating an Agent Session by agentId makes AgentOS load the Agent's
    // current published manifest, including its system prompt and skills.
    const session = await runtime.sessions.create({
      agentId: internalAgentId,
      sessionName: `${runtimeName}-agent`.slice(0, 64),
      timeoutMs: this.config.controlTimeoutMs,
      signal: options.signal,
    });
    return {
      version: 1,
      runtimeId: normalizeId(runtime.id, "runtime ID"),
      sessionId: normalizeId(session.id, "Agent Session ID"),
      createdAt: Date.now(),
    };
  }

  async sendMessage(conversation, content, onDelta = () => {}, options = {}) {
    if (!conversation?.runtimeId || !conversation?.sessionId) {
      throw new ConversationUnavailableError("Conversation record has no Runtime or Session ID");
    }

    let session;
    try {
      const runtime = await this.client.runtimes.get(
        String(conversation.runtimeId),
        { timeoutMs: this.config.controlTimeoutMs, signal: options.signal },
      );
      session = await runtime.sessions.get(
        String(conversation.sessionId),
        { timeoutMs: this.config.controlTimeoutMs, signal: options.signal },
      );
      await session.connect({
        reconnectMaxAttempts: this.config.reconnectMaxAttempts,
        reconnectBackoffMs: this.config.reconnectBackoffMs,
        reconnectMaxBackoffMs: this.config.reconnectMaxBackoffMs,
        heartbeatTimeoutMs: this.config.heartbeatTimeoutMs,
        signal: options.signal,
      });

      const finalText = options.showThinking === false ? createFinalAgentTextCollector() : undefined;
      const onNotification = finalText ? finalText.onNotification : createAgentTextFormatter(onDelta);
      const htmlRequested = options.htmlAttachments && expectsHtmlAttachment(content);
      const htmlReply = options.htmlAttachments ? createHtmlReply(onNotification, { allowHtmlFence: htmlRequested }) : undefined;

      const input = htmlReply ? `${String(content)}\n\n${HTML_DELIVERY_INSTRUCTION}` : String(content);
      const response = await session.prompt(input, {
        timeoutMs: this.config.promptTimeoutMs,
        includeThinking: options.showThinking === false ? false : this.config.includeThinking,
        onChunk: htmlReply ? htmlReply.onNotification : onNotification,
        signal: options.signal,
      });
      let delivery = htmlReply?.finish();
      // Published skills may save/display a sandbox report and return only a
      // summary. Ask once for the existing report in the same Session instead
      // of silently treating a summary as successful file delivery.
      if (htmlRequested && !delivery.attachments.length && response.stopReason === "end_turn") {
        options.signal?.throwIfAborted();
        const exported = createHtmlReply(() => {}, { allowHtmlFence: true });
        try {
          const result = await session.prompt(HTML_EXPORT_REQUEST, {
            timeoutMs: this.config.promptTimeoutMs,
            includeThinking: false,
            onChunk: exported.onNotification,
            signal: options.signal,
          });
          const recovered = exported.finish();
          if (result.stopReason === "end_turn" && recovered.attachments.length) delivery = recovered;
        } catch (error) {
          options.signal?.throwIfAborted();
          // Keep the original brief available even if exporting the report fails.
          // SDK errors can contain credentials from the conversation; do not log them.
        }
      }
      if (htmlRequested && !delivery.attachments.length && !delivery.warnings.length) {
        delivery.warnings.push("未收到完整 HTML 源码，报告附件未发送。请重试生成报告。");
      }
      if (finalText?.getText()) onDelta(finalText.getText());
      return delivery ? { ...response, ...delivery } : response;
    } catch (error) {
      if (isConversationUnavailable(error)) {
        throw new ConversationUnavailableError(
          "CloudAgent Runtime or Session is no longer available",
          { cause: error },
        );
      }
      throw error;
    } finally {
      if (session) await session.disconnect().catch(() => {});
    }
  }
}

module.exports = {
  CloudAgentAdapter,
  ConversationUnavailableError,
  createAgentTextFormatter,
  finalizeAgentText,
  isConversationUnavailable,
  safeRuntimeName,
};
