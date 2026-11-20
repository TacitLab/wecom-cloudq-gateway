"use strict";

// Optional documentation tooling; not part of the gateway runtime.
// See docs/assets/README.md for installation and regeneration instructions.
const fs = require("node:fs");
const path = require("node:path");
const { Resvg } = require("@resvg/resvg-js");
const { GIFEncoder, quantize, applyPalette } = require("gifenc");

const root = path.resolve(__dirname, "..");
const output = path.join(root, "docs", "assets");
fs.mkdirSync(output, { recursive: true });
const logo = fs.readFileSync(path.join(root, "web", "public", "favicon.svg"), "utf8")
  .replace(/<svg[^>]*>/, "").replace(/<\/svg>\s*$/, "");
const font = 'font-family="Avenir Next, Arial, Heiti SC, Noto Sans CJK SC, sans-serif"';
const text = (x, y, value, size = 18, fill = "#edf5fc", weight = 400, extra = "") =>
  `<text x="${x}" y="${y}" ${font} font-size="${size}" fill="${fill}" font-weight="${weight}" ${extra}>${value}</text>`;
const rect = (x, y, w, h, fill, radius = 0, stroke = "none", extra = "") =>
  `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${radius}" fill="${fill}" stroke="${stroke}" ${extra}/>`;
const line = (x1, y1, x2, y2, color, width = 1, extra = "") =>
  `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${color}" stroke-width="${width}" ${extra}/>`;
const mark = (x, y, size) => `<g transform="translate(${x} ${y}) scale(${size / 64})">${logo}</g>`;
const svg = (width, height, title, content) =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img"><title>${title}</title>${content}</svg>`;

function hero() {
  return svg(1200, 496, "CloudQ Gateway：把云上问题，带回对话", [
    rect(0, 0, 1200, 496, "#0b2235", 20),
    // The routed corner grows out of the message → agent → report motif.
    '<path d="M1160 0V44H1120V84H1080" fill="none" stroke="#246d9d" stroke-width="2"/>',
    '<path d="M1200 44H1180V84H1140" fill="none" stroke="#21445f" stroke-width="2"/>',
    mark(60, 42, 36),
    text(111, 66, "WECOM × WORKBUDDY MANAGED AGENTS", 15, "#a9c6dd", 500, 'letter-spacing="1.4"'),
    text(56, 186, "CloudQ", 90, "#f4f8fc", 700, 'letter-spacing="-4"'),
    text(56, 278, "Gateway", 90, "#f4f8fc", 700, 'letter-spacing="-4"'),
    text(60, 340, "把云上问题，带回对话。", 31, "#b5def7", 500),
    text(61, 380, "持续对话 / 告警 RCA / HTML 报告", 18, "#95b3c9"),
    // Product illustration, explicitly labeled; no real user or cloud data.
    rect(684, 111, 456, 282, "#112e45", 12, "#325269"),
    line(684, 155, 1140, 155, "#325269"),
    '<circle cx="707" cy="133" r="3" fill="#80a5bf"/><circle cx="720" cy="133" r="3" fill="#50718b"/><circle cx="733" cy="133" r="3" fill="#50718b"/>',
    text(751, 139, "企业微信 / 运维群", 15, "#c0d4e4", 500),
    text(1119, 139, "交互示意", 12, "#92adc2", 400, 'text-anchor="end"'),
    rect(791, 177, 325, 48, "#246d9d", 10),
    text(811, 207, "帮我分析这条腾讯云告警", 18, "#ffffff", 500),
    mark(707, 244, 30),
    text(750, 267, "CloudQ Agent", 15, "#a9c6dd", 500),
    text(708, 306, "RCA 诊断结果", 24, "#f3f8fc", 600),
    line(709, 326, 1086, 326, "#45657d", 3),
    line(709, 338, 1017, 338, "#45657d", 3),
    rect(708, 354, 184, 25, "#1b415d", 4),
    '<path d="M720 361H727L731 365V374H720Z M727 361V365H731" fill="none" stroke="#a9d7f2" stroke-width="1.2"/>',
    text(740, 372, "诊断报告.html", 14, "#b9e2f9", 500),
    line(60, 429, 1140, 429, "#345168"),
    text(60, 462, "NODE.JS 24+", 14, "#b9cede", 500, 'letter-spacing="1"'),
    text(271, 462, "WMA NATIVE", 14, "#b9cede", 500, 'letter-spacing="1"'),
    text(498, 462, "MONITOR / APM / CLS", 14, "#b9cede", 500, 'letter-spacing="1"'),
    text(1140, 462, "SELF-HOSTED · SQLITE", 14, "#b9cede", 500, 'letter-spacing="1" text-anchor="end"'),
  ].join("\n"));
}

const stages = [
  ["接入", "企微对话 / 腾讯云告警", "从问题与事件开始"],
  ["网关编排", "会话隔离 · 去重 · 调度", "让消息进入正确的 Agent"],
  ["WMA × CloudQ", "托管 Agent · 技能诊断", "独立会话执行告警 RCA"],
  ["回到企业微信", "群内简报 · HTML 附件", "让分析成为可交付的结果"],
];

function pipeline(progress = null) {
  const active = progress === null ? -1 : Math.min(3, Math.floor(progress));
  const items = [
    rect(0, 0, 1200, 296, "#f2f7fb", 16),
    text(36, 49, "从一条消息，到一份分析。", 28, "#15344b", 600),
    text(1164, 47, "WORKFLOW / 流程示意", 13, "#587489", 500, 'text-anchor="end" letter-spacing="1"'),
  ];
  for (let i = 0; i < 3; i++) {
    const start = 271 + i * 297;
    items.push(line(start, 158, start + 62, 158, "#a8bfd0", 2));
    items.push(`<path d="M${start + 55} 153L${start + 62} 158L${start + 55} 163" fill="none" stroke="#a8bfd0" stroke-width="2"/>`);
    if (progress !== null && active === i) {
      const x = start + 5 + (progress % 1) * 49;
      items.push(`<circle cx="${x.toFixed(2)}" cy="158" r="5" fill="#246d9d"/>`);
    }
  }
  stages.forEach(([title, detail], i) => {
    const x = 36 + i * 297;
    const selected = active === i;
    items.push(rect(x, 92, 235, 132, selected ? "#e2f0fa" : "#ffffff", 8, selected ? "#246d9d" : "#cedce7", `stroke-width="${selected ? 2 : 1}"`));
    items.push(text(x + 18, 120, `0${i + 1}`, 14, "#246d9d", 600, 'letter-spacing="1"'));
    items.push(text(x + 18, 161, title, 23, "#17384f", 600));
    items.push(text(x + 18, 197, detail, 16, "#567084"));
  });
  items.push(text(36, 268, active < 0 ? "对话保持上下文，告警独立诊断；结果回到原对话或绑定群。" : stages[active][2], 16, "#567084"));
  return svg(1200, 296, "接入、网关编排、WMA 与 CloudQ 诊断、企业微信结果交付", items.join("\n"));
}

function render(source) {
  return new Resvg(source, { font: { loadSystemFonts: true } }).render();
}

const heroSvg = hero();
fs.writeFileSync(path.join(output, "readme-hero.svg"), heroSvg);
fs.writeFileSync(path.join(output, "readme-hero.png"), render(heroSvg).asPng());
const staticPipeline = pipeline();
fs.writeFileSync(path.join(output, "pipeline.svg"), staticPipeline);
fs.writeFileSync(path.join(output, "pipeline.png"), render(staticPipeline).asPng());

// Fixed palette across frames prevents text/color flicker; movement follows the
// actual workflow. All information remains visible in the first frame.
const encoder = GIFEncoder();
const first = render(pipeline(0));
const palette = quantize(first.pixels, 128);
for (let frame = 0; frame < 40; frame++) {
  const image = frame === 0 ? first : render(pipeline(frame / 10));
  const indexed = applyPalette(image.pixels, palette);
  encoder.writeFrame(indexed, image.width, image.height, {
    ...(frame === 0 ? { palette } : {}), delay: 100, repeat: 0,
  });
}
encoder.finish();
fs.writeFileSync(path.join(output, "pipeline.gif"), encoder.bytes());
for (const file of ["readme-hero.png", "pipeline.png", "pipeline.gif"]) {
  console.log(`${file}: ${Math.round(fs.statSync(path.join(output, file)).size / 1024)} KiB`);
}
