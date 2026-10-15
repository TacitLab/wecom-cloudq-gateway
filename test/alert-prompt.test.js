"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { defaultPrompt, promptReference, renderPrompt } = require("../src/alert-prompt");
const { normalizeClsHistory } = require("../src/alert-config");

test("the displayed default template renders exactly like the worker default for every source", () => {
  const reference = promptReference();
  for (const monitorType of ["MT_QCE", "MT_TAW", "MT_CLS"]) {
    const history = { MonitorType: monitorType, AlarmId: "event-1", AlarmObject: "生产服务", Region: "ap-guangzhou",
      PolicyName: "错误率", PolicyId: "policy-1", Content: "error > 5", AlarmLevel: 0, FirstOccurTime: 1700000000 };
    assert.equal(renderPrompt({ promptTemplate: reference.defaultTemplate }, history), defaultPrompt(history));
    assert.doesNotMatch(defaultPrompt(history), /\{\{[a-z_]+\}\}|undefined|\[object Object\]/);
    assert.match(defaultPrompt(history), /级别：0/);
    assert.ok(reference.sourceNotes[monitorType]);
  }
  const supportedKeys = new Set(reference.variables.map((variable) => variable.key));
  for (const [, key] of reference.defaultTemplate.matchAll(/\{\{([a-z_]+)\}\}/g)) assert.ok(supportedKeys.has(key), key);
});

test("existing custom variables retain their values and unknown tokens are preserved", () => {
  const history = { AlarmId: "id", AlarmObject: "resource", Content: "CPU > 80%", PolicyName: "policy", Region: "ap-guangzhou" };
  const template = "{{alarm_id}}|{{alarm_object}}|{{alarm_content}}|{{policy_name}}|{{region}}|{{alarm_json}}|{{unknown}}";
  assert.equal(renderPrompt({ promptTemplate: template }, history),
    `id|resource|CPU > 80%|policy|ap-guangzhou|${JSON.stringify(history, null, 2)}|{{unknown}}`);
  assert.equal(renderPrompt({ promptTemplate: "请按现有自定义要求诊断" }, history), "请按现有自定义要求诊断");
});

test("missing fields have documented empty values while dimensions and metrics stay JSON", () => {
  const history = { InternalDimensions: { instanceId: "ins-1" }, MetricsInfo: [{ Value: 0 }] };
  assert.equal(renderPrompt({ promptTemplate: "{{alarm_level}}|{{namespace}}|{{dimensions}}|{{metrics_json}}" }, history),
    '||{"instanceId":"ins-1"}|[{"Value":0}]');
  assert.equal(renderPrompt({ promptTemplate: "{{metrics_json}}|{{last_occur_time}}" }, {}), "[]|");
  assert.equal(renderPrompt({ promptTemplate: "   " }, {}), defaultPrompt({}));
});

test("CLS references use event ID and policy ID separately and retain source-specific fields", () => {
  const record = { RecordId: "record-1", AlarmId: "alarm-policy-1", AlarmName: "日志告警", Status: 0,
    TopicId: "topic-1", TopicName: "应用日志", Trigger: "error_count > 10", CreateTime: 1700000000000 };
  const history = normalizeClsHistory(record, "ap-guangzhou");
  const prompt = renderPrompt({ promptTemplate: "{{alarm_id}}|{{policy_id}}|{{alarm_content}}|{{raw_json}}" }, history);
  assert.equal(prompt, `record-1|alarm-policy-1|error_count > 10|${JSON.stringify(record)}`);
  assert.match(defaultPrompt(history), /日志服务 CLS/);
  assert.match(defaultPrompt(history), /首次发生：1700000000/);
});

test("replacements do not reinterpret variable-like text contained in alarm data", () => {
  assert.equal(renderPrompt({ promptTemplate: "{{alarm_content}} / {{REGION}}" }, {
    Content: "业务日志中包含 {{region}}", Region: "ap-shanghai",
  }), "业务日志中包含 {{region}} / ap-shanghai");
});
