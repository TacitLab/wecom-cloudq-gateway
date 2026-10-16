"use strict";

// An explicit fence distinguishes deliverable files from HTML examples in a reply.
const HTML_DELIVERY_INSTRUCTION = `
<wecom_attachment_delivery>
本对话支持发送 HTML 文件附件。当用户要求生成、修改或交付 HTML 文件/网页时，完成工作后必须在最终回复中输出完整的独立 HTML 文档，使用以下专用代码块：
\`\`\`wecom-html filename="report.html"
<!DOCTYPE html>
<html>完整文档源码</html>
\`\`\`
网关会把代码块中的原始 UTF-8 内容作为 .html 附件发送，不在聊天中展示源码。文件名可使用中文；多个文件使用多个代码块。CSS 和 JavaScript 尽量内嵌，避免依赖沙箱本地资源。每次最多 5 个文件，源码总大小最多 5 MiB。即使已写入沙箱文件，也必须在最终回复中输出完整源码，不能只返回路径或下载链接。不要省略内容，也不要在 HTML 内使用与外层相同的独立围栏行（必要时增加外层反引号数量）。普通问答、HTML 代码解释和片段示例不使用这个专用代码块。
</wecom_attachment_delivery>`;

const MAX_HTML_BYTES = 5 * 1024 * 1024;
const MAX_HTML_FILES = 5;

function safeFilename(value, index) {
  const basename = String(value || "").split(/[\\/]/).at(-1)
    .replace(/[\x00-\x1f\x7f<>:"|?*]/g, "_").replace(/^\.+/, "").trim();
  const stem = Array.from(basename.replace(/\.html?$/i, "") || `report-${index}`).slice(0, 80).join("");
  return `${stem}.html`;
}

// Line buffering also handles fences split across arbitrary ACP text chunks.
// Only this turn's deliverables after the last tool call are retained.
function createHtmlReply(onNotification) {
  let pending = "";
  let message;
  let messageId;
  let fence;
  let otherFence;
  let passthroughLine = false;
  let source = [];
  let bytes = 0;
  let totalBytes = 0;
  let overflow = false;
  let attachments = [];
  let warnings = [];

  function emit(text) {
    if (text) onNotification({ ...message, update: { ...message.update, content: { type: "text", text } } });
  }

  function line(value) {
    if (passthroughLine) {
      emit(value);
      passthroughLine = !value.endsWith("\n");
      return;
    }
    const bare = value.replace(/\r?\n$/, "");
    if (fence) {
      const closing = bare.match(/^ {0,3}(`{3,}|~{3,})\s*$/);
      if (closing && closing[1][0] === fence.marker[0] && closing[1].length >= fence.marker.length) {
        const html = source.join("");
        if (overflow || attachments.length >= MAX_HTML_FILES) {
          warnings.push("HTML 附件超过数量或大小限制（最多 5 个，总计 5 MiB）。");
        } else if (!/^\s*(?:<!doctype\s+html[^>]*>\s*)?<html(?:\s|>)/i.test(html)
          || !/<\/html>\s*$/i.test(html)) {
          warnings.push("HTML 附件不是完整文档，未发送。请要求重新生成完整 HTML。");
        } else {
          let filename = safeFilename(fence.filename, attachments.length + 1);
          const stem = filename.slice(0, -5);
          let suffix = 2;
          while (attachments.some((item) => item.filename === filename)) filename = `${stem}-${suffix++}.html`;
          attachments.push({ filename, buffer: Buffer.from(html, "utf8") });
          totalBytes += bytes;
          emit(`已生成 HTML 文件：${filename}。\n`);
        }
        fence = undefined;
        source = [];
        return;
      }
      bytes += Buffer.byteLength(value, "utf8");
      if (totalBytes + bytes > MAX_HTML_BYTES) {
        overflow = true;
        source = [];
      }
      if (!overflow) source.push(value);
      return;
    }
    const opening = !otherFence && bare.match(/^ {0,3}(`{3,}|~{3,})wecom-html(?:\s+filename=(?:"([^"]*)"|'([^']*)'|(\S+)))?\s*$/i);
    if (opening) {
      fence = { marker: opening[1], filename: opening[2] ?? opening[3] ?? opening[4] };
      bytes = 0;
      overflow = false;
      source = [];
      return;
    }
    // Leave regular Markdown fences, including literal protocol examples, alone.
    const marker = bare.match(/^ {0,3}(`{3,}|~{3,})(.*)$/);
    if (marker) {
      if (!otherFence) otherFence = marker[1];
      else if (marker[1][0] === otherFence[0] && marker[1].length >= otherFence.length && !marker[2].trim()) otherFence = undefined;
    }
    emit(value);
  }

  function flush() {
    if (pending) line(pending);
    pending = "";
    if (fence) warnings.push("HTML 附件输出未完成，未发送。请要求重新生成完整 HTML。");
    fence = undefined;
    source = [];
    otherFence = undefined;
    passthroughLine = false;
  }

  return {
    onNotification(notification) {
      const update = notification?.update;
      if (update?.sessionUpdate === "tool_call") {
        flush();
        attachments = [];
        warnings = [];
        totalBytes = 0;
        messageId = undefined;
      }
      if (update?.sessionUpdate !== "agent_message_chunk" || update.content?.type !== "text") {
        onNotification(notification);
        return;
      }
      const nextId = update.messageId == null ? undefined : String(update.messageId);
      if (nextId && messageId && nextId !== messageId) flush();
      message = notification;
      if (nextId) messageId = nextId;
      const text = String(update.content.text || "");
      // Process slices rather than buffering a potentially enormous single chunk.
      for (let offset = 0; offset < text.length; offset += 4096) {
        pending += text.slice(offset, offset + 4096);
        let end;
        while ((end = pending.indexOf("\n")) !== -1) {
          const value = pending.slice(0, end + 1);
          pending = pending.slice(end + 1);
          line(value);
        }
        // Ordinary prose still streams immediately. Hold only a possible fence
        // prefix until its line is complete, so split headers never leak.
        if (!fence && pending && (passthroughLine || !/^ {0,3}(?:`[\s\S]*|~[\s\S]*)?$/.test(pending))) {
          emit(pending);
          pending = "";
          passthroughLine = true;
        }
        // Bound memory even for a minified HTML document without newlines.
        if (fence && totalBytes + bytes + Buffer.byteLength(pending, "utf8") > MAX_HTML_BYTES) {
          overflow = true;
          source = [];
          pending = "";
        }
      }
    },
    finish() {
      flush();
      return { attachments, warnings };
    },
  };
}

module.exports = { createHtmlReply, HTML_DELIVERY_INSTRUCTION, MAX_HTML_BYTES };
