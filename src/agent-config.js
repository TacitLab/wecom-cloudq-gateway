"use strict";

const registry = require("./registry");
const { WmaClient } = require("./wma");

const saves = new Set();
const AUTH_START = "【网关运行时云认证】";
const AUTH_END = "【网关运行时云认证结束】";
const AUTH_INSTRUCTION = [
  AUTH_START,
  "CloudQ、TencentCloudInfra 等腾讯云技能优先使用 Runtime 中预配置的 TENCENTCLOUD_SECRET_ID、TENCENTCLOUD_SECRET_KEY、TENCENTCLOUD_REGION。",
  "执行前由工具进程读取环境并检查认证；配置有效时直接执行，无需向用户索取 AK/SK 或浏览器授权。",
  "环境变量由工具进程内部读取和使用，不要把值返回给模型、拼接到命令行参数或写入回复、日志、报告和持久化文件；不要执行 env、printenv、set -x。",
  "不要假设独立 shell 的 export 会影响后续工具调用。技能无法读取变量、认证失效或权限不足时报告具体问题并提示管理员处理，不要循环要求用户授权。",
  AUTH_END,
].join("\n");

function runtimeManifest(source, credential, region) {
  let manifest;
  try { manifest = JSON.parse(source); } catch { throw new Error("Invalid WMA source Manifest JSON"); }
  if (!manifest || typeof manifest !== "object" || Array.isArray(manifest)) throw new Error("Invalid WMA source Manifest");
  if (manifest.envs !== undefined && !Array.isArray(manifest.envs)) throw new Error("Invalid WMA Manifest envs");
  if (manifest.secrets !== undefined && !Array.isArray(manifest.secrets)) throw new Error("Invalid WMA Manifest secrets");
  const environment = {
    TENCENTCLOUD_SECRET_ID: credential.secretId,
    TENCENTCLOUD_SECRET_KEY: credential.secretKey,
    TENCENTCLOUD_REGION: region,
  };
  // A static AK/SK must not be combined with a stale session token or shadowed
  // by the same keys from the source version's secrets collection.
  const replaced = new Set([...Object.keys(environment), "TENCENTCLOUD_TOKEN", "TENCENTCLOUD_SESSION_TOKEN"]);
  manifest.envs = [
    ...(manifest.envs || []).filter((entry) => !replaced.has(entry.key)),
    ...Object.entries(environment).map(([key, value]) => ({ key, value })),
  ];
  if (manifest.secrets) manifest.secrets = manifest.secrets.filter((entry) => !replaced.has(entry.key));
  if (manifest.system_prompt_file && !manifest.system_prompt && !manifest.prompt) {
    throw new Error("WMA Agent uses system_prompt_file; configure a text system prompt before creating a credential version");
  }
  const promptKey = typeof manifest.system_prompt === "string" ? "system_prompt"
    : typeof manifest.prompt === "string" ? "prompt" : "system_prompt";
  const prompt = String(manifest[promptKey] || "").replace(/【网关运行时云认证】[\s\S]*?【网关运行时云认证结束】/g, "").trimEnd();
  manifest[promptKey] = [prompt, AUTH_INSTRUCTION].filter(Boolean).join("\n\n");
  return JSON.stringify(manifest);
}

function requiredId(value, label) {
  if (typeof value !== "string" || !/^[a-zA-Z0-9_-]+$/.test(value)) throw new Error(`Invalid ${label}: a string ID is required`);
  return value;
}

function selectionClient(input) {
  requiredId(input.agentId, "WMA Agent ID");
  const key = registry.getWmaCredential(input.credentialConfigId, { secrets: true });
  if (!key) throw new Error("WMA credential configuration is required");
  return new WmaClient({ ...key, agentId: input.agentId, controlTimeoutMs: 60000 });
}

async function withSaveLock(input, id, callback) {
  const locks = [`remote:${input.credentialConfigId}:${input.agentId}`, ...(id ? [`local:${id}`] : [])];
  if (locks.some(lock => saves.has(lock))) throw Object.assign(new Error("Agent configuration is already being saved; wait before retrying"), { httpStatus: 409 });
  locks.forEach(lock => saves.add(lock));
  try { return await callback(); }
  finally { locks.forEach(lock => saves.delete(lock)); }
}

function publicVersion(input, version) {
  const versionId = requiredId(version.versionId, "WMA Version ID");
  // Project a strict allowlist: WMA detail/write responses can contain Manifest.
  return {
    versionId, versionName: String(version.versionName || versionId),
    versionType: String(version.versionType || ""), status: String(version.status || ""),
    model: String(version.model || ""), createdTime: version.createdTime || null,
    ...registry.getCredentialVersion(input.credentialConfigId, input.agentId, versionId),
  };
}

async function describeVersion(client, agentId, versionId) {
  const version = await client.request("DescribeAgentVersion", { AgentId: agentId, VersionId: versionId });
  if (version.agentId !== agentId || version.versionId !== versionId) throw new Error("Invalid WMA version: Agent or version ID mismatch");
  if (version.status !== "ENABLED") throw new Error("Selected WMA version is unavailable; refresh and select an enabled version");
  return version;
}

async function listAgentVersions(input) {
  const client = selectionClient(input);
  const items = [];
  for (let offset = 0; ; offset += 100) {
    const response = await client.request("DescribeAgentVersionList", { AgentId: input.agentId, Offset: offset, Limit: 100 });
    if (!Array.isArray(response.agentVersionSet) || !Number.isSafeInteger(response.totalCount) || response.totalCount < 0) throw new Error("Invalid WMA version list response");
    items.push(...response.agentVersionSet.map(version => publicVersion(input, version)));
    if (!response.agentVersionSet.length || offset + 100 >= response.totalCount) break;
  }
  return items;
}

async function createCredentialVersion(input) {
  const client = selectionClient(input);
  const sourceVersionId = requiredId(input.sourceVersionId, "source Version ID");
  const credential = registry.getTencentCredential(input.runtimeCredentialId, { secrets: true });
  if (!credential) throw new Error("Selected runtime Tencent Cloud credential not found");
  const region = String(input.runtimeRegion || "").trim();
  if (!/^[a-z]+-[a-z]+(?:-\d+)?$/.test(region)) throw new Error("Invalid runtime Tencent Cloud region");
  return withSaveLock(input, undefined, async () => {
    const source = await describeVersion(client, input.agentId, sourceVersionId);
    const manifest = runtimeManifest(source.manifest, credential, region);
    // Creation has no activation side effects. Never retry a non-idempotent write.
    const version = await client.request("CreateAgentVersionFromSource", {
      AgentId: input.agentId, SourceVersionId: sourceVersionId, IsTest: false,
      Description: "Gateway runtime cloud credential configuration", Manifest: manifest,
    });
    requiredId(version.versionId, "created WMA Version ID");
    try {
      registry.saveCredentialVersion(input.credentialConfigId, input.agentId, version, source, credential, region);
    } catch {
      throw Object.assign(new Error(`WMA version ${version.versionId} was created but metadata could not be saved; refresh versions before retrying`), { httpStatus: 409 });
    }
    return publicVersion(input, { ...version, status: version.status || "ENABLED", versionType: version.versionType || "PROD" });
  });
}

async function saveAgentConfiguration(input, id) {
  const record = registry.validateAgentInput(input, id);
  const { existing } = record;
  const sameIdentity = existing?.agentId === record.agentId && existing?.credentialConfigId === record.credentialConfigId;
  const versionId = input.wmaVersionId === undefined ? (sameIdentity ? existing.wmaVersionId : null) : input.wmaVersionId || null;
  if (versionId) requiredId(versionId, "WMA Version ID");
  if (input.recreateRuntimeVersion || (input.runtimeCredentialId && input.wmaVersionId === undefined && input.runtimeCredentialId !== (sameIdentity ? existing.runtimeCredentialId : null))) {
    throw new Error("Invalid version workflow: create a credential version first, then select its version ID and save");
  }
  const client = selectionClient(record);
  return withSaveLock(record, id, async () => {
    await client.resolveAgentId();
    let runtimeVersion = null;
    if (versionId) {
      const version = await describeVersion(client, record.agentId, versionId);
      const metadata = registry.getCredentialVersion(record.credentialConfigId, record.agentId, versionId);
      runtimeVersion = {
        wmaVersionId: versionId, wmaVersionName: String(version.versionName || versionId),
        runtimeCredentialId: metadata && registry.getTencentCredential(metadata.runtimeCredentialId) ? metadata.runtimeCredentialId : null,
        runtimeRegion: metadata?.runtimeRegion || null, runtimeCredentialUpdatedAt: metadata?.runtimeCredentialUpdatedAt || null,
      };
    }
    return registry.saveAgent(input, id, { runtimeVersion });
  });
}

module.exports = { AUTH_INSTRUCTION, runtimeManifest, listAgentVersions, createCredentialVersion, saveAgentConfiguration };
