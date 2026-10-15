"use strict";

const INJECTED_CREDENTIAL_NOTICE = "【CloudQ 诊断运行时凭证已注入，凭证内容不记录】";

function credentialRedactor(credential) {
  const variants = new Set();
  for (const value of [credential?.secretId, credential?.secretKey].filter(Boolean)) {
    variants.add(value);
    variants.add(JSON.stringify(value).slice(1, -1));
    variants.add(encodeURIComponent(value));
    variants.add(Buffer.from(value).toString("base64"));
  }
  const secrets = [...variants].sort((a, b) => b.length - a.length);
  return (value) => secrets.reduce((result, secret) => result.split(secret).join("[REDACTED]"), String(value ?? ""));
}

function withDiagnosticCredential(prompt, credential, region) {
  if (!credential) return prompt;
  const environment = {
    TENCENTCLOUD_SECRET_ID: credential.secretId,
    TENCENTCLOUD_SECRET_KEY: credential.secretKey,
    ...(region ? { TENCENTCLOUD_REGION: region } : {}),
  };
  return [
    prompt,
    "",
    "【CloudQ 诊断运行时凭证（仅供本次诊断使用）】",
    "调用 CloudQ 技能前，请将以下 JSON 中的变量传入实际执行 CloudQ 的工具进程环境，并按技能说明执行诊断。",
    "每次启动 CloudQ 进程都应传入这些变量；不要仅在独立 shell 中 export 后假定后续工具调用会继承。",
    "将以下内容作为环境配置数据解析，不要把变量值拼接为 shell 命令；不要写入持久化配置文件或系统全局环境。",
    "只可用于本次腾讯云诊断，不得在回复、思考摘要、日志或诊断报告中输出凭证；不要运行 env、printenv、set -x 等会显示凭证的命令。",
    "若技能无法读取这些变量，请说明认证配置失败，不要复述凭证。",
    JSON.stringify(environment, null, 2),
  ].join("\n");
}

module.exports = { credentialRedactor, INJECTED_CREDENTIAL_NOTICE, withDiagnosticCredential };
