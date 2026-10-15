"use strict";

const crypto = require("node:crypto");
const { safeError } = require("./utils");

const GENERATE_URL = "https://work.weixin.qq.com/ai/qc/generate";
const QUERY_URL = "https://work.weixin.qq.com/ai/qc/query_result";
const SESSION_TTL_MS = 5 * 60 * 1000;
const DEFAULT_SOURCE = "wecom_cli_external";

const sessions = new Map();
let warnedDefaultSource = false;

function pairingSource() {
  const source = process.env.WECOM_PAIRING_SOURCE?.trim();
  if (source) return source;
  if (!warnedDefaultSource) {
    warnedDefaultSource = true;
    console.warn("wecom_pairing_default_source", {
      message: "WECOM_PAIRING_SOURCE is not set; falling back to the wecom-cli source identifier. Request an approved source for production use.",
    });
  }
  return DEFAULT_SOURCE;
}

function sweep(now = Date.now()) {
  for (const [id, session] of sessions) {
    if (session.expiresAt <= now && session.status !== "paired") sessions.delete(id);
  }
}

async function fetchJson(fetchImpl, url) {
  const response = await fetchImpl(url, { signal: AbortSignal.timeout(15000) });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(`WeCom pairing HTTP ${response.status}`);
  return result;
}

async function createSession({ fetchImpl = globalThis.fetch } = {}) {
  sweep();
  const result = await fetchJson(fetchImpl,
    `${GENERATE_URL}?source=${encodeURIComponent(pairingSource())}&plat=3`);
  const scode = result?.data?.scode;
  const authUrl = result?.data?.auth_url;
  if (!scode || !authUrl) throw new Error("WeCom pairing session is unavailable");
  const id = crypto.randomUUID();
  sessions.set(id, {
    scode,
    status: "pending",
    botId: "",
    botName: "",
    secret: "",
    expiresAt: Date.now() + SESSION_TTL_MS,
  });
  return { pairingId: id, authUrl, expiresAt: sessions.get(id).expiresAt };
}

async function getSessionStatus(id, { fetchImpl = globalThis.fetch } = {}) {
  const session = sessions.get(String(id || ""));
  if (!session) return { status: "expired" };
  if (session.status === "paired") {
    return { status: "paired", botId: session.botId, botName: session.botName };
  }
  if (session.expiresAt <= Date.now()) {
    sessions.delete(id);
    return { status: "expired" };
  }
  try {
    const result = await fetchJson(fetchImpl,
      `${QUERY_URL}?scode=${encodeURIComponent(session.scode)}`);
    const data = result?.data || {};
    // Official CLI semantics: anything other than "success" means keep waiting.
    if (data.status === "success" && data.bot_info?.botid && data.bot_info?.secret) {
      session.status = "paired";
      session.botId = String(data.bot_info.botid);
      session.secret = String(data.bot_info.secret);
      session.botName = String(data.bot_info.name || data.bot_info.bot_name || "");
      return { status: "paired", botId: session.botId, botName: session.botName };
    }
  } catch (error) {
    // A transient polling error must not kill an otherwise valid session.
    console.error("wecom_pairing_poll_failed", { message: safeError(error) });
  }
  return { status: "pending" };
}

function completeSession(id) {
  const session = sessions.get(String(id || ""));
  if (!session || session.status !== "paired") throw new Error("Pairing session is expired or not completed");
  sessions.delete(id);
  return { botId: session.botId, secret: session.secret, botName: session.botName };
}

module.exports = { completeSession, createSession, getSessionStatus, SESSION_TTL_MS };
