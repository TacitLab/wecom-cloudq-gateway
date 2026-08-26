"use strict";

const active = new Map();

function begin(conversationKey, taskId) {
  const controller = new AbortController();
  const control = { taskId, controller, signal: controller.signal };
  active.set(conversationKey, control);
  return control;
}

function finish(conversationKey, taskId) {
  const control = active.get(conversationKey);
  if (control?.taskId === taskId) active.delete(conversationKey);
}

function stop(conversationKey) {
  const control = active.get(conversationKey);
  if (!control) return false;
  control.controller.abort();
  return true;
}

module.exports = { begin, finish, stop };
