"use strict";

// Diagnose why a configured CloudAgent business ID is not found by the
// gateway's resolveAgentInternalId() (src/cloudagent.js).
//
// Usage:
//   API_KEY=pt_xxx \
//   BASE_URL=https://www.codebuddy.cn/v2/agentos \
//   AGENT_ID=agent_01M0VS0957S075EMCWYQPF9T0J \
//   node scripts/diagnose-agent-visibility.js

const { CloudAgentClient } = require("@tencent-ai/cloud-agent-sdk");

const apiKey = process.env.API_KEY?.trim();
const baseUrl = process.env.BASE_URL?.trim() || "https://www.codebuddy.cn/v2/agentos";
const agentId = process.env.AGENT_ID?.trim() || "agent_01M0VS0957S075EMCWYQPF9T0J";

if (!apiKey) {
  console.error("API_KEY env var is required");
  process.exit(1);
}

const client = new CloudAgentClient({ apiKey, baseUrl, logLevel: "warn" });

async function main() {
  // 1. Direct lookup by business ID (gateway does not use this path).
  try {
    const agent = await client.agents.get(agentId);
    console.log("[get] FOUND via GET /agents/:id:", JSON.stringify({
      id: agent.id,
      agentId: agent.agentInfo?.agentId,
      agentName: agent.agentInfo?.agentName,
      enabled: agent.agentInfo?.enabled,
    }, null, 2));
  } catch (error) {
    console.log(`[get] GET /agents/${agentId} failed:`, error?.httpStatus || "", error?.message);
  }

  // 2. Walk the full list the same way the gateway does, but never stop
  //    early on `total`, so we can spot pagination/total anomalies.
  console.log("\n[list] agents visible to this API key:");
  const pageSize = 100;
  let page = 1;
  let all = [];
  let gatewayStopsAfterPage1 = null;
  while (page <= 20) {
    const result = await client.agents.list({ page, pageSize });
    const items = Array.isArray(result?.items) ? result.items : [];
    console.log(
      `  page ${page}: server total=${result?.total} pageSize=${result?.pageSize} returned=${items.length}`,
    );
    if (page === 1) {
      // Simulate the gateway's loop-exit condition from src/cloudagent.js.
      gatewayStopsAfterPage1 = items.length === 0 || page * pageSize >= Number(result?.total || 0);
    }
    all = all.concat(items);
    if (items.length === 0) break;
    page += 1;
  }

  for (const item of all) {
    const mark = String(item.agentId || "").trim() === agentId ? "  <-- CONFIGURED" : "";
    console.log(
      `  - agentId=${item.agentId} internalId=${item.id} enabled=${item.enabled} name=${JSON.stringify(item.agentName)}${mark}`,
    );
  }
  console.log(`\n[list] total rows returned across all pages: ${all.length}`);

  // 3. Verdict.
  const matched = all.find((item) =>
    String(item?.agentId || "").trim() === agentId ||
    String(item?.id || "").trim() === agentId,
  );
  console.log("\n=== verdict ===");
  if (matched) {
    if (matched.enabled === false) {
      console.log(`Agent ${agentId} IS in the list but ENABLED=false -> gateway reports it as "disabled" (different error).`);
    } else {
      console.log(`Agent ${agentId} IS visible and enabled -> gateway should work; unexpected.`);
    }
  } else {
    if (gatewayStopsAfterPage1 && all.length > 100) {
      console.log(`Agent ${agentId} is NOT in the list, and the gateway would stop after page 1 while more rows exist -> pagination/total anomaly.`);
    } else {
      console.log(`Agent ${agentId} is NOT in the agent list for this API key.`);
      console.log("Most likely causes: the API key was rotated/re-scoped, or the Agent was deleted / moved to another owner, team, or workspace in the console that this key cannot see.");
    }
  }
}

main().catch((error) => {
  console.error("diagnose_failed:", error?.httpStatus || "", error?.message);
  process.exit(1);
});
