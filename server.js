"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const http = require("node:http");
const path = require("node:path");
const { URL } = require("node:url");
const alertPoller = require("./src/alert-poller");
const { listAlarmPolicies } = require("./src/alert-config");
const alertStore = require("./src/alert-store");
const architectureWatch = require("./src/architecture-watch");
const architectureDetail = require("./src/architecture-detail");
const architectureCapacity = require("./src/architecture-capacity");
const architectureNode = require("./src/architecture-node");
const architectureDutyStore = require("./src/architecture-duty-store");
const architectureDuty = require("./src/architecture-duty");
const architectureDutyWorker = require("./src/architecture-duty-worker");
const apm = require("./src/apm");
const { credentialRedactor } = require("./src/alert-credentials");
const alertWorker = require("./src/alert-worker");
const { promptReference } = require("./src/alert-prompt");
const { BotManager } = require("./src/bot-manager");
const { AgentAdapter } = require("./src/agent");
const { saveAgentConfiguration, listAgentVersions, createCredentialVersion } = require("./src/agent-config");
const { TencentMonitorClient } = require("./src/monitor-client");
const { closeDatabase, db } = require("./src/database");
const registry = require("./src/registry");
const notifier = require("./src/notifier");
const scheduler = require("./src/scheduler");
const store = require("./src/store");
const { serverConfig } = require("./src/config");
const wecomPairing = require("./src/wecom-pairing");
const { safeError } = require("./src/utils");

const WEB_DIST = path.join(__dirname, "web", "dist");
const WEB_MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".woff2": "font/woff2",
  ".json": "application/json; charset=utf-8",
  ".ico": "image/x-icon",
};
const ADMIN_CSP = "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'self'; img-src 'self' data:; font-src 'self'";

function serveAdmin(response, pathname) {
  if (!fs.existsSync(path.join(WEB_DIST, "index.html"))) {
    send(response, 503, { error: "Admin console not built. Run: npm --prefix web run build" });
    return;
  }
  let rel = decodeURIComponent(pathname.slice("/admin".length));
  if (!rel || rel === "/") rel = "/index.html";
  let file = path.normalize(path.join(WEB_DIST, rel));
  if (!file.startsWith(WEB_DIST + path.sep)) {
    send(response, 403, { error: "Forbidden" });
    return;
  }
  const hashedAsset = rel.startsWith("/assets/");
  if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    if (hashedAsset) {
      send(response, 404, { error: "Not found" });
      return;
    }
    file = path.join(WEB_DIST, "index.html");
  }
  const headers = { "Content-Security-Policy": ADMIN_CSP };
  if (rel === "/diagram-frame.html" && file === path.join(WEB_DIST, "diagram-frame.html")) {
    // Isolate the cloud SVG and its styles from the authenticated admin page.
    headers["Content-Security-Policy"] = "default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src data:; font-src data:; connect-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'self'; sandbox allow-scripts";
    headers["X-Frame-Options"] = "SAMEORIGIN";
  }
  if (hashedAsset) headers["Cache-Control"] = "max-age=31536000, immutable";
  send(response, 200, fs.readFileSync(file), WEB_MIME[path.extname(file)] || "application/octet-stream", headers);
}

function secureEqual(actual, expected) {
  const left = Buffer.from(String(actual));
  const right = Buffer.from(String(expected));
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}

function authenticated(request, config) {
  const header = String(request.headers.authorization || "");
  if (!header.startsWith("Basic ")) return false;
  let decoded;
  try { decoded = Buffer.from(header.slice(6), "base64").toString("utf8"); } catch { return false; }
  const separator = decoded.indexOf(":");
  if (separator < 0) return false;
  return secureEqual(decoded.slice(0, separator), config.adminUsername) &&
    secureEqual(decoded.slice(separator + 1), config.adminPassword);
}

function send(response, status, body, contentType = "application/json; charset=utf-8", headers = {}) {
  response.writeHead(status, {
    "Content-Type": contentType,
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
    "Referrer-Policy": "no-referrer",
    ...headers,
  });
  response.end(typeof body === "string" || Buffer.isBuffer(body) ? body : JSON.stringify(body));
}

async function readJson(request, limit) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > limit) throw new Error("Request body is too large");
    chunks.push(chunk);
  }
  const raw = Buffer.concat(chunks).toString("utf8");
  return raw ? JSON.parse(raw) : {};
}

function publicState(botManager) {
  return {
    bots: registry.listBots(),
    agents: registry.listAgents(),
    wmaCredentials: registry.listWmaCredentials(),
    tencentCredentials: registry.listTencentCredentials(),
    architectureWatches: architectureWatch.listWatches(),
    connections: botManager.statuses(),
    alertIntegrations: alertStore.listIntegrations(),
    alertJobs: alertStore.listJobs(50),
  };
}

function createServer(options = {}) {
  const config = options.config || serverConfig();
  const botManager = options.botManager || new BotManager();
  const server = http.createServer(async (request, response) => {
    const url = new URL(request.url, `http://${request.headers.host || "localhost"}`);
    try {
      if (url.pathname === "/healthz") {
        db().prepare("SELECT 1").get();
        send(response, 200, { status: "ok", connections: botManager.statuses() });
        return;
      }
      if (url.pathname === "/") {
        response.writeHead(302, { Location: "/admin" });
        response.end();
        return;
      }
      if (url.pathname === "/admin" || url.pathname.startsWith("/admin/") || url.pathname.startsWith("/api/admin/")) {
        if (!authenticated(request, config)) {
          send(response, 401, { error: "Authentication required" }, "application/json; charset=utf-8", {
            "WWW-Authenticate": 'Basic realm="WMA Gateway", charset="UTF-8"',
          });
          return;
        }
      }
      if ((url.pathname === "/admin" || url.pathname.startsWith("/admin/")) && request.method === "GET") {
        serveAdmin(response, url.pathname);
        return;
      }
      if (url.pathname === "/api/admin/state" && request.method === "GET") {
        send(response, 200, publicState(botManager));
        return;
      }

      if (url.pathname === "/api/admin/alert-prompt" && request.method === "GET") {
        send(response, 200, promptReference());
        return;
      }

      const keyMatch = url.pathname.match(/^\/api\/admin\/wma-credentials(?:\/([^/]+))?(?:\/(agents|versions|credential-versions))?$/);
      if (keyMatch) {
        const [, id, action] = keyMatch;
        if (request.method === "POST" && ["versions", "credential-versions"].includes(action) && id) {
          const input = { ...await readJson(request, config.bodyLimitBytes), credentialConfigId: id };
          if (action === "versions") send(response, 200, { items: await listAgentVersions(input) });
          else send(response, 201, await createCredentialVersion(input));
          return;
        }
        if (request.method === "POST" && action === "agents" && id) {
          const key = registry.getWmaCredential(id, { secrets: true });
          if (!key) throw new Error("WMA credential configuration not found");
          let remoteAgents;
          try {
            const adapter = new AgentAdapter({
              ...key,
              controlTimeoutMs: 30000,
            });
            remoteAgents = await adapter.listVisibleAgents();
          } catch (error) {
            throw new Error(`Invalid WMA credential or service unreachable: ${safeError(error)}`);
          }
          const items = remoteAgents
            .filter((agent) => agent.agentId)
            .map((agent) => {
              const existing = registry.findAgentByBusinessId(agent.agentId, key.id);
              return { ...agent, existingConfigId: existing?.id || null };
            });
          send(response, 200, { items });
          return;
        }
        if (request.method === "POST" && !id) {
          const saved = registry.saveWmaCredential(await readJson(request, config.bodyLimitBytes));
          send(response, 201, saved);
          return;
        }
        if (request.method === "PUT" && id && !action) {
          registry.saveWmaCredential(await readJson(request, config.bodyLimitBytes), id);
          botManager.sync();
          send(response, 200, registry.getWmaCredential(id));
          return;
        }
        if (request.method === "DELETE" && id && !action) {
          registry.deleteWmaCredential(id);
          send(response, 200, { ok: true });
          return;
        }
      }

      if (url.pathname === "/api/admin/architecture-watches") {
        if (request.method === "GET") {
          send(response, 200, { items: architectureWatch.listWatches() });
          return;
        }
        if (request.method === "POST") {
          send(response, 201, await architectureWatch.addWatch(await readJson(request, config.bodyLimitBytes)));
          return;
        }
      }
      const watchMatch = url.pathname.match(/^\/api\/admin\/architecture-watches\/([^/]+)(?:\/(settings|enabled|history|check|unbind|test-push|diagram|capacity|apm-instances|apm-applications|apm-policies|nodes\/[^/]+|events\/[^/]+\/retry))?$/);
      if (watchMatch) {
        const [, id, action] = watchMatch;
        if ((request.method === "GET" && ["apm-instances", "apm-applications"].includes(action)) || (request.method === "POST" && action === "apm-policies")) {
          const credential = architectureWatch.credentialFor(architectureWatch.getWatch(id).credentialId);
          try {
            if (action === "apm-instances") send(response, 200, { items: await apm.listInstances(credential) });
            else if (action === "apm-applications") send(response, 200, { items: await apm.listApplications(credential, url.searchParams.get("region"), url.searchParams.get("instanceId")) });
            else {
              const input = await readJson(request, config.bodyLimitBytes);
              send(response, 200, await apm.discoverPolicies(credential, input.applications));
            }
          } catch (error) { throw new Error(`Invalid APM 查询：${credentialRedactor(credential)(error.message)}`); }
          return;
        }
        if (request.method === "GET" && action?.startsWith("nodes/")) {
          send(response, 200, await architectureNode.getNode(id, decodeURIComponent(action.slice(6)))); return;
        }
        if (request.method === "PUT" && action === "enabled") {
          const input = await readJson(request, config.bodyLimitBytes);
          send(response, 200, architectureDutyStore.setEnabled(id, input.enabled, input.enabled === true ? await architectureDetail.getDetail(id) : null)); return;
        }
        if (request.method === "GET" && action === "diagram") {
          send(response, 200, await architectureDetail.getOriginalDiagram(id, url.searchParams.get("view") ?? "3d")); return;
        }
        if (request.method === "GET" && action === "capacity") {
          send(response, 200, await architectureCapacity.getCapacity(id)); return;
        }
        if (request.method === "GET" && !action) {
          send(response, 200, { ...await architectureDetail.getDetail(id), settings: architectureDutyStore.getSettings(id) });
          return;
        }
        if (request.method === "GET" && action === "settings") {
          send(response, 200, architectureDutyStore.getSettings(id)); return;
        }
        if (request.method === "PUT" && action === "settings") {
          const input = await readJson(request, config.bodyLimitBytes);
          // Resolve new selections with the watch's credential, never trust
          // browser-supplied application names, regions or business systems.
          if (input.apmApplications !== undefined) {
            const selected = apm.normalizeApplications(input.apmApplications);
            const existing = new Map(architectureDutyStore.getSettings(id).apmApplications.map(app => [apm.applicationKey(app), app]));
            const credential = architectureWatch.credentialFor(architectureWatch.getWatch(id).credentialId), groups = new Map();
            try {
              for (const app of selected) {
                if (existing.has(apm.applicationKey(app))) continue;
                const key = JSON.stringify([app.region, app.instanceId]);
                if (!groups.has(key)) groups.set(key, await apm.listApplications(credential, app.region, app.instanceId));
                const found = groups.get(key).find(item => apm.applicationKey(item) === apm.applicationKey(app));
                if (!found) throw new Error(`所选 APM 应用已不可用：${app.serviceName}，请刷新应用列表`);
                existing.set(apm.applicationKey(found), found);
              }
              input.apmApplications = selected.map(app => existing.get(apm.applicationKey(app)));
            } catch (error) { throw new Error(`Invalid ${credentialRedactor(credential)(error.message)}`); }
          }
          const detail = await architectureDetail.getDetail(id);
          // Only the dedicated overview switch controls enabled. Read after the
          // cloud lookup so concurrent form saves cannot restore a stale state.
          send(response, 200, architectureDutyStore.saveSettings(id, { ...input, enabled: architectureDutyStore.getSettings(id).enabled }, detail)); return;
        }
        if (request.method === "GET" && action === "history") {
          send(response, 200, architectureDutyStore.history(id, url.searchParams.get("page") || 1)); return;
        }
        if (request.method === "POST" && action === "check") {
          send(response, 200, await architectureDuty.checkNow(id)); return;
        }
        if (request.method === "POST" && action === "unbind") {
          send(response, 200, architectureDutyStore.unbind(id)); return;
        }
        if (request.method === "POST" && action === "test-push") {
          const settings = architectureDutyStore.getSettings(id), watch = architectureWatch.getWatch(id);
          if (!settings.botConfigId || !settings.targetChatId) throw new Error("Target WeCom group is not bound");
          await notifier.sendMessage(settings.botConfigId, settings.targetChatId, `✅ 架构值守测试消息\n架构图：${watch.archName}\n架构图 ID：${watch.archId}\n后续事件及 RCA 结果将推送到当前群。\n[查看架构图](https://console.cloud.tencent.com/advisor?archId=${encodeURIComponent(watch.archId)})`);
          send(response, 200, { ok: true }); return;
        }
        if (request.method === "POST" && action?.startsWith("events/")) {
          architectureDutyStore.retryEvent(id, action.split("/")[1]); architectureDutyWorker.schedule();
          send(response, 200, { ok: true }); return;
        }
        if (request.method === "DELETE" && !action) {
          architectureWatch.removeWatch(id); send(response, 200, { ok: true }); return;
        }
      }

      const tencentMatch = url.pathname.match(/^\/api\/admin\/tencent-credentials(?:\/([^/]+))?(?:\/(test|alarm-policies|architectures))?$/);
      if (tencentMatch) {
        const [, id, action] = tencentMatch;
        if (request.method === "GET" && action === "architectures" && id) {
          send(response, 200, await architectureWatch.listArchitectures(id, {
            pageNumber: url.searchParams.get("pageNumber") ?? 1,
            pageSize: url.searchParams.get("pageSize") ?? 20,
            search: url.searchParams.get("search") ?? "",
          }));
          return;
        }
        if (request.method === "GET" && action === "alarm-policies" && id) {
          const credential = registry.getTencentCredential(id, { secrets: true });
          if (!credential) throw new Error("Tencent Cloud credential not found");
          let items;
          try {
            items = await listAlarmPolicies(credential, url.searchParams.get("region"), {
              monitorType: url.searchParams.get("monitorType") || undefined,
            });
          } catch (error) {
            if (/Region is required|Invalid Tencent Cloud region|Invalid monitor type/.test(safeError(error))) throw error;
            const service = url.searchParams.get("monitorType") === "MT_CLS" ? "CLS" : "Monitor";
            throw new Error(`Invalid Tencent Cloud access: 请检查腾讯云凭证、${service} 告警读取权限和网络连接：${safeError(error)}`);
          }
          send(response, 200, { items });
          return;
        }
        if (request.method === "POST" && action === "test" && id) {
          const credential = registry.getTencentCredential(id, { secrets: true });
          if (!credential) throw new Error("Tencent Cloud credential not found");
          try {
            await new TencentMonitorClient(credential)
              .describeAlarmHistories({ Module: "monitor", PageNumber: 1, PageSize: 1 });
          } catch (error) {
            throw new Error(`Invalid Tencent Cloud AK/SK or Monitor API unreachable: ${safeError(error)}`);
          }
          send(response, 200, { ok: true });
          return;
        }
        if (request.method === "POST" && !id) {
          const saved = registry.saveTencentCredential(await readJson(request, config.bodyLimitBytes));
          send(response, 201, saved);
          return;
        }
        if (request.method === "PUT" && id && !action) {
          send(response, 200, registry.saveTencentCredential(await readJson(request, config.bodyLimitBytes), id));
          return;
        }
        if (request.method === "DELETE" && id && !action) {
          registry.deleteTencentCredential(id);
          send(response, 200, { ok: true });
          return;
        }
      }

      const agentMatch = url.pathname.match(/^\/api\/admin\/agents(?:\/([^/]+))?(?:\/(test|reset-sessions))?$/);
      if (agentMatch) {
        const [, id, action] = agentMatch;
        if (request.method === "POST" && action === "test" && id) {
          const agent = registry.getAgent(id, { secrets: true });
          if (!agent) throw new Error("WMA Agent configuration not found");
          const agentId = await new AgentAdapter({ ...agent, agentName: agent.name }).resolveAgentId();
          send(response, 200, { ok: true, agentId });
          return;
        }
        if (request.method === "POST" && action === "reset-sessions" && id) {
          send(response, 200, registry.resetAgentSessions(id));
          return;
        }
        if (request.method === "POST" && !id) {
          const input = await readJson(request, config.bodyLimitBytes);
          const saved = await saveAgentConfiguration(input);
          send(response, 201, saved);
          return;
        }
        if (request.method === "PUT" && id && !action) {
          const input = await readJson(request, config.bodyLimitBytes);
          const saved = await saveAgentConfiguration(input, id);
          botManager.sync();
          send(response, 200, saved);
          return;
        }
        if (request.method === "DELETE" && id && !action) {
          registry.deleteAgent(id);
          send(response, 200, { ok: true });
          return;
        }
      }

      const botMatch = url.pathname.match(/^\/api\/admin\/bots(?:\/([^/]+))?$/);
      if (botMatch) {
        const id = botMatch[1];
        if (request.method === "POST" && !id) {
          const saved = registry.saveBot(await readJson(request, config.bodyLimitBytes));
          botManager.sync();
          send(response, 201, saved);
          return;
        }
        if (request.method === "PUT" && id) {
          const saved = registry.saveBot(await readJson(request, config.bodyLimitBytes), id);
          botManager.sync();
          send(response, 200, saved);
          return;
        }
        if (request.method === "DELETE" && id) {
          registry.deleteBot(id);
          botManager.sync();
          send(response, 200, { ok: true });
          return;
        }
      }

      const pairingMatch = url.pathname.match(/^\/api\/admin\/wecom-pairing(?:\/([^/]+))?(?:\/(complete))?$/);
      if (pairingMatch) {
        const [, id, action] = pairingMatch;
        if (request.method === "POST" && !id) {
          send(response, 201, await wecomPairing.createSession());
          return;
        }
        if (request.method === "GET" && id && !action) {
          send(response, 200, await wecomPairing.getSessionStatus(id));
          return;
        }
        if (request.method === "POST" && id && action === "complete") {
          const input = await readJson(request, config.bodyLimitBytes);
          const credentials = wecomPairing.completeSession(id);
          const saved = registry.saveBot({
            name: input.name || credentials.botName || "扫码创建的机器人",
            botId: credentials.botId,
            secret: credentials.secret,
            cloudAgentId: input.cloudAgentId,
            groupSessionScope: input.groupSessionScope,
            welcomeText: input.welcomeText,
            placeholder: input.placeholder,
            showThinking: input.showThinking,
          });
          botManager.sync();
          send(response, 201, saved);
          return;
        }
      }

      const alertMatch = url.pathname.match(/^\/api\/admin\/alerts(?:\/([^/]+))?(?:\/(poll|test-push|unbind|pause|resume))?$/);
      if (alertMatch) {
        const [, id, action] = alertMatch;
        if (request.method === "POST" && !id) {
          const saved = alertStore.saveIntegration(await readJson(request, config.bodyLimitBytes));
          send(response, 201, saved);
          return;
        }
        if (request.method === "PUT" && id && !action) {
          const saved = alertStore.saveIntegration(await readJson(request, config.bodyLimitBytes), id);
          send(response, 200, saved);
          return;
        }
        if (request.method === "DELETE" && id && !action) {
          alertStore.deleteIntegration(id);
          send(response, 200, { ok: true });
          return;
        }
        if (request.method === "POST" && id && action === "poll") {
          const result = await alertPoller.pollNow(id);
          send(response, 200, { ok: true, ...result });
          return;
        }
        if (request.method === "POST" && id && action === "test-push") {
          const integration = alertStore.getIntegration(id);
          if (!integration) throw new Error("Alert integration not found");
          if (!integration.targetChatId) throw new Error("Target WeCom group is not bound");
          await notifier.sendMessage(integration.botConfigId, integration.targetChatId,
            `✅ **${integration.name}**\n\n告警主动推送测试成功。`);
          send(response, 200, { ok: true });
          return;
        }
        if (request.method === "POST" && id && action === "unbind") {
          send(response, 200, alertStore.unbindChat(id));
          return;
        }
        if (request.method === "POST" && id && ["pause", "resume"].includes(action)) {
          send(response, 200, alertStore.setIntegrationEnabled(id, action === "resume"));
          return;
        }
      }

      const alertJobMatch = url.pathname.match(/^\/api\/admin\/alert-jobs\/([^/]+)\/retry$/);
      if (alertJobMatch && request.method === "POST") {
        const job = alertStore.retryJob(alertJobMatch[1]);
        alertWorker.schedule();
        send(response, 200, job);
        return;
      }

      send(response, 404, { error: "Not found" });
    } catch (error) {
      console.error("http_request_failed", { method: request.method, path: url.pathname, message: safeError(error) });
      const upstreamStatus = Number(error?.httpStatus);
      const status = [400, 401, 403, 404, 409, 410, 429, 502, 503, 504].includes(upstreamStatus) ? upstreamStatus
        : /not found/i.test(safeError(error)) ? 404 : /required|invalid|must|too long|still paired|still used|not bound|unavailable|expired|UNIQUE constraint/i.test(safeError(error)) ? 400 : 500;
      send(response, status, { error: status === 500 ? "Internal server error" : safeError(error) });
    }
  });
  return { botManager, server };
}

async function main() {
  const config = serverConfig();
  db();
  const interrupted = store.markInterruptedTasks();
  if (interrupted) console.warn("interrupted_tasks_marked_failed", { count: interrupted });
  store.cleanup();
  alertStore.cleanupJobs();
  const interruptedAlerts = alertStore.markInterruptedJobs();
  architectureDutyWorker.recoverInterrupted();
  if (interruptedAlerts) console.warn("interrupted_alert_jobs_recovered", { count: interruptedAlerts });
  const { botManager, server } = createServer({ config });
  botManager.sync();
  alertPoller.start();
  architectureDuty.start();
  alertWorker.schedule();
  server.listen(config.port, config.host, () => {
    console.log(`gateway_listening http://${config.host}:${config.port}/admin`);
  });

  const cleanupTimer = setInterval(() => {
    store.cleanup();
    alertStore.cleanupJobs();
    const cutoff = Date.now() - 30 * 86400000;
    db().prepare("DELETE FROM architecture_watch_checks WHERE created_at<?").run(cutoff);
    db().prepare("DELETE FROM architecture_watch_events WHERE completed_at IS NOT NULL AND created_at<?").run(cutoff);
  }, 60 * 60 * 1000);
  const shutdown = async (signal) => {
    console.log("gateway_stopping", { signal });
    clearInterval(cleanupTimer);
    alertPoller.stop();
    architectureDuty.stop();
    botManager.stop();
    server.close();
    await Promise.race([
      Promise.allSettled([scheduler.drain(), alertWorker.drain(), architectureDuty.drain(), architectureDutyWorker.drain()]),
      new Promise((resolve) => setTimeout(resolve, 20000)),
    ]);
    closeDatabase();
    process.exit(0);
  };
  process.once("SIGINT", () => shutdown("SIGINT"));
  process.once("SIGTERM", () => shutdown("SIGTERM"));
}

if (require.main === module) main().catch((error) => {
  console.error("gateway_start_failed", { message: safeError(error) });
  process.exit(1);
});

module.exports = { authenticated, createServer, readJson, secureEqual };
