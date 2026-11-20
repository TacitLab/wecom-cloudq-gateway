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
// README layout keeps square corners; the canonical logo geometry is unchanged.
const rect = (x, y, w, h, fill, stroke = "none", extra = "") =>
  `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="${fill}" stroke="${stroke}" ${extra}/>`;
const line = (x1, y1, x2, y2, color, width = 1, extra = "") =>
  `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${color}" stroke-width="${width}" ${extra}/>`;
const mark = (x, y, size) => `<g transform="translate(${x} ${y}) scale(${size / 64})">${logo}</g>`;
const svg = (width, height, title, content) =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img"><title>${title}</title>${content}</svg>`;

function hero() {
  return svg(1200, 360, "企业微信 CloudQ 运维网关", [
    rect(0, 0, 1200, 360, "#0b2235"),
    // The routed corner grows out of the message → agent → report motif.
    '<path d="M1160 0V44H1120V84H1080" fill="none" stroke="#246d9d" stroke-width="2"/>',
    '<path d="M1200 44H1180V84H1140" fill="none" stroke="#21445f" stroke-width="2"/>',
    mark(60, 40, 30),
    text(106, 61, "CLOUDQ GATEWAY / WECOM × WMA", 14, "#a9c6dd", 500, 'letter-spacing="1.4"'),
    text(58, 145, "CloudQ Gateway", 46, "#f4f8fc", 600),
    text(60, 204, "告警自动分析，结论主动送达。", 23, "#b5def7", 500),
    text(60, 243, "在群里继续追问，让 Agent 协助修复。", 21, "#95b3c9"),
    // Product illustration, explicitly labeled; no real user or cloud data.
    rect(692, 37, 448, 252, "#112e45", "#325269"),
    line(692, 78, 1140, 78, "#325269"),
    '<circle cx="715" cy="58" r="3" fill="#80a5bf"/><circle cx="728" cy="58" r="3" fill="#50718b"/><circle cx="741" cy="58" r="3" fill="#50718b"/>',
    text(759, 63, "企业微信 / 运维群", 14, "#c0d4e4", 500),
    text(1119, 63, "交互示意", 12, "#92adc2", 400, 'text-anchor="end"'),
    mark(716, 97, 26),
    text(755, 117, "CloudQ Agent", 14, "#a9c6dd", 500),
    text(1116, 116, "自动推送", 12, "#b9e2f9", 500, 'text-anchor="end"'),
    text(716, 154, "告警 RCA 分析", 22, "#f3f8fc", 600),
    text(716, 178, "根因分析 · 排查建议", 15, "#a9c6dd"),
    rect(716, 192, 184, 23, "#1b415d"),
    '<path d="M728 197H735L739 201V210H728Z M735 197V201H739" fill="none" stroke="#a9d7f2" stroke-width="1.2"/>',
    text(748, 209, "诊断报告.html", 14, "#b9e2f9", 500),
    rect(859, 233, 257, 38, "#246d9d"),
    text(879, 258, "帮我修复这个问题", 17, "#ffffff", 500),
    line(60, 309, 1140, 309, "#345168"),
    text(60, 341, "NODE.JS 24+", 14, "#b9cede", 500, 'letter-spacing="1"'),
    text(271, 341, "WMA NATIVE", 14, "#b9cede", 500, 'letter-spacing="1"'),
    text(498, 341, "MONITOR / APM / CLS", 14, "#b9cede", 500, 'letter-spacing="1"'),
    text(1140, 341, "SELF-HOSTED · SQLITE", 14, "#b9cede", 500, 'letter-spacing="1" text-anchor="end"'),
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
    rect(0, 0, 1200, 296, "#f2f7fb"),
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
    items.push(rect(x, 92, 235, 132, selected ? "#e2f0fa" : "#ffffff", selected ? "#246d9d" : "#cedce7", `stroke-width="${selected ? 2 : 1}"`));
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
if (process.argv.includes("--hero-only")) {
  console.log("Updated readme-hero.svg and readme-hero.png");
  process.exit(0);
}
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
