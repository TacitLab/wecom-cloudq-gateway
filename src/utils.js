"use strict";

const crypto = require("node:crypto");

function randomId(prefix = "id") {
  return `${prefix}_${Date.now().toString(36)}_${crypto.randomBytes(8).toString("hex")}`;
}

function getByPath(value, path) {
  return path.split(".").reduce((current, part) => {
    if (current === null || current === undefined) return undefined;
    const key = /^\d+$/.test(part) ? Number(part) : part;
    return current[key];
  }, value);
}

function replaceTemplate(value, variables) {
  if (Array.isArray(value)) return value.map((item) => replaceTemplate(item, variables));
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, child]) => [key, replaceTemplate(child, variables)]),
    );
  }
  if (typeof value !== "string") return value;

  const exact = value.match(/^\{\{([A-Za-z0-9_]+)\}\}$/);
  if (exact) return variables[exact[1]] ?? "";

  return value.replace(/\{\{([A-Za-z0-9_]+)\}\}/g, (_match, key) =>
    String(variables[key] ?? ""),
  );
}

function renderUrl(template, variables) {
  return template.replace(/\{([A-Za-z0-9_]+)\}/g, (_match, key) =>
    encodeURIComponent(String(variables[key] ?? "")),
  );
}

function truncateUtf8(text, maxBytes) {
  const source = String(text ?? "");
  if (Buffer.byteLength(source, "utf8") <= maxBytes) return source;

  const suffix = "\n\n[内容过长，已截断]";
  const allowed = Math.max(0, maxBytes - Buffer.byteLength(suffix, "utf8"));
  let low = 0;
  let high = source.length;
  while (low < high) {
    const middle = Math.ceil((low + high) / 2);
    if (Buffer.byteLength(source.slice(0, middle), "utf8") <= allowed) low = middle;
    else high = middle - 1;
  }
  return source.slice(0, low) + suffix;
}

function safeError(error) {
  if (error instanceof Error) return error.message;
  return String(error);
}

module.exports = {
  getByPath,
  randomId,
  renderUrl,
  replaceTemplate,
  safeError,
  truncateUtf8,
};

