"use strict";

const crypto = require("node:crypto");
const { WSClient } = require("@wecom/aibot-node-sdk");
const gateway = require("./gateway");
const notifier = require("./notifier");
const registry = require("./registry");
const { safeError } = require("./utils");

class BotManager {
  constructor() {
    this.connections = new Map();
  }

  fingerprint(bot) {
    return crypto.createHash("sha256").update(JSON.stringify([bot.botId, bot.secret, bot.wsUrl])).digest("hex");
  }

  create(bot) {
    const client = new WSClient({
      botId: bot.botId,
      secret: bot.secret,
      maxReconnectAttempts: -1,
      ...(bot.wsUrl ? { wsUrl: bot.wsUrl } : {}),
    });
    const entry = {
      client,
      fingerprint: this.fingerprint(bot),
      status: "connecting",
      detail: "",
      updatedAt: Date.now(),
    };
    const setStatus = (status, detail = "") => {
      entry.status = status;
      entry.detail = String(detail || "").slice(0, 300);
      entry.updatedAt = Date.now();
    };
    client.on("connected", () => setStatus("connected"));
    client.on("authenticated", () => {
      setStatus("authenticated");
      require("./alert-worker").schedule();
    });
    client.on("disconnected", (reason) => setStatus("disconnected", reason));
    client.on("reconnecting", (attempt) => setStatus("reconnecting", `attempt ${attempt}`));
    client.on("error", (error) => {
      setStatus("error", safeError(error));
      console.error("wecom_connection_error", { botConfigId: bot.id, message: safeError(error) });
    });
    for (const eventName of ["message.text", "message.voice", "message.mixed"]) {
      client.on(eventName, (frame) => gateway.safeMessageHandler(bot.id, client, frame));
    }
    client.on("event.enter_chat", (frame) => {
      gateway.handleEnterChat(bot.id, client, frame).catch((error) =>
        console.error("wecom_welcome_failed", { botConfigId: bot.id, message: safeError(error) }),
      );
    });
    notifier.register(bot.id, client);
    client.connect();
    return entry;
  }

  sync() {
    const desired = new Map(registry.listBots({ secrets: true }).filter((bot) => bot.enabled).map((bot) => [bot.id, bot]));
    for (const [id, entry] of this.connections) {
      const bot = desired.get(id);
      if (!bot || entry.fingerprint !== this.fingerprint(bot)) {
        notifier.unregister(id, entry.client);
        entry.client.disconnect();
        this.connections.delete(id);
      }
    }
    for (const [id, bot] of desired) {
      if (!this.connections.has(id)) this.connections.set(id, this.create(bot));
    }
    return this.statuses();
  }

  statuses() {
    return Object.fromEntries([...this.connections].map(([id, entry]) => [id, {
      status: entry.status,
      detail: entry.detail,
      connected: Boolean(entry.client.isConnected),
      updatedAt: entry.updatedAt,
    }]));
  }

  stop() {
    for (const [id, entry] of this.connections) {
      notifier.unregister(id, entry.client);
      entry.client.disconnect();
    }
    this.connections.clear();
  }
}

module.exports = { BotManager };
