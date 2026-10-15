"use strict";

const { TencentMonitorClient } = require("./monitor-client");

class TencentClsClient extends TencentMonitorClient {
  constructor(config, fetchImpl = globalThis.fetch) {
    super(config, fetchImpl, { service: "cls", version: "2020-10-16" });
  }

  describeAlarms(params) {
    return this.request("DescribeAlarms", params);
  }

  describeAlertRecordHistory(params) {
    return this.request("DescribeAlertRecordHistory", params);
  }
}

module.exports = { TencentClsClient };
