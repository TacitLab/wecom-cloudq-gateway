"use strict";

function buildConversationKey(message, pairKey, groupSessionScope = "chat") {
  const route = String(pairKey || "").trim();
  const botId = String(message.aibotid || "unknown-bot").trim();
  const userId = String(message.from?.userid || "").trim();
  const chatType = String(message.chattype || "single").trim().toLowerCase();

  if (!route) throw new Error("Missing Bot-Agent pair key");
  if (!userId) throw new Error("Message is missing from.userid");

  if (chatType === "group") {
    const chatId = String(message.chatid || "").trim();
    if (!chatId) throw new Error("Group message is missing chatid");
    return groupSessionScope === "user"
      ? `pair:${route}:bot:${botId}:group:${chatId}:user:${userId}`
      : `pair:${route}:bot:${botId}:group:${chatId}`;
  }

  return `pair:${route}:bot:${botId}:single:${userId}`;
}

function isNewCommand(content) {
  return String(content ?? "").trim().toLowerCase() === "/new";
}

function isStopCommand(content) {
  return String(content ?? "").trim().toLowerCase() === "/stop";
}

/**
 * WeCom keeps the visible @Bot prefix in some group-message callbacks. Strip it
 * only when the remainder is one of the gateway's own complete commands. This
 * avoids turning ordinary text such as "please run /new" into a session reset.
 */
function normalizeGatewayCommand(content, chatType = "single", botName = "") {
  const text = String(content ?? "")
    .replace(/[\u200B-\u200D\uFEFF]/g, "")
    .trim();
  if (String(chatType).toLowerCase() !== "group" || !text.startsWith("@")) return text;

  const command = text.match(/\/(?:new|stop|bind-alert\s+[a-z0-9_-]+)\s*$/i);
  if (!command || command.index === 0) return text;

  const mentionPrefix = text.slice(0, command.index).trim();
  const configuredMention = `@${String(botName || "").trim()}`;
  const isSingleMention = /^@\S+$/.test(mentionPrefix);
  const isConfiguredMention = configuredMention !== "@" && mentionPrefix === configuredMention;
  // The WeCom display name can contain spaces and differ from our local Bot
  // label. Binding must not depend on that label: the one-time code is checked
  // against the receiving Bot in bindChat. Keep stricter parsing for /new and
  // /stop so natural-language requests cannot reset or stop a conversation.
  const isBindWithDisplayMention = /^\/bind-alert\s/i.test(command[0])
    && /^@[^@\r\n]+$/.test(mentionPrefix);
  return isSingleMention || isConfiguredMention || isBindWithDisplayMention ? command[0].trim() : text;
}

function extractPrompt(message) {
  if (message.msgtype === "text") return String(message.text?.content ?? "").trim();
  if (message.msgtype === "voice") {
    return String(message.voice?.content ?? message.voice?.recognition ?? "").trim();
  }
  if (message.msgtype === "mixed" && Array.isArray(message.mixed?.msg_item)) {
    return message.mixed.msg_item
      .filter((item) => item?.msgtype === "text")
      .map((item) => String(item.text?.content ?? "").trim())
      .filter(Boolean)
      .join("\n");
  }
  return "";
}

module.exports = {
  buildConversationKey,
  extractPrompt,
  isNewCommand,
  isStopCommand,
  normalizeGatewayCommand,
};
