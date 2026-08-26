"use strict";

const active = new Map();

function schedule(conversationKey) {
  if (active.has(conversationKey)) return active.get(conversationKey);
  const promise = Promise.resolve()
    .then(() => require("./worker").processConversation(conversationKey))
    .catch((error) => console.error("conversation_worker_failed", { conversationKey, message: error.message }))
    .finally(() => {
      active.delete(conversationKey);
      const stillQueued = require("./store").queuedConversationKeys().includes(conversationKey);
      if (stillQueued) schedule(conversationKey);
    });
  active.set(conversationKey, promise);
  return promise;
}

async function drain() {
  await Promise.allSettled([...active.values()]);
}

module.exports = { drain, schedule };
