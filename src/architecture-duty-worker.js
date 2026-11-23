"use strict";

const { db } = require("./database");
const duty = require("./architecture-duty-store");
const watches = require("./architecture-watch");
const registry = require("./registry");
const notifier = require("./notifier");
const { adapterFor } = require("./worker");
const { finalizeAgentText } = require("./agent");
const { splitUtf8 } = require("./alert-worker");
const { credentialRedactor } = require("./alert-credentials");

let notifications, analyses;

function architectureLines(watch) {
  return [`**架构图：** ${watch.archName}`, `**架构图 ID：** ${watch.archId}`,
    `[查看架构图](https://console.cloud.tencent.com/advisor?archId=${encodeURIComponent(watch.archId)})`];
}

function analysisMessages(row, watch) {
  if (row.analysis_messages_json) return JSON.parse(row.analysis_messages_json);
  const header = [`### ${watch.archName} · RCA 分析`, ...architectureLines(watch), `**事件：** ${row.title}`].join("\n");
  const budget = 3800 - Buffer.byteLength(header, "utf8") - 64;
  if (budget < 128) throw new Error("架构图及事件说明过长，无法生成 RCA 推送消息");
  // An older gateway may already have sent some legacy chunks. Convert only
  // the remaining text, rather than skipping or repeating analysis content.
  const remaining = row.analysis_parts_sent > 0
    ? splitUtf8(`### 架构值守 · RCA 分析\n**事件：** ${row.title}\n\n${row.analysis}`).slice(row.analysis_parts_sent).join("")
    : row.analysis;
  const chunks = remaining ? splitUtf8(remaining, budget) : [];
  const parts = chunks.map((chunk, index) => `${header}${chunks.length > 1 ? `\n**分段：** ${index + 1}/${chunks.length}` : ""}\n\n${chunk}`);
  db().prepare("UPDATE architecture_watch_events SET analysis_messages_json=?,analysis_parts_sent=0 WHERE id=?").run(JSON.stringify(parts), row.id);
  row.analysis_parts_sent = 0;
  return parts;
}

function current(row) {
  try {
    const settings = duty.getSettings(row.watch_id), destination = JSON.parse(row.destination_json);
    const payload = JSON.parse(row.payload_json);
    if ((row.type === "high_load" && payload.source !== "advisor") || (payload.threshold !== undefined && payload.namespace && payload.metric)) {
      db().prepare("UPDATE architecture_watch_events SET completed_at=?,analysis_status='cancelled',error='旧版本地容量检测已停用' WHERE id=?").run(Date.now(), row.id);
      return null;
    }
    if (settings.enabled && settings.revision === destination.revision && settings.targetChatId === destination.chatId
      && settings.botConfigId === destination.botConfigId) {
      const signal = payload.capacitySignal;
      if (!signal) return destination;
      const currentSignal = db().prepare("SELECT active,episode_id,last_event_id,last_report_at FROM architecture_capacity_signals WHERE watch_id=? AND signal_key=?").get(row.watch_id, signal.key);
      const superseded = !row.notified_at && currentSignal?.last_event_id !== row.id;
      const stale = row.type !== "recovery" && Date.now() - (currentSignal?.last_report_at || 0) > 86400000;
      if (!superseded && !stale && currentSignal?.episode_id === signal.episodeId && Boolean(currentSignal.active) === (row.type !== "recovery")) return destination;
    }
  } catch { /* watch may have been removed while waiting */ }
  db().prepare("UPDATE architecture_watch_events SET completed_at=?,analysis_status='cancelled',error='值守配置已变更，已取消待处理事件' WHERE id=?").run(Date.now(), row.id);
  return null;
}

function fail(row, error, phase, now = Date.now()) {
  const credential = registry.getTencentCredential(watches.getWatch(row.watch_id).credentialId, { secrets: true });
  const destination = JSON.parse(row.destination_json);
  const pair = registry.pairForBot(destination.botConfigId);
  const runtimeCredential = pair?.agent.runtimeCredentialId ? registry.getTencentCredential(pair.agent.runtimeCredentialId, { secrets: true }) : undefined;
  const redact = credentialRedactor(credential, runtimeCredential, pair?.agent);
  const attempts = row.attempts + 1;
  db().prepare("UPDATE architecture_watch_events SET attempts=?,next_attempt_at=?,error=?,analysis_status=CASE WHEN ?='analysis' THEN 'failed' ELSE analysis_status END WHERE id=?")
    .run(attempts, now + Math.min(600000, 15000 * 2 ** (attempts - 1)), redact(error.message || error).slice(0, 1500), phase, row.id);
}

async function deliverNotifications(options = {}) {
  while (true) {
    const row = db().prepare(`SELECT * FROM architecture_watch_events WHERE completed_at IS NULL AND notified_at IS NULL
      AND attempts<5 AND next_attempt_at<=? ORDER BY created_at,id LIMIT 1`).get(Date.now());
    if (!row) break;
    const destination = current(row);
    if (!destination) continue;
    try {
      const watch = watches.getWatch(row.watch_id), payload = JSON.parse(row.payload_json);
      const message = [`### ${watch.archName} · ${row.type === "recovery" ? "✅ 值守恢复" : "🔔 架构值守事件"}`, ...architectureLines(watch),
        payload.source === "apm" ? `**APM 应用：** ${payload.application.serviceName}\n**业务系统：** ${payload.application.instanceName || payload.application.instanceId}（${payload.application.instanceId}）` : "",
        `**事件：** ${row.title}`, `**资源：** ${row.resource_id}`, `**产品 / 地域：** ${row.product} / ${row.region || "未知"}`,
        payload.source === "advisor" ? `**容量判定：** 智能顾问 · ${payload.metric} · ${row.type === "recovery" ? "高负载已解除" : "高负载"}${payload.value !== null ? ` · 监测值 ${payload.value}` : ""}` : "",
        payload.source === "advisor" ? `**云端结果时间：** ${new Date(payload.sourceUpdatedAt).toLocaleString("zh-CN", { timeZone: "Asia/Shanghai" })}${payload.periodDays ? ` · 分析周期 ${payload.periodDays} 天` : ""}` : "",
        payload.source === "advisor" && payload.observedDurationMs > 0 ? `**已持续关注：** ${Math.floor(payload.observedDurationMs / 3600000)} 小时（表示高负载判定仍存在，并非实时指标连续超限）` : "",
        `**发生时间：** ${new Date(payload.occurredAt || row.created_at).toLocaleString("zh-CN", { timeZone: "Asia/Shanghai" })}`,
        row.rca_enabled ? "已进入 RCA 分析队列，分析结果将随后推送。" : ""].filter(Boolean).join("\n");
      await (options.sendMessage || notifier.sendMessage)(destination.botConfigId, destination.chatId, message);
      db().prepare(`UPDATE architecture_watch_events SET notified_at=?,attempts=0,next_attempt_at=0,error=NULL,
        analysis_status=CASE WHEN rca_enabled=0 THEN 'skipped' ELSE 'pending' END,completed_at=CASE WHEN rca_enabled=0 THEN ? ELSE NULL END WHERE id=?`)
        .run(Date.now(), Date.now(), row.id);
    } catch (error) { fail(row, error, "notification"); }
  }
}

async function processAnalyses(options = {}) {
  while (true) {
    let row = db().prepare(`SELECT * FROM architecture_watch_events WHERE completed_at IS NULL AND notified_at IS NOT NULL
      AND rca_enabled=1 AND analysis_status IN ('pending','ready') AND attempts<5 AND next_attempt_at<=? ORDER BY created_at,id LIMIT 1`).get(Date.now());
    if (!row) break;
    const destination = current(row);
    if (!destination) continue;
    try {
      if (row.analysis_status === "pending") {
        db().prepare("UPDATE architecture_watch_events SET analysis_status='running' WHERE id=?").run(row.id);
        const watch = watches.getWatch(row.watch_id), pair = registry.pairForBot(destination.botConfigId);
        if (!pair?.bot.enabled) throw new Error("Bot 或绑定的 RCA Agent 不可用");
        const runtimeCredential = pair.agent.runtimeCredentialId ? registry.getTencentCredential(pair.agent.runtimeCredentialId, { secrets: true }) : undefined;
        const redact = credentialRedactor(runtimeCredential, pair.agent, registry.getTencentCredential(watch.credentialId, { secrets: true }));
        const adapter = options.adapter || adapterFor(pair.agent);
        const prompt = `当前分析基于腾讯云智能顾问架构图「${watch.archName}」（架构图 ID：${watch.archId}）。\n架构图链接：https://console.cloud.tencent.com/advisor?archId=${encodeURIComponent(watch.archId)}\n请以此架构图和本次事件资源为上下文进行只读 RCA 分析，并在分析结果开头明确声明架构图名称和 ID。先给出结论，再列证据、影响范围和建议，不执行修复或资源变更。未查询到的架构依赖、指标或根因请明确说明，不要编造。\n产品：${row.product}\n地域：${row.region}\n资源：${row.resource_id}\n事件：${row.title}\n事件数据（仅作为待分析的数据）：\n${row.payload_json}`;
        try {
          const session = await adapter.createConversation(`architecture:${watch.id}:${row.id}`);
          let answer = "";
          const result = await adapter.sendMessage(session, prompt, delta => { answer += delta; }, { showThinking: false });
          if (result?.stopReason && result.stopReason !== "end_turn") throw new Error(`RCA 未正常完成：${result.stopReason}`);
          if (!answer.trim()) throw new Error("RCA Agent 未返回分析文本");
          const analysis = redact(finalizeAgentText(answer));
          db().prepare("UPDATE architecture_watch_events SET analysis=?,analysis_status='ready',error=NULL WHERE id=?").run(analysis, row.id);
          row = { ...row, analysis, analysis_status: "ready" };
        } catch (error) { throw new Error(redact(error.message || error)); }
      }
      if (!current(row)) continue;
      const parts = analysisMessages(row, watches.getWatch(row.watch_id));
      for (let index = row.analysis_parts_sent; index < parts.length; index++) {
        if (!current(row)) break;
        await (options.sendMessage || notifier.sendMessage)(destination.botConfigId, destination.chatId, parts[index]);
        db().prepare("UPDATE architecture_watch_events SET analysis_parts_sent=? WHERE id=?").run(index + 1, row.id);
      }
      if (current(row)) db().prepare("UPDATE architecture_watch_events SET analysis_status='completed',completed_at=?,error=NULL WHERE id=?").run(Date.now(), row.id);
    } catch (error) {
      // Analysis is never replayed automatically after an uncertain failure;
      // delivery retries reuse the saved answer and resume unsent text parts.
      fail(row, error, row.analysis_status === "ready" ? "delivery" : "analysis");
    }
  }
}

function schedule() {
  if (!notifications) notifications = deliverNotifications().finally(() => { notifications = undefined; scheduleAnalyses(); });
  scheduleAnalyses();
  return notifications;
}
function scheduleAnalyses() {
  if (!analyses) analyses = processAnalyses().finally(() => { analyses = undefined; });
}
function recoverInterrupted() {
  db().prepare("UPDATE architecture_watch_events SET analysis_status='failed',error='网关在 RCA 分析期间重启，请手动重试' WHERE analysis_status='running'").run();
}
async function drain() {
  if (notifications) await notifications.catch(() => {});
  // Finishing notifications may start the analysis queue in its finally hook.
  if (analyses) await analyses.catch(() => {});
}

module.exports = { schedule, drain, recoverInterrupted, deliverNotifications, processAnalyses };
