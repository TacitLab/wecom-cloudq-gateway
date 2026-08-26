"use strict";

function integer(name, fallback) {
  const raw = process.env[name];
  if (raw === undefined || raw === "") return fallback;
  const value = Number.parseInt(raw, 10);
  if (!Number.isFinite(value)) throw new Error(`${name} must be an integer`);
  return value;
}

function required(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

function boolean(name, fallback = false) {
  const raw = process.env[name]?.trim().toLowerCase();
  if (!raw) return fallback;
  if (["1", "true", "yes", "on"].includes(raw)) return true;
  if (["0", "false", "no", "off"].includes(raw)) return false;
  throw new Error(`${name} must be true or false`);
}

function serverConfig() {
  return {
    host: process.env.HOST?.trim() || "0.0.0.0",
    port: integer("PORT", 3000),
    adminUsername: process.env.ADMIN_USERNAME?.trim() || "admin",
    adminPassword: required("ADMIN_PASSWORD"),
    bodyLimitBytes: integer("HTTP_BODY_LIMIT_BYTES", 1024 * 1024),
    sqlitePath: process.env.SQLITE_PATH?.trim() || "./data/gateway.db",
  };
}

function runtimeConfig() {
  return {
    streamMaxBytes: integer("WECOM_STREAM_MAX_BYTES", 18000),
    streamFlushIntervalMs: integer("STREAM_FLUSH_INTERVAL_MS", 500),
    taskRetentionSeconds: integer("TASK_RETENTION_SECONDS", 86400),
    alertJobRetentionDays: integer("ALERT_JOB_RETENTION_DAYS", 30),
  };
}

module.exports = {
  boolean,
  integer,
  required,
  runtimeConfig,
  serverConfig,
};
