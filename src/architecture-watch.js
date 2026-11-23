"use strict";

const crypto = require("node:crypto");
const { db } = require("./database");
const registry = require("./registry");
const { TencentMonitorClient } = require("./monitor-client");
const { credentialRedactor } = require("./alert-credentials");

function credentialFor(id) {
  const credential = registry.getTencentCredential(id, { secrets: true });
  if (!credential) throw new Error("Tencent Cloud credential not found，请重新选择腾讯云凭证");
  return credential;
}

async function request(credential, action, params) {
  try {
    return await new TencentMonitorClient(credential, globalThis.fetch, { service: "advisor", version: "2020-07-21" })
      .request(action, params);
  } catch (error) {
    const failure = new Error(`架构图查询失败，请检查凭证、智能顾问读取权限及网络：${credentialRedactor(credential)(error.message)}`);
    failure.httpStatus = 400;
    throw failure;
  }
}

function normalizeArch(arch) {
  if (!arch || typeof arch.ArchId !== "string" || typeof arch.ArchName !== "string") {
    throw new Error("Invalid Advisor architecture response");
  }
  return {
    archId: arch.ArchId, archName: arch.ArchName,
    description: typeof arch.Description === "string" ? arch.Description : "",
    versionName: typeof arch.VersionName === "string" ? arch.VersionName : "",
    updatedAt: typeof arch.UpdateTime === "string" ? arch.UpdateTime : "",
  };
}

async function architecturePage(credential, pageNumber, pageSize) {
  const result = await request(credential, "DescribeArchList", { PageNumber: pageNumber, PageSize: pageSize });
  // Advisor omits TotalCount when there are no matches. Only accept the
  // omission for an explicit empty list; other incomplete responses stay invalid.
  const totalCount = result.TotalCount === undefined && Array.isArray(result.ArchList) && result.ArchList.length === 0
    ? 0 : result.TotalCount;
  if (!Array.isArray(result.ArchList) || !Number.isSafeInteger(totalCount) || totalCount < 0) {
    throw new Error("Invalid Advisor architecture list response");
  }
  return { items: result.ArchList.map(normalizeArch), totalCount };
}

async function listArchitectures(credentialId, { pageNumber = 1, pageSize = 20, search = "" } = {}) {
  const page = Number(pageNumber), size = Number(pageSize);
  if (!Number.isSafeInteger(page) || page < 1 || !Number.isSafeInteger(size) || size < 1 || size > 100) {
    throw new Error("Invalid architecture pagination");
  }
  if (typeof search !== "string" || search.length > 100) throw new Error("Invalid architecture search");
  const credential = credentialFor(credentialId);
  const keyword = search.trim().toLowerCase();
  if (!keyword) {
    return { ...await architecturePage(credential, page, size), pageNumber: page, pageSize: size };
  }

  // Advisor's ArchName filter matches whole names, not substrings. Search all
  // account pages here, then paginate matches so later cloud pages are included.
  const batchSize = 100;
  const first = await architecturePage(credential, 1, batchSize);
  const matches = new Map();
  function collect(items) {
    for (const arch of items) {
      if (arch.archName.toLowerCase().includes(keyword)) matches.set(arch.archId, arch);
    }
  }
  collect(first.items);
  const pages = Math.ceil(first.totalCount / batchSize);
  for (let cloudPage = 2; cloudPage <= pages; cloudPage++) {
    const result = await architecturePage(credential, cloudPage, batchSize);
    collect(result.items);
  }
  const items = [...matches.values()];
  return { items: items.slice((page - 1) * size, page * size), totalCount: items.length, pageNumber: page, pageSize: size };
}

const WATCH_SELECT = `SELECT w.*,c.name AS credential_name,s.enabled AS duty_enabled,s.last_error AS duty_error
  FROM architecture_watches w JOIN tencent_credentials c ON c.id=w.credential_id
  LEFT JOIN architecture_watch_settings s ON s.watch_id=w.id`;

function fromRow(row) {
  return { id: row.id, credentialId: row.credential_id, credentialName: row.credential_name,
    archId: row.arch_id, archName: row.arch_name, description: row.description,
    versionName: row.version_name, createdAt: row.created_at, dutyEnabled: Boolean(row.duty_enabled), dutyError: row.duty_error || '' };
}

function listWatches() {
  return db().prepare(`${WATCH_SELECT} ORDER BY w.created_at DESC,w.id`).all().map(fromRow);
}

function getWatch(id) {
  const row = db().prepare(`${WATCH_SELECT} WHERE w.id=?`).get(id);
  if (!row) throw new Error("Architecture watch not found");
  return fromRow(row);
}

async function addWatch(input) {
  if (typeof input.credentialId !== "string" || !input.credentialId) throw new Error("Tencent Cloud credential is required");
  if (typeof input.archId !== "string" || !/^arch-[a-zA-Z0-9-]{1,100}$/.test(input.archId)) throw new Error("Invalid architecture ID");
  const credential = credentialFor(input.credentialId);
  if (db().prepare("SELECT 1 FROM architecture_watches WHERE credential_id=? AND arch_id=?").get(input.credentialId, input.archId)) {
    const error = new Error("该架构图已添加，请勿重复添加"); error.httpStatus = 409; throw error;
  }
  // Re-read from Tencent Cloud: browser-supplied names and metadata are never trusted.
  const result = await request(credential, "DescribeArch", { ArchId: input.archId, Username: "cloudq-gateway" });
  const arch = normalizeArch(result.Arch);
  if (arch.archId !== input.archId) throw new Error("Invalid Advisor architecture ID response");
  const current = credentialFor(input.credentialId);
  if (current.secretId !== credential.secretId || current.secretKey !== credential.secretKey) {
    throw new Error("Invalid credential state，凭证已变更，请重新查询后添加");
  }
  const id = crypto.randomUUID();
  try {
    db().prepare(`INSERT INTO architecture_watches
      (id,credential_id,arch_id,arch_name,description,version_name,created_at) VALUES (?,?,?,?,?,?,?)`)
      .run(id, input.credentialId, arch.archId, arch.archName, arch.description, arch.versionName, Date.now());
  } catch (error) {
    if (/UNIQUE constraint/.test(error.message)) {
      const duplicate = new Error("该架构图已添加，请勿重复添加"); duplicate.httpStatus = 409; throw duplicate;
    }
    throw error;
  }
  return fromRow(db().prepare(`${WATCH_SELECT} WHERE w.id=?`).get(id));
}

function removeWatch(id) {
  if (!db().prepare("DELETE FROM architecture_watches WHERE id=?").run(id).changes) throw new Error("Architecture watch not found");
}

module.exports = { listArchitectures, listWatches, getWatch, addWatch, removeWatch, request, credentialFor };
