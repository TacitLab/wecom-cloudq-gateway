"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { authenticated, secureEqual } = require("../server");

test("constant-time credential comparison handles different lengths", () => {
  assert.equal(secureEqual("same", "same"), true);
  assert.equal(secureEqual("short", "longer"), false);
});

test("admin endpoint accepts only configured Basic credentials", () => {
  const config = { adminUsername: "admin", adminPassword: "correct horse" };
  const valid = Buffer.from("admin:correct horse").toString("base64");
  const invalid = Buffer.from("admin:wrong").toString("base64");
  assert.equal(authenticated({ headers: { authorization: `Basic ${valid}` } }, config), true);
  assert.equal(authenticated({ headers: { authorization: `Basic ${invalid}` } }, config), false);
  assert.equal(authenticated({ headers: {} }, config), false);
});
