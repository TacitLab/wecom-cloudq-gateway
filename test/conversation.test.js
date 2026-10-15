"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const {
  buildConversationKey,
  extractPrompt,
  isNewCommand,
  isStopCommand,
  normalizeGatewayCommand,
} = require("../src/conversation");

test("single chat reuses a stable user conversation key", () => {
  const message = {
    aibotid: "bot-1",
    chattype: "single",
    from: { userid: "alice" },
  };
  assert.equal(buildConversationKey(message, "pair-7"), "pair:pair-7:bot:bot-1:single:alice");
});

test("recognizes only a complete /stop command", () => {
  assert.equal(isStopCommand("/stop"), true);
  assert.equal(isStopCommand("  /STOP "), true);
  assert.equal(isStopCommand("please /stop"), false);
  assert.equal(isStopCommand("/stop now"), false);
});

test("group chat defaults to one shared session per chat", () => {
  const message = {
    aibotid: "bot-1",
    chattype: "group",
    chatid: "room-8",
    from: { userid: "alice" },
  };
  assert.equal(buildConversationKey(message, "pair-7", "chat"), "pair:pair-7:bot:bot-1:group:room-8");
  assert.equal(buildConversationKey(message, "pair-7", "user"), "pair:pair-7:bot:bot-1:group:room-8:user:alice");
});

test("only a trimmed /new command starts a new session", () => {
  assert.equal(isNewCommand("/new"), true);
  assert.equal(isNewCommand("  /NEW \n"), true);
  assert.equal(isNewCommand("please /new"), false);
  assert.equal(isNewCommand("/new topic"), false);
});

test("normalizes complete gateway commands after a WeCom group @mention", () => {
  assert.equal(normalizeGatewayCommand("@工作搭子-凤凰 /new", "group"), "/new");
  assert.equal(normalizeGatewayCommand("@工作搭子-凤凰 /stop", "group"), "/stop");
  assert.equal(normalizeGatewayCommand("@工作搭子 凤凰\u2005/NEW", "group", "工作搭子 凤凰"), "/NEW");
  assert.equal(normalizeGatewayCommand("@工作搭子-凤凰 /bind-alert abc_123", "group"), "/bind-alert abc_123");
  assert.equal(normalizeGatewayCommand("@工作搭子-凤凰 请执行 /new", "group"), "@工作搭子-凤凰 请执行 /new");
  assert.equal(normalizeGatewayCommand("please /new", "group"), "please /new");
  assert.equal(normalizeGatewayCommand("@工作搭子-凤凰 /new topic", "group"), "@工作搭子-凤凰 /new topic");
  assert.equal(normalizeGatewayCommand("@工作搭子-凤凰 /new", "single"), "@工作搭子-凤凰 /new");
});

test("bind commands accept spaced WeCom display names independently of the local Bot label", () => {
  for (const name of ["多云管理 AIOPS agent", "多云管理\u00a0AIOPS\u2005agent"]) {
    for (const separator of [" ", "\u2005", "\n"]) {
      assert.equal(normalizeGatewayCommand(`@${name}${separator}/bind-alert FVMAF1A`, "group", "粉红凤凰"), "/bind-alert FVMAF1A");
    }
  }
  for (const text of [
    "@多云管理 AIOPS agent /bind-alert FVMAF1A extra",
    "@多云管理 AIOPS agent /new",
    "@多云管理 AIOPS agent /stop",
    "请执行 /bind-alert FVMAF1A",
    "@机器人 请分析\n问题 /bind-alert FVMAF1A",
  ]) {
    assert.equal(normalizeGatewayCommand(text, "group", "粉红凤凰"), text);
  }
});

test("extractPrompt handles text and mixed text", () => {
  assert.equal(extractPrompt({ msgtype: "text", text: { content: " hello " } }), "hello");
  assert.equal(extractPrompt({
    msgtype: "mixed",
    mixed: {
      msg_item: [
        { msgtype: "text", text: { content: "one" } },
        { msgtype: "image", image: {} },
        { msgtype: "text", text: { content: "two" } },
      ],
    },
  }), "one\ntwo");
});
