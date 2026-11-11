"use strict";

const { WmaClient } = require("./wma");
const { createHtmlReply, expectsHtmlAttachment, HTML_DELIVERY_INSTRUCTION, HTML_EXPORT_REQUEST } = require("./html-reply");

class ConversationUnavailableError extends Error {
  constructor(message, options = {}) {
    super(message, options);
    this.name = "ConversationUnavailableError";
  }
}

function isConversationUnavailable(error) {
  if (error instanceof ConversationUnavailableError) return true;
  if ([404, 410].includes(Number(error?.httpStatus))) return true;
  if (error?.code === "ResourceNotFound.Session") return true;
  const message = String(error?.message || "");
  return /session.*(not found|does not exist|deleted|terminated)/i.test(message);
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

class AgentAdapter {
  constructor(config, client) {
    this.config = config;
    this.client = client || new WmaClient(config);
  }

  listVisibleAgents(signal) { return this.client.listVisibleAgents(signal); }
  resolveAgentId(signal) { return this.client.resolveAgentId(signal); }
  createConversation(name, options = {}) { return this.client.createConversation(name, options); }

  async sendMessage(conversation, content, onDelta = () => {}, options = {}) {
    if (!conversation?.sessionId) {
      throw new ConversationUnavailableError("Conversation record has no WMA Session ID");
    }

    let session;
    try {
      session = await this.client.session(conversation, options);
      await session.connect({ signal: options.signal });

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
          "WMA Session is no longer available",
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
  AgentAdapter,
  ConversationUnavailableError,
  createAgentTextFormatter,
  finalizeAgentText,
  isConversationUnavailable,
};
