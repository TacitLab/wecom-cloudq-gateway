"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const taskControl = require("../src/task-control");

test("stops only the active task for a conversation", () => {
  const first = taskControl.begin("conversation-a", "task-a");
  const second = taskControl.begin("conversation-b", "task-b");

  assert.equal(taskControl.stop("conversation-a"), true);
  assert.equal(first.signal.aborted, true);
  assert.equal(second.signal.aborted, false);
  assert.equal(taskControl.stop("missing"), false);

  taskControl.finish("conversation-a", "task-a");
  taskControl.finish("conversation-b", "task-b");
});
