"use strict";

const crypto = require("node:crypto");
const http = require("node:http");
const { URL } = require("node:url");
const { HTML } = require("./src/admin-page");
const alertPoller = require("./src/alert-poller");
const alertStore = require("./src/alert-store");
const alertWorker = require("./src/alert-worker");
const { BotManager } = require("./src/bot-manager");
const { CloudAgentAdapter } = require("./src/cloudagent");
const { closeDatabase, db } = require("./src/database");
const registry = require("./src/registry");
const notifier = require("./src/notifier");
const scheduler = require("./src/scheduler");
const store = require("./src/store");
const { serverConfig } = require("./src/config");
const { safeError } = require("./src/utils");

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
  response.end(typeof body === "string" ? body : JSON.stringify(body));
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
    apiKeys: registry.listKeys(),
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
      if (url.pathname === "/admin" || url.pathname.startsWith("/api/admin/")) {
        if (!authenticated(request, config)) {
          send(response, 401, { error: "Authentication required" }, "application/json; charset=utf-8", {
            "WWW-Authenticate": 'Basic realm="CloudAgent Gateway", charset="UTF-8"',
          });
          return;
        }
      }
      if (url.pathname === "/admin" && request.method === "GET") {
        send(response, 200, HTML, "text/html; charset=utf-8", {
          "Content-Security-Policy": "default-src 'self'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; connect-src 'self'",
        });
        return;
      }
      if (url.pathname === "/api/admin/state" && request.method === "GET") {
        send(response, 200, publicState(botManager));
        return;
      }

      const keyMatch = url.pathname.match(/^\/api\/admin\/keys(?:\/([^/]+))?(?:\/(agents))?$/);
      if (keyMatch) {
        const [, id, action] = keyMatch;
        if (request.method === "POST" && action === "agents" && id) {
          const key = registry.getKey(id, { secrets: true });
          if (!key) throw new Error("API Key configuration not found");
          let remoteAgents;
          try {
            const adapter = new CloudAgentAdapter({
              apiKey: key.apiKey,
              baseUrl: key.baseUrl,
              controlTimeoutMs: 30000,
            });
            remoteAgents = await adapter.listVisibleAgents();
          } catch (error) {
            throw new Error(`Invalid API key or AgentOS unreachable: ${safeError(error)}`);
          }
          const items = remoteAgents
            .filter((agent) => agent.agentId)
            .map((agent) => {
              const existing = registry.findAgentByBusinessId(agent.agentId);
              return { ...agent, existingConfigId: existing?.id || null };
            });
          send(response, 200, { items });
          return;
        }
        if (request.method === "POST" && !id) {
          const saved = registry.saveKey(await readJson(request, config.bodyLimitBytes));
          send(response, 201, saved);
          return;
        }
        if (request.method === "PUT" && id && !action) {
          registry.saveKey(await readJson(request, config.bodyLimitBytes), id);
          botManager.sync();
          send(response, 200, registry.getKey(id));
          return;
        }
        if (request.method === "DELETE" && id && !action) {
          registry.deleteKey(id);
          send(response, 200, { ok: true });
          return;
        }
      }

      const agentMatch = url.pathname.match(/^\/api\/admin\/agents(?:\/([^/]+))?(?:\/(test))?$/);
      if (agentMatch) {
        const [, id, action] = agentMatch;
        if (request.method === "POST" && action === "test" && id) {
          const agent = registry.getAgent(id, { secrets: true });
          if (!agent) throw new Error("CloudAgent configuration not found");
          const internalAgentId = await new CloudAgentAdapter({ ...agent, agentName: agent.name }).resolveAgentInternalId();
          send(response, 200, { ok: true, internalAgentId });
          return;
        }
        if (request.method === "POST" && !id) {
          const saved = registry.saveAgent(await readJson(request, config.bodyLimitBytes));
          send(response, 201, saved);
          return;
        }
        if (request.method === "PUT" && id && !action) {
          const saved = registry.saveAgent(await readJson(request, config.bodyLimitBytes), id);
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
      const status = /not found/i.test(safeError(error)) ? 404 : /required|invalid|must|too long|still paired|still used|not bound|unavailable|UNIQUE constraint/i.test(safeError(error)) ? 400 : 500;
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
  if (interruptedAlerts) console.warn("interrupted_alert_jobs_recovered", { count: interruptedAlerts });
  const { botManager, server } = createServer({ config });
  botManager.sync();
  alertPoller.start();
  alertWorker.schedule();
  server.listen(config.port, config.host, () => {
    console.log(`gateway_listening http://${config.host}:${config.port}/admin`);
  });

  const cleanupTimer = setInterval(() => {
    store.cleanup();
    alertStore.cleanupJobs();
  }, 60 * 60 * 1000);
  const shutdown = async (signal) => {
    console.log("gateway_stopping", { signal });
    clearInterval(cleanupTimer);
    alertPoller.stop();
    botManager.stop();
    server.close();
    await Promise.race([
      Promise.allSettled([scheduler.drain(), alertWorker.drain()]),
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
