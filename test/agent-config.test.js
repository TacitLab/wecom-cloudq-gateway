"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { Readable } = require("node:stream");
process.env.ADMIN_PASSWORD = "test-password";
process.env.SQLITE_PATH = ":memory:";
const { db, closeDatabase } = require("../src/database");
const registry = require("../src/registry");
const { saveAgentConfiguration, createCredentialVersion, listAgentVersions, runtimeManifest } = require("../src/agent-config");
const { WmaClient } = require("../src/wma");
const { createServer } = require("../server");
test.beforeEach(() => db().exec("DELETE FROM wma_tasks; DELETE FROM wma_conversations; DELETE FROM alert_integrations; DELETE FROM wecom_bots; DELETE FROM wma_agents; DELETE FROM wma_credentials; DELETE FROM tencent_credentials;"));
test.after(closeDatabase);
function fixture(t, { failCreate = false, onCreate } = {}) {
  const access = registry.saveWmaCredential({ name: "WMA", secretId: "AKID_CONTROL", secretKey: "control-only-secret" });
  const runtime = registry.saveTencentCredential({ name: "Cloud account", secretId: "AKID_RUNTIME", secretKey: 'runtime-"quoted"-$value-secret' });
  const calls = [];
  const source = { version: "2.0", id: "agent1", system_prompt: "最新 SRE 系统提示词", skills: [{ id: "cloudq" }], settingsJson: { model: "test-model" },
    envs: [{ key: "KEEP", value: "keep" }, { key: "TENCENTCLOUD_SECRET_ID", value: "old" }, { key: "TENCENTCLOUD_TOKEN", value: "expired" }],
    secrets: [{ key: "PLATFORM_AUTH", value: "keep-platform-auth" }, { key: "TENCENTCLOUD_SECRET_KEY", value: "shadowed" }] };
  const version = (id, name, prompt, status = "ENABLED", agent = "agent1") => ({ AgentId: agent, VersionId: id, VersionName: name, VersionType: "PROD", Status: status, Manifest: JSON.stringify({ ...source, system_prompt: prompt }) });
  const versions = new Map([
    ["source-version", version("source-version", "default", "旧提示词")],
    ["updated-source", version("updated-source", "prod-new", source.system_prompt)],
    ["disabled-version", version("disabled-version", "old", "old", "DISABLED")],
    ["foreign-version", version("foreign-version", "foreign", "foreign", "ENABLED", "other-agent")],
  ]);
  t.mock.method(globalThis, "fetch", async (url, options) => {
    assert.equal(url, "https://workbuddyenterprise.tencentcloudapi.com");
    assert.match(options.headers.Authorization, /^TC3-HMAC-SHA256 Credential=AKID_CONTROL\//);
    const action = options.headers["X-TC-Action"], params = JSON.parse(options.body);
    calls.push({ action, params });
    const reply = value => Response.json({ Response: { ...value, RequestId: "request-test" } });
    if (action === "DescribeAgent") return reply({ AgentId: params.AgentId, PublicApiEnabled: true, RoutingSet: [{ VersionId: "source-version", Weight: 1 }] });
    if (action === "DescribeAgentVersion") return reply(versions.get(params.VersionId) || { Error: { Code: "ResourceNotFound.Version" } });
    if (action === "DescribeAgentVersionList") {
      const items = [...versions.values()].filter(v => v.AgentId === params.AgentId);
      return reply({ AgentVersionSet: items.slice(params.Offset, params.Offset + params.Limit), TotalCount: items.length });
    }
    if (action === "CreateAgentVersionFromSource") {
      if (onCreate) await onCreate();
      if (failCreate) return reply({ Error: { Code: "UnauthorizedOperation", Message: params.Manifest } });
      const id = `212043872897556889${versions.size}`;
      const created = { ...version(id, `prod-${versions.size}`, ""), Manifest: params.Manifest };
      versions.set(id, created);
      return reply(created);
    }
    if (action === "CreateAgentSession") return reply({ SessionId: "session-pinned" });
    assert.fail(`Unexpected action ${action}`);
  });
  const input = { name: "SRE", agentId: "agent1", credentialConfigId: access.id };
  return { access, runtime, calls, source, versions, input, creation: { ...input, sourceVersionId: "updated-source", runtimeCredentialId: runtime.id, runtimeRegion: "ap-shanghai" } };
}
test("creation copies the explicit source prompt and skills without activating the result", async t => {
  const f = fixture(t), original = await saveAgentConfiguration({ ...f.input, wmaVersionId: "source-version" });
  const created = await createCredentialVersion(f.creation);
  const call = f.calls.find(c => c.action === "CreateAgentVersionFromSource");
  assert.equal(call.params.SourceVersionId, "updated-source"); assert.equal(call.params.IsTest, false);
  const m = JSON.parse(call.params.Manifest);
  assert.deepEqual(m.skills, f.source.skills); assert.deepEqual(m.settingsJson, f.source.settingsJson);
  assert.deepEqual(m.secrets, [{ key: "PLATFORM_AUTH", value: "keep-platform-auth" }]);
  assert.deepEqual(Object.fromEntries(m.envs.map(e => [e.key, e.value])), { KEEP: "keep", TENCENTCLOUD_SECRET_ID: "AKID_RUNTIME", TENCENTCLOUD_SECRET_KEY: 'runtime-"quoted"-$value-secret', TENCENTCLOUD_REGION: "ap-shanghai" });
  assert.match(m.system_prompt, /^最新 SRE 系统提示词/);
  assert.equal(created.sourceVersionId, "updated-source"); assert.equal(created.injected, true);
  assert.equal(registry.getAgent(original.id).wmaVersionId, "source-version");
  assert.equal(registry.getAgent(original.id).revision, original.revision);
  assert.ok(f.calls.every(c => c.action !== "ModifyAgentRouting" && c.action !== "CreateAgentSession"));
  assert.doesNotMatch(JSON.stringify(created), /AKID_RUNTIME|quoted|Manifest|control-only-secret/);
  assert.doesNotMatch(JSON.stringify(db().prepare("SELECT * FROM wma_credential_versions").all()), /AKID_RUNTIME|quoted/);
});
test("explicitly selecting and saving an injected version pins sessions, and unchanged saves never create versions", async t => {
  const f = fixture(t), created = await createCredentialVersion(f.creation);
  assert.equal(registry.listAgents().length, 0);
  const saved = await saveAgentConfiguration({ ...f.input, wmaVersionId: created.versionId });
  assert.equal(saved.runtimeCredentialId, f.runtime.id); assert.equal(saved.wmaVersionName, created.versionName);
  await new WmaClient(registry.getAgent(saved.id, { secrets: true })).createConversation();
  assert.deepEqual(f.calls.at(-1).params, { AgentId: "agent1", VersionId: created.versionId });
  assert.throws(() => registry.deleteTencentCredential(f.runtime.id), /still used.*Agent versions/);
  await saveAgentConfiguration({ ...f.input, wmaVersionId: created.versionId }, saved.id);
  assert.equal(f.calls.filter(c => c.action === "CreateAgentVersionFromSource").length, 1);
});
test("version discovery exposes provenance and status while stripping Manifest", async t => {
  const f = fixture(t), created = await createCredentialVersion(f.creation), versions = await listAgentVersions(f.input);
  const injected = versions.find(v => v.versionId === created.versionId);
  assert.equal(injected.runtimeCredentialId, f.runtime.id); assert.equal(injected.sourceVersionName, "prod-new");
  assert.equal(versions.find(v => v.versionId === "disabled-version").status, "DISABLED");
  assert.doesNotMatch(JSON.stringify(versions), /AKID_RUNTIME|quoted|Manifest|system_prompt|PLATFORM_AUTH/);
});
test("rotation marks old versions stale; only an explicit creation makes a fresh injection", async t => {
  const f = fixture(t), first = await createCredentialVersion(f.creation);
  const original = await saveAgentConfiguration({ ...f.input, wmaVersionId: first.versionId });
  registry.saveTencentCredential({ name: "Rotated", secretKey: "rotated-secret" }, f.runtime.id);
  assert.equal(registry.getAgent(original.id).runtimeCredentialOutdated, true);
  const saved = await saveAgentConfiguration({ ...f.input, wmaVersionId: first.versionId }, original.id);
  assert.equal(saved.wmaVersionId, first.versionId); assert.equal(saved.runtimeCredentialOutdated, true);
  assert.equal(f.calls.filter(c => c.action === "CreateAgentVersionFromSource").length, 1);
  const next = await createCredentialVersion({ ...f.creation, sourceVersionId: first.versionId });
  assert.equal(next.runtimeCredentialOutdated, false); assert.equal(registry.getAgent(original.id).wmaVersionId, first.versionId);
  assert.equal(JSON.parse(f.versions.get(next.versionId).Manifest).system_prompt.split("【网关运行时云认证】").length, 2);
});
test("selecting a normal version or routing clears runtime references and old session mappings", async t => {
  const f = fixture(t), created = await createCredentialVersion(f.creation), original = await saveAgentConfiguration({ ...f.input, wmaVersionId: created.versionId });
  db().prepare("INSERT INTO wma_conversations (conversation_key,bot_config_id,agent_config_id,agent_revision,session_id,created_at,updated_at) VALUES (?,?,?,?,?,?,?)").run("old", "bot", original.id, original.revision, "old-session", Date.now(), Date.now());
  const normal = await saveAgentConfiguration({ ...f.input, wmaVersionId: "updated-source" }, original.id);
  assert.equal(normal.wmaVersionId, "updated-source"); assert.equal(normal.runtimeCredentialId, null);
  assert.equal(db().prepare("SELECT COUNT(*) AS count FROM wma_conversations").get().count, 0);
  const routed = await saveAgentConfiguration({ ...f.input, wmaVersionId: null }, original.id);
  assert.equal(routed.wmaVersionId, null);
  await new WmaClient(registry.getAgent(original.id, { secrets: true })).createConversation();
  assert.deepEqual(f.calls.at(-1).params, { AgentId: "agent1" });
  registry.deleteTencentCredential(f.runtime.id);
  assert.equal(registry.getCredentialVersion(f.access.id, "agent1", created.versionId).runtimeCredentialOutdated, true);
});
test("invalid, unavailable and cross-Agent versions cannot be used as sources or selected", async t => {
  const f = fixture(t);
  await assert.rejects(createCredentialVersion({ ...f.creation, sourceVersionId: "" }), /required/);
  await assert.rejects(createCredentialVersion({ ...f.creation, runtimeCredentialId: "missing" }), /not found/);
  await assert.rejects(createCredentialVersion({ ...f.creation, runtimeRegion: "bad;region" }), /Invalid.*region/);
  assert.equal(f.calls.length, 0);
  for (const id of ["foreign-version", "disabled-version", "missing"]) {
    await assert.rejects(createCredentialVersion({ ...f.creation, sourceVersionId: id }));
    await assert.rejects(saveAgentConfiguration({ ...f.input, wmaVersionId: id }));
  }
  assert.ok(f.calls.every(c => c.action !== "CreateAgentVersionFromSource")); assert.equal(registry.listAgents().length, 0);
});
test("creation failures retain the active binding and never retry or expose echoed credentials", async t => {
  const f = fixture(t, { failCreate: true }), original = await saveAgentConfiguration({ ...f.input, wmaVersionId: "source-version" });
  await assert.rejects(createCredentialVersion(f.creation), e => { assert.match(e.message, /UnauthorizedOperation/); assert.doesNotMatch(e.message, /AKID_RUNTIME|quoted|system_prompt/); return true; });
  assert.equal(registry.getAgent(original.id).revision, original.revision);
  assert.equal(f.calls.filter(c => c.action === "CreateAgentVersionFromSource").length, 1);
});
test("concurrent creation is rejected; credentials rotated during creation are marked stale", async t => {
  let release, entered;
  const waiting = new Promise(r => { entered = r; }), gate = new Promise(r => { release = r; });
  const f = fixture(t, { onCreate: async () => { entered(); await gate; } });
  const creating = createCredentialVersion(f.creation); await waiting;
  await assert.rejects(createCredentialVersion(f.creation), e => e.httpStatus === 409);
  registry.saveTencentCredential({ name: "Rotated during creation", secretKey: "new-key" }, f.runtime.id); release();
  assert.equal((await creating).runtimeCredentialOutdated, true); assert.equal(registry.listAgents().length, 0);
});
test("admin endpoints separate version creation, discovery and explicit selection", async t => {
  const f = fixture(t);
  const { server } = createServer({ config: { adminUsername: "admin", adminPassword: "test-password", bodyLimitBytes: 1024 * 1024 }, botManager: { statuses: () => ({}), sync() {} } });
  function request(url, body) { return new Promise(resolve => {
    const req = Readable.from([Buffer.from(JSON.stringify(body))]);
    Object.assign(req, { method: "POST", url, headers: { host: "gateway.test", authorization: `Basic ${Buffer.from("admin:test-password").toString("base64")}` } });
    let status; server.emit("request", req, { writeHead(v) { status = v; }, end(v) { resolve({ status, body: JSON.parse(v) }); } });
  }); }
  const created = await request(`/api/admin/wma-credentials/${f.access.id}/credential-versions`, f.creation);
  assert.equal(created.status, 201); assert.equal(registry.listAgents().length, 0);
  const listed = await request(`/api/admin/wma-credentials/${f.access.id}/versions`, f.input); assert.equal(listed.status, 200);
  const saved = await request("/api/admin/agents", { ...f.input, wmaVersionId: created.body.versionId });
  assert.equal(saved.status, 201); assert.equal(saved.body.wmaVersionId, created.body.versionId);
  assert.doesNotMatch(JSON.stringify([created, listed, saved]), /AKID_RUNTIME|quoted|Manifest|TENCENTCLOUD_SECRET/);
});
test("Manifest handling preserves prompt aliases and rejects invalid source configuration", () => {
  const result = JSON.parse(runtimeManifest(JSON.stringify({ prompt: "original", version: "2.0" }), { secretId: "id", secretKey: "key" }, "ap-guangzhou"));
  assert.match(result.prompt, /^original/); assert.equal(result.system_prompt, undefined);
  assert.throws(() => runtimeManifest("[]", {}, "ap-guangzhou"), /Invalid/);
  assert.throws(() => runtimeManifest('{"envs":{}}', {}, "ap-guangzhou"), /Invalid/);
});
