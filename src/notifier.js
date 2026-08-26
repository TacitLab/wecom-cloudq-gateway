"use strict";

const clients = new Map();

function register(botConfigId, client) {
  clients.set(botConfigId, client);
}

function unregister(botConfigId, client) {
  if (!client || clients.get(botConfigId) === client) clients.delete(botConfigId);
}

function clientFor(botConfigId) {
  return clients.get(botConfigId);
}

async function replyStream(botConfigId, frame, streamId, content, finish) {
  const client = clientFor(botConfigId);
  if (!client?.isConnected) throw new Error("WeCom Bot long connection is not available");
  return client.replyStream(frame, streamId, content, finish);
}

async function sendMessage(botConfigId, chatId, content) {
  const client = clientFor(botConfigId);
  if (!client?.isConnected) throw new Error("WeCom Bot long connection is not available");
  const response = await client.sendMessage(String(chatId), {
    msgtype: "markdown",
    markdown: { content: String(content) },
  });
  if (response?.errcode && Number(response.errcode) !== 0) {
    throw new Error(`WeCom proactive message failed: ${response.errmsg || response.errcode}`);
  }
  return response;
}

module.exports = { clientFor, register, replyStream, sendMessage, unregister };
