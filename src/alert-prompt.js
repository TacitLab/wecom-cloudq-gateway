"use strict";

const { SOURCE_NAMES } = require("./alert-config");

// The editor and worker share this template so the displayed default is executable.
const DEFAULT_PROMPT_TEMPLATE = [
  "请对以下腾讯云可观测告警执行根因分析。使用企业智能体已配置并发布的诊断技能查询真实数据；不要编造未查询到的指标或根因。",
  "",
  "请按以下结构输出：",
  "### 告警概述",
  "### 根因分析",
  "### 影响范围",
  "### 处置建议",
  "### 数据与权限异常（没有则省略）",
  "",
  "【告警数据】",
  "告警来源：{{source_name}}",
  "告警 ID：{{alarm_id}}",
  "状态：{{alarm_status}}",
  "对象：{{alarm_object}}",
  "地域：{{region}}",
  "策略：{{policy_name}} ({{policy_id}})",
  "类型：{{monitor_type}}/{{namespace}}",
  "级别：{{alarm_level}}",
  "首次发生：{{first_occur_time}}",
  "最后发生：{{last_occur_time}}",
  "内容：{{alarm_content}}",
  "维度：{{dimensions}}",
  "指标：{{metrics_json}}",
  "完整告警上下文：{{raw_json}}",
].join("\n");

const VARIABLES = [
  { key: "alarm_json", label: "完整告警 JSON（统一字段及原始数据）" },
  { key: "alarm_id", label: "告警事件 ID" },
  { key: "alarm_object", label: "告警对象" },
  { key: "alarm_content", label: "告警内容或触发条件" },
  { key: "policy_name", label: "策略名称" },
  { key: "region", label: "地域，如 ap-guangzhou" },
  { key: "source_name", label: "告警来源名称" },
  { key: "alarm_status", label: "状态，如 ALARM、OK" },
  { key: "policy_id", label: "告警策略 ID" },
  { key: "monitor_type", label: "来源标识，如 MT_TAW" },
  { key: "namespace", label: "策略类型；CLS 为空" },
  { key: "alarm_level", label: "告警级别，保留来源原值" },
  { key: "first_occur_time", label: "首次发生时间（秒级时间戳）" },
  { key: "last_occur_time", label: "最后发生时间（秒级时间戳）" },
  { key: "dimensions", label: "对象维度（字符串或 JSON）" },
  { key: "metrics_json", label: "指标 JSON 数组，缺失时为 []" },
  { key: "raw_json", label: "原始告警 JSON（CLS 为 RawData）" },
];

const SOURCE_NOTES = {
  MT_QCE: "云产品监控：对象通常为云资源实例；维度和指标以历史接口实际返回为准。完整数据可通过 {{alarm_json}} 查看。",
  MT_TAW: "APM：对象可能包含业务系统、应用或接口信息；具体维度以历史接口实际返回为准，未返回的应用 ID、Trace ID 不会自动补全。",
  MT_CLS: "CLS：{{alarm_id}} 对应 RecordId（事件 ID），{{policy_id}} 对应 AlarmId（策略 ID）；对象为日志主题，内容为 Trigger。{{raw_json}} 包含 TopicId、TopicName、Trigger 等原始字段。",
};

function scalar(value) {
  if (value == null) return "";
  return typeof value === "object" ? JSON.stringify(value) : String(value);
}

function promptValues(history) {
  return {
    alarm_json: JSON.stringify(history, null, 2),
    alarm_id: scalar(history.AlarmId),
    alarm_object: scalar(history.AlarmObject),
    alarm_content: scalar(history.Content),
    policy_name: scalar(history.PolicyName),
    region: scalar(history.Region),
    source_name: SOURCE_NAMES[history.MonitorType] || history.MonitorType || "腾讯云监控",
    alarm_status: scalar(history.AlarmStatus),
    policy_id: scalar(history.PolicyId),
    monitor_type: scalar(history.MonitorType),
    namespace: scalar(history.Namespace),
    alarm_level: scalar(history.AlarmLevel),
    first_occur_time: scalar(history.FirstOccurTime),
    last_occur_time: scalar(history.LastOccurTime),
    dimensions: scalar(history.Dimensions || history.InternalDimensions),
    metrics_json: JSON.stringify(Array.isArray(history.MetricsInfo) ? history.MetricsInfo : []),
    raw_json: JSON.stringify(history.RawData || history),
  };
}

function renderPrompt(integration, history) {
  const template = integration.promptTemplate?.trim() ? integration.promptTemplate : DEFAULT_PROMPT_TEMPLATE;
  const values = promptValues(history);
  return template.replace(/\{\{([a-z_]+)\}\}/gi, (match, key) =>
    Object.hasOwn(values, key.toLowerCase()) ? values[key.toLowerCase()] : match);
}

function defaultPrompt(history) {
  return renderPrompt({}, history);
}

function promptReference() {
  return { defaultTemplate: DEFAULT_PROMPT_TEMPLATE, variables: VARIABLES, sourceNotes: SOURCE_NOTES };
}

module.exports = { defaultPrompt, promptReference, renderPrompt };
