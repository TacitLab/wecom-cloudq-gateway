"use strict";

const crypto = require("node:crypto");

const HOST = "monitor.tencentcloudapi.com";
const ENDPOINT = `https://${HOST}`;
const SERVICE = "monitor";
const VERSION = "2018-07-24";

function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function hmac(key, value, encoding) {
  return crypto.createHmac("sha256", key).update(value).digest(encoding);
}

function authorization(secretId, secretKey, timestamp, payload, contentType) {
  const date = new Date(timestamp * 1000).toISOString().slice(0, 10);
  const canonicalHeaders = `content-type:${contentType}\nhost:${HOST}\n`;
  const signedHeaders = "content-type;host";
  const canonicalRequest = ["POST", "/", "", canonicalHeaders, signedHeaders, sha256(payload)].join("\n");
  const credentialScope = `${date}/${SERVICE}/tc3_request`;
  const stringToSign = ["TC3-HMAC-SHA256", timestamp, credentialScope, sha256(canonicalRequest)].join("\n");
  const secretDate = hmac(`TC3${secretKey}`, date);
  const secretService = hmac(secretDate, SERVICE);
  const secretSigning = hmac(secretService, "tc3_request");
  const signature = hmac(secretSigning, stringToSign, "hex");
  return `TC3-HMAC-SHA256 Credential=${secretId}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;
}

class TencentMonitorClient {
  constructor(config, fetchImpl = globalThis.fetch) {
    this.config = config;
    this.fetch = fetchImpl;
  }

  async request(action, params) {
    const timestamp = Math.floor(Date.now() / 1000);
    const payload = JSON.stringify(params || {});
    const contentType = "application/json; charset=utf-8";
    const headers = {
      Authorization: authorization(this.config.secretId, this.config.secretKey, timestamp, payload, contentType),
      "Content-Type": contentType,
      Host: HOST,
      "X-TC-Action": action,
      "X-TC-Timestamp": String(timestamp),
      "X-TC-Version": VERSION,
    };
    if (this.config.region) headers["X-TC-Region"] = this.config.region;
    const response = await this.fetch(ENDPOINT, {
      method: "POST",
      headers,
      body: payload,
      signal: AbortSignal.timeout(15000),
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok || result?.Response?.Error) {
      const detail = result?.Response?.Error;
      throw new Error(detail ? `${detail.Code}: ${detail.Message}` : `Tencent Monitor HTTP ${response.status}`);
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
