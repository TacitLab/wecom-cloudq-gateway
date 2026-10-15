"use strict";

const crypto = require("node:crypto");

const SERVICE = "monitor";
const VERSION = "2018-07-24";

function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function hmac(key, value, encoding) {
  return crypto.createHmac("sha256", key).update(value).digest(encoding);
}

function authorization(secretId, secretKey, timestamp, payload, contentType, service = SERVICE) {
  const host = `${service}.tencentcloudapi.com`;
  const date = new Date(timestamp * 1000).toISOString().slice(0, 10);
  const canonicalHeaders = `content-type:${contentType}\nhost:${host}\n`;
  const signedHeaders = "content-type;host";
  const canonicalRequest = ["POST", "/", "", canonicalHeaders, signedHeaders, sha256(payload)].join("\n");
  const credentialScope = `${date}/${service}/tc3_request`;
  const stringToSign = ["TC3-HMAC-SHA256", timestamp, credentialScope, sha256(canonicalRequest)].join("\n");
  const secretDate = hmac(`TC3${secretKey}`, date);
  const secretService = hmac(secretDate, service);
  const secretSigning = hmac(secretService, "tc3_request");
  const signature = hmac(secretSigning, stringToSign, "hex");
  return `TC3-HMAC-SHA256 Credential=${secretId}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;
}

class TencentMonitorClient {
  constructor(config, fetchImpl = globalThis.fetch, { service = SERVICE, version = VERSION } = {}) {
    this.config = config;
    this.fetch = fetchImpl;
    this.service = service;
    this.version = version;
    this.host = `${service}.tencentcloudapi.com`;
  }

  async request(action, params) {
    const timestamp = Math.floor(Date.now() / 1000);
    const payload = JSON.stringify(params || {});
    const contentType = "application/json; charset=utf-8";
    const headers = {
      Authorization: authorization(this.config.secretId, this.config.secretKey, timestamp, payload, contentType, this.service),
      "Content-Type": contentType,
      Host: this.host,
      "X-TC-Action": action,
      "X-TC-Timestamp": String(timestamp),
      "X-TC-Version": this.version,
    };
    if (this.config.region) headers["X-TC-Region"] = this.config.region;
    const response = await this.fetch(`https://${this.host}`, {
      method: "POST",
      headers,
      body: payload,
      signal: AbortSignal.timeout(15000),
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok || result?.Response?.Error) {
      const detail = result?.Response?.Error;
      throw new Error(detail ? `${detail.Code}: ${detail.Message}` : `Tencent ${this.service} HTTP ${response.status}`);
    }
    return result.Response || {};
  }

  describeAlarmHistories(params) {
    return this.request("DescribeAlarmHistories", params);
  }

  describeAlarmPolicies(params) {
    return this.request("DescribeAlarmPolicies", params);
  }
}

module.exports = { TencentMonitorClient, authorization };
