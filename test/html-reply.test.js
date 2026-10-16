"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { createHtmlReply, MAX_HTML_BYTES } = require("../src/html-reply");

function chunk(text, messageId = "final") {
  return { update: { sessionUpdate: "agent_message_chunk", messageId, content: { type: "text", text } } };
}

function collect(parts) {
  let visible = "";
  const collector = createHtmlReply((n) => { if (n.update.content?.type === "text") visible += n.update.content.text; });
  for (const part of parts) collector.onNotification(typeof part === "string" ? chunk(part) : part);
  return { ...collector.finish(), visible };
}

test("HTML source split at every character is preserved as UTF-8 and hidden from chat", () => {
  const html = '<!DOCTYPE html>\r\n<html lang="zh"><body>你好<script>const x = `test`;</script></body></html>\r\n';
  const reply = '这是文件：\r\n```wecom-html filename="../周报.html"\r\n' + html + '```\r\n完成。';
  const result = collect([...reply]);
  assert.equal(result.attachments.length, 1);
  assert.equal(result.attachments[0].filename, "周报.html");
  assert.deepEqual(result.attachments[0].buffer, Buffer.from(html, "utf8"));
  assert.equal(result.visible, "这是文件：\r\n已生成 HTML 文件：周报.html。\n完成。");
  assert.deepEqual(result.warnings, []);
});

test("normal prose streams immediately and HTML examples remain text", () => {
  const seen = [];
  const collector = createHtmlReply((n) => seen.push(n.update.content.text));
  collector.onNotification(chunk("hello"));
  assert.deepEqual(seen, ["hello"]);
  collector.onNotification(chunk(" world"));
  assert.deepEqual(seen, ["hello", " world"]);
  collector.finish();
  const example = '```html\n<html>example</html>\n```\n````text\n```wecom-html filename="demo.html"\n<html>literal</html>\n```\n````\n';
  assert.equal(collect([...example]).visible, example);
  assert.equal(collect([example]).attachments.length, 0);
});

test("only complete deliverables after the last tool call are retained", () => {
  const file = '```wecom-html filename="x.html"\n<html>old</html>\n```\n';
  const result = collect([file, { update: { sessionUpdate: "tool_call" } }, chunk(file.replace("old", "new"), "next")]);
  assert.equal(result.attachments.length, 1);
  assert.equal(result.attachments[0].buffer.toString(), "<html>new</html>\n");
  assert.deepEqual(result.warnings, []);
});

test("incomplete and oversized files are never sent or leaked into chat", () => {
  for (const content of ["<html>unfinished", "<html>" + "x".repeat(MAX_HTML_BYTES) + "</html>\n```\n"]) {
    const result = collect(['```wecom-html filename="x.html"\n' + content]);
    assert.equal(result.attachments.length, 0);
    assert.equal(result.warnings.length, 1);
    assert.doesNotMatch(result.visible, /<html>|xxxx/);
  }
});

test("multiple files use distinct safe HTML names and respect the file count limit", () => {
  const result = collect([Array.from({ length: 6 }, () => '```wecom-html filename="x.htm"\n<html>ok</html>\n```\n').join("")]);
  assert.deepEqual(result.attachments.map((item) => item.filename), ["x.html", "x-2.html", "x-3.html", "x-4.html", "x-5.html"]);
  assert.equal(result.warnings.length, 1);
});
