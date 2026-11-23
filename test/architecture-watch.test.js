"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { Readable } = require("node:stream");
process.env.ADMIN_PASSWORD = "test-password";
process.env.SQLITE_PATH = ":memory:";
const { db, closeDatabase } = require("../src/database");
const registry = require("../src/registry");
const watches = require("../src/architecture-watch");
const { createServer } = require("../server");

test.beforeEach(() => db().exec("DELETE FROM architecture_watches; DELETE FROM tencent_credentials;"));
test.after(closeDatabase);
function fixture(t, handler) {
  const credential = registry.saveTencentCredential({ name: "生产凭证", secretId: "AKID_ARCH_TEST", secretKey: "architecture-private-secret" });
  const calls = [];
  t.mock.method(globalThis, "fetch", async (url, options) => {
    assert.equal(url, "https://advisor.tencentcloudapi.com");
    assert.equal(options.method, "POST");
    assert.equal(options.headers.Host, "advisor.tencentcloudapi.com");
    assert.equal(options.headers["X-TC-Version"], "2020-07-21");
    assert.equal(options.headers["X-TC-Region"], undefined);
    assert.match(options.headers.Authorization, /^TC3-HMAC-SHA256 Credential=AKID_ARCH_TEST\/\d{4}-\d{2}-\d{2}\/advisor\/tc3_request/);
    const action = options.headers["X-TC-Action"], params = JSON.parse(options.body);
    calls.push({ action, params });
    const arch = { ArchId: params.ArchId || "arch-production", ArchName: "生产架构", Description: "核心业务", VersionName: "1.0.0", Detail: "private diagram data" };
    return Response.json({ Response: handler ? await handler(action, params) : action === "DescribeArchList"
      ? { ArchList: [arch], TotalCount: 41, RequestId: "test" } : { Arch: arch, RequestId: "test" } });
  });
  return { credential, calls };
}
function adminRequest(server, method, url, body, authenticated = true) {
  return new Promise(resolve => {
    const req = Readable.from(body === undefined ? [] : [Buffer.from(JSON.stringify(body))]);
    Object.assign(req, { method, url, headers: { host: "gateway.test", ...(authenticated ? { authorization: `Basic ${Buffer.from("admin:test-password").toString("base64")}` } : {}) } });
    let status;
    server.emit("request", req, { writeHead(value) { status = value; }, end(value) { resolve({ status, body: JSON.parse(value) }); } });
  });
}
function server() {
  return createServer({ config: { adminUsername: "admin", adminPassword: "test-password", bodyLimitBytes: 1024 * 1024 }, botManager: { statuses: () => ({}) } }).server;
}

test("unfiltered credential-signed list preserves cloud pagination and returns only safe metadata", async t => {
  const { credential, calls } = fixture(t);
  const result = await watches.listArchitectures(credential.id, { pageNumber: "2", pageSize: "20", search: "   " });
  assert.deepEqual(calls, [{ action: "DescribeArchList", params: { PageNumber: 2, PageSize: 20 } }]);
  assert.equal(result.totalCount, 41);
  assert.equal(result.items[0].archId, "arch-production");
  assert.doesNotMatch(JSON.stringify(result), /AKID_ARCH_TEST|architecture-private-secret|private diagram data|Detail/);
});

test("keyword search includes later cloud pages and paginates only the matches", async t => {
  const cloudItems = Array.from({ length: 205 }, (_, i) => ({ ArchId: `arch-${i}`, ArchName: `上海业务 ${i}` }));
  cloudItems[0].ArchName = "广州CVM核心";
  cloudItems[104].ArchName = "业务-广州-数据库";
  cloudItems[204].ArchName = "广州异地容灾";
  const { credential, calls } = fixture(t, (_action, params) => ({
    ArchList: cloudItems.slice((params.PageNumber - 1) * params.PageSize, params.PageNumber * params.PageSize),
    TotalCount: cloudItems.length,
  }));
  const result = await watches.listArchitectures(credential.id, { search: " 广州 ", pageNumber: 2, pageSize: 1 });
  assert.equal(result.totalCount, 3);
  assert.equal(result.pageNumber, 2);
  assert.deepEqual(result.items.map(a => a.archId), ["arch-104"]);
  assert.deepEqual(calls.map(c => c.params), [1, 2, 3].map(PageNumber => ({ PageNumber, PageSize: 100 })));
});

test("keyword search is case insensitive and returns zero for no matches in nonempty accounts", async t => {
  const { credential } = fixture(t, () => ({ ArchList: [{ ArchId: "arch-core", ArchName: "广州CVM核心" }], TotalCount: 1 }));
  assert.equal((await watches.listArchitectures(credential.id, { search: "cvm" })).totalCount, 1);
  const empty = await watches.listArchitectures(credential.id, { search: "深圳" });
  assert.deepEqual(empty.items, []);
  assert.equal(empty.totalCount, 0);
});

test("failure on a later search page never returns incomplete matches", async t => {
  const { credential } = fixture(t, (_action, params) => params.PageNumber === 1
    ? { ArchList: [{ ArchId: "arch-core", ArchName: "广州核心" }], TotalCount: 101 }
    : { Error: { Code: "UnauthorizedOperation", Message: "second page failed" } });
  await assert.rejects(watches.listArchitectures(credential.id, { search: "广州" }), /second page failed/);
});

test("invalid credentials, pagination and IDs fail before cloud access", async t => {
  const { credential, calls } = fixture(t);
  for (const input of [{ pageNumber: 0 }, { pageNumber: 1.5 }, { pageSize: 101 }, { search: "x".repeat(101) }]) {
    await assert.rejects(watches.listArchitectures(credential.id, input), /Invalid/);
  }
  await assert.rejects(watches.listArchitectures("missing"), /not found/);
  await assert.rejects(watches.addWatch({ credentialId: credential.id, archId: "../oops" }), /Invalid/);
  assert.equal(calls.length, 0);
});

test("Advisor omits TotalCount for no matches; admin API returns a normal empty result", async t => {
  const { credential } = fixture(t, () => ({ ArchList: [], RequestId: "no-matches" }));
  const result = await adminRequest(server(), "GET", `/api/admin/tencent-credentials/${credential.id}/architectures?search=no-matches`);
  assert.equal(result.status, 200);
  assert.deepEqual(result.body, { items: [], totalCount: 0, pageNumber: 1, pageSize: 20 });
});

test("missing totals are still rejected for nonempty lists", async t => {
  const { credential } = fixture(t, () => ({ ArchList: [{ ArchId: "arch-production", ArchName: "Production" }] }));
  await assert.rejects(watches.listArchitectures(credential.id), /Invalid Advisor/);
});

test("adding verifies access and stores server metadata, blocks duplicate addition and referenced credential deletion", async t => {
  const { credential, calls } = fixture(t);
  const saved = await watches.addWatch({ credentialId: credential.id, archId: "arch-production", archName: "forged client name" });
  assert.deepEqual(calls[0], { action: "DescribeArch", params: { ArchId: "arch-production", Username: "cloudq-gateway" } });
  assert.equal(saved.archName, "生产架构");
  assert.equal(saved.credentialName, "生产凭证");
  assert.equal(watches.listWatches().length, 1);
  assert.doesNotMatch(JSON.stringify(watches.listWatches()), /AKID_ARCH_TEST|architecture-private-secret|private diagram data/);
  await assert.rejects(watches.addWatch({ credentialId: credential.id, archId: saved.archId }), e => e.httpStatus === 409);
  assert.equal(calls.length, 1);
  assert.throws(() => registry.deleteTencentCredential(credential.id), /still used/);
  registry.saveTencentCredential({ name: "更名后凭证", secretKey: "rotated" }, credential.id);
  assert.equal(watches.listWatches()[0].credentialName, "更名后凭证");
  watches.removeWatch(saved.id);
  assert.equal(watches.listWatches().length, 0);
  registry.deleteTencentCredential(credential.id);
  assert.throws(() => watches.removeWatch(saved.id), /not found/);
});

test("access failures are redacted and never create records", async t => {
  const { credential } = fixture(t, () => ({ Error: { Code: "UnauthorizedOperation", Message: 'AKID_ARCH_TEST architecture-private-secret' } }));
  await assert.rejects(watches.addWatch({ credentialId: credential.id, archId: "arch-forbidden" }), error => {
    assert.equal(error.httpStatus, 400);
    assert.match(error.message, /UnauthorizedOperation/);
    assert.doesNotMatch(error.message, /AKID_ARCH_TEST|architecture-private-secret/);
    return true;
  });
  assert.equal(watches.listWatches().length, 0);
});

test("mismatched cloud IDs and malformed responses are rejected", async t => {
  const { credential } = fixture(t, action => action === "DescribeArchList" ? {} : { Arch: { ArchId: "arch-other", ArchName: "Other" } });
  await assert.rejects(watches.listArchitectures(credential.id), /Invalid Advisor/);
  await assert.rejects(watches.addWatch({ credentialId: credential.id, archId: "arch-production" }), /Invalid Advisor/);
  assert.equal(watches.listWatches().length, 0);
});

test("credentials rotated while verification is in flight cannot save an old selection", async t => {
  let credential;
  ({ credential } = fixture(t, () => {
    registry.saveTencentCredential({ name: "Rotated", secretKey: "changed" }, credential.id);
    return { Arch: { ArchId: "arch-production", ArchName: "Production" } };
  }));
  await assert.rejects(watches.addWatch({ credentialId: credential.id, archId: "arch-production" }), /凭证已变更/);
  assert.equal(watches.listWatches().length, 0);
});

test("concurrent additions deduplicate atomically", async t => {
  const { credential } = fixture(t);
  const results = await Promise.allSettled([1, 2].map(() => watches.addWatch({ credentialId: credential.id, archId: "arch-production" })));
  assert.equal(results.filter(r => r.status === "fulfilled").length, 1);
  assert.equal(results.find(r => r.status === "rejected").reason.httpStatus, 409);
  assert.equal(watches.listWatches().length, 1);
});

test("admin API requires authentication and completes discovery, add, state and removal", async t => {
  const { credential } = fixture(t), app = server();
  const listUrl = `/api/admin/tencent-credentials/${credential.id}/architectures?pageNumber=2&search=${encodeURIComponent("生产")}`;
  assert.equal((await adminRequest(app, "GET", listUrl, undefined, false)).status, 401);
  const list = await adminRequest(app, "GET", listUrl);
  assert.equal(list.status, 200); assert.equal(list.body.pageNumber, 2);
  const added = await adminRequest(app, "POST", "/api/admin/architecture-watches", { credentialId: credential.id, archId: "arch-production" });
  assert.equal(added.status, 201);
  assert.equal((await adminRequest(app, "POST", "/api/admin/architecture-watches", { credentialId: credential.id, archId: "arch-production" })).status, 409);
  const state = await adminRequest(app, "GET", "/api/admin/state");
  assert.equal(state.body.architectureWatches[0].id, added.body.id);
  assert.doesNotMatch(JSON.stringify(state.body), /AKID_ARCH_TEST|architecture-private-secret/);
  assert.equal((await adminRequest(app, "DELETE", `/api/admin/tencent-credentials/${credential.id}`)).status, 400);
  assert.equal((await adminRequest(app, "DELETE", `/api/admin/architecture-watches/${added.body.id}`)).status, 200);
  assert.equal((await adminRequest(app, "GET", "/api/admin/architecture-watches")).body.items.length, 0);
  assert.equal((await adminRequest(app, "DELETE", `/api/admin/architecture-watches/${added.body.id}`)).status, 404);
});
