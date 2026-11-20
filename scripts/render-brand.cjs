"use strict";

// Optional brand tooling; packages are installed outside the application.
// NODE_PATH=/tmp/cloudq-logo-tools/node_modules node scripts/render-brand.cjs
// Geometry is traced from the selected generated B1 artwork, never redrawn.
const fs = require("node:fs");
const path = require("node:path");
const { Potrace } = require("potrace");
const { Resvg } = require("@resvg/resvg-js");
const fontkit = require("fontkit");
const Jimp = require("jimp");

const root = path.resolve(__dirname, "..");
const publicDir = path.join(root, "web/public");
const out = path.join(publicDir, "brand");
const reviewDir = path.join(root, "docs/logo-concepts/2026-11-20/final-b1");
const source = path.join(root, "docs/logo-concepts/2026-11-20/q-colors/b1-blue-aqua.png");
const colors = { outer: "#2456DF", inner: "#6DE2CF", ink: "#142238" };
const variants = {
  color: { outer: colors.outer, inner: colors.inner, text: colors.ink },
  inverse: { outer: colors.outer, inner: colors.inner, text: "#FFFFFF" },
  black: { outer: "#111111", inner: null, text: "#111111" },
  white: { outer: "#FFFFFF", inner: null, text: "#FFFFFF" },
  gray: { outer: "#4B5563", inner: "#CBD5E1", text: "#374151" },
};
const wrap = (w, h, body) => `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">${body}</svg>`;
const raster = (svg, width, background) => new Resvg(svg, {
  fitTo: { mode: "width", value: width },
  ...(background ? { background } : {}),
}).render();
const getBox = d => new Resvg(wrap(1254, 1254, `<path d="${d}"/>`)).innerBBox();

async function traceContours() {
  const tracer = new Potrace({ threshold: 130, turdSize: 40, alphaMax: 1, optCurve: true, optTolerance: 0.8 });
  await new Promise((resolve, reject) => tracer.loadImage(source, err => err ? reject(err) : resolve()));
  const d = tracer.getPathTag().match(/d="([^"]+)"/)[1];
  const contours = d.match(/M[^M]+/g);
  if (contours.length !== 2) throw new Error("Expected exactly the outer Q and inner bubble contours");
  contours.sort((a, b) => { const x = getBox(a), y = getBox(b); return y.width * y.height - x.width * x.height; });
  return contours;
}

function outlinedWordmark() {
  const font = fontkit.openSync(path.join(root, "web/node_modules/@fontsource-variable/geist/files/geist-latin-wght-normal.woff2")).getVariation({ wght: 600 });
  const run = font.layout("CloudQ Gateway");
  const scale = 32 / font.unitsPerEm;
  let cursor = 0, minY = Infinity, maxY = -Infinity;
  const paths = run.glyphs.map((glyph, i) => {
    const p = run.positions[i], box = glyph.bbox;
    if (glyph.path.commands.length) { minY = Math.min(minY, box.minY + p.yOffset); maxY = Math.max(maxY, box.maxY + p.yOffset); }
    const markup = `<path transform="translate(${(cursor + p.xOffset).toFixed(3)} ${p.yOffset})" d="${glyph.path.toSVG()}"/>`;
    cursor += p.xAdvance - 9; // restrained tracking, with font kerning retained
    return markup;
  }).join("");
  return { paths, scale, width: (cursor + 9) * scale, centerY: (minY + maxY) / 2 * scale };
}

async function exportAsset(name, svg, width, dark = false) {
  fs.writeFileSync(path.join(out, `${name}.svg`), svg);
  const png = raster(svg, width).asPng();
  fs.writeFileSync(path.join(out, "raster", `${name}.png`), png);
  const jpg = await Jimp.read(raster(svg, width, dark ? colors.ink : "#FFFFFF").asPng());
  await jpg.quality(94).writeAsync(path.join(out, "raster", `${name}.jpg`));
}

function writeIco(icon) {
  const sizes = [16, 24, 32, 48, 64, 128, 256];
  const pngs = sizes.map(size => raster(icon, size).asPng());
  const header = Buffer.alloc(6 + sizes.length * 16);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(sizes.length, 4);
  let offset = header.length;
  sizes.forEach((size, i) => {
    const pos = 6 + i * 16;
    header[pos] = size === 256 ? 0 : size;
    header[pos + 1] = header[pos];
    header.writeUInt16LE(1, pos + 4);
    header.writeUInt16LE(32, pos + 6);
    header.writeUInt32LE(pngs[i].length, pos + 8);
    header.writeUInt32LE(offset, pos + 12);
    offset += pngs[i].length;
  });
  fs.writeFileSync(path.join(publicDir, "favicon.ico"), Buffer.concat([header, ...pngs]));
}

async function main() {
  fs.mkdirSync(path.join(out, "raster"), { recursive: true });
  fs.mkdirSync(reviewDir, { recursive: true });
  const [outer, inner] = await traceContours();
  const box = getBox(outer), scale = 56 / Math.max(box.width, box.height);
  const x = (64 - box.width * scale) / 2 - box.x * scale;
  const y = (64 - box.height * scale) / 2 - box.y * scale;
  const transform = `matrix(${scale.toFixed(9)} 0 0 ${scale.toFixed(9)} ${x.toFixed(6)} ${y.toFixed(6)})`;
  const mark = variant => `<g transform="${transform}">${variant.inner
    ? `<path fill="${variant.outer}" d="${outer}"/><path fill="${variant.inner}" d="${inner}"/>`
    : `<path fill="${variant.outer}" fill-rule="evenodd" d="${outer} ${inner}"/>`}</g>`;
  const word = outlinedWordmark();
  const lockupWidth = Math.ceil(68 + word.width + 10);
  const lockup = variant => wrap(lockupWidth, 64,
    `<g transform="translate(2 6) scale(.8125)">${mark(variant)}</g><g fill="${variant.text}" transform="translate(68 ${(32 + word.centerY).toFixed(3)}) scale(${word.scale} ${-word.scale})">${word.paths}</g>`);
  const icon = wrap(64, 64, mark(variants.color));
  fs.writeFileSync(path.join(publicDir, "favicon.svg"), icon);
  fs.writeFileSync(path.join(publicDir, "brand-icon.png"), raster(icon, 512).asPng());
  writeIco(icon);
  const appIcon = wrap(64, 64, `<rect width="64" height="64" fill="#FFFFFF"/><g transform="translate(6 6) scale(.8125)">${mark(variants.color)}</g>`);
  fs.writeFileSync(path.join(publicDir, "apple-touch-icon.png"), raster(appIcon, 180).asPng());
  for (const [key, variant] of Object.entries(variants)) {
    const suffix = key === "color" ? "" : `-${key}`;
    await exportAsset(`logo-icon${suffix}`, wrap(64, 64, mark(variant)), 512, key === "white" || key === "inverse");
    await exportAsset(`logo-lockup${suffix}`, lockup(variant), 1600, key === "white" || key === "inverse");
  }
  await exportAsset("avatar", appIcon, 512);
  await exportAsset("app-icon", appIcon, 512);
  fs.copyFileSync(path.join(root, "web/node_modules/@fontsource-variable/geist/LICENSE"), path.join(out, "Geist-LICENSE.txt"));

  const label = (x, y, text, size = 18, fill = "#536172") => `<text x="${x}" y="${y}" font-family="Avenir Next, Heiti SC, sans-serif" font-size="${size}" fill="${fill}">${text}</text>`;
  const placed = (variant, x, y, size) => `<g transform="translate(${x} ${y}) scale(${size / 64})">${mark(variant)}</g>`;
  const group = lockup(variants.color).replace(/^<svg[^>]*>|<\/svg>$/g, "");
  const inverted = lockup(variants.inverse).replace(/^<svg[^>]*>|<\/svg>$/g, "");
  let preview = `<rect width="1440" height="980" fill="#FFFFFF"/>${label(64, 58, "CLOUDQ GATEWAY / B1 FINAL", 14)}${label(64, 120, "蓝色外层，浅青内层。", 42, colors.ink)}${label(64, 163, "A 的加粗造型 × B1 内外双色 · 已选定", 20)}<path d="M64 198H1376" stroke="#E0E5ED"/>`;
  preview += placed(variants.color, 112, 246, 290);
  preview += `<g transform="translate(494 344) scale(2.1)">${group}</g>`;
  preview += `<rect x="530" y="503" width="38" height="12" rx="6" fill="${colors.outer}"/>${label(581, 516, colors.outer, 16)}<rect x="728" y="503" width="38" height="12" rx="6" fill="${colors.inner}"/>${label(779, 516, colors.inner, 16)}`;
  preview += `<rect x="64" y="588" width="1312" height="184" rx="16" fill="${colors.ink}"/><g transform="translate(124 631) scale(1.35)">${inverted}</g>`;
  [16, 24, 32, 48].forEach((size, i) => {
    const cx = 914 + i * 110;
    preview += placed(variants.color, cx - size / 2, 663 - size / 2, size) + label(cx - 19, 721, `${size} px`, 14, "#B7C7DC");
  });
  [16, 24, 32, 48].forEach((size, i) => {
    const cx = 124 + i * 116;
    preview += placed(variants.color, cx - size / 2, 834 - size / 2, size) + label(cx - 19, 888, `${size} px`, 14);
  });
  preview += placed(variants.black, 740, 806, 58) + placed(variants.gray, 848, 806, 58) + `<rect x="956" y="800" width="70" height="70" rx="8" fill="${colors.ink}"/>` + placed(variants.white, 962, 806, 58);
  preview += label(742, 888, "单色与灰阶", 14) + label(64, 945, "SVG 矢量 · 字标已转轮廓 · 16–256 px 浏览器图标 · 透明 PNG · JPEG · 深浅背景版本", 16);
  const previewRenderer = new Resvg(wrap(1440, 980, preview), { font: { loadSystemFonts: true } });
  fs.writeFileSync(path.join(reviewDir, "preview.png"), previewRenderer.render().asPng());
  fs.writeFileSync(path.join(reviewDir, "preview.svg"), previewRenderer.toString());
  fs.writeFileSync(path.join(reviewDir, "trace-record.json"), JSON.stringify({
    source: path.relative(root, source), method: "Potrace 2.1.8; color-boundary tracing; original approved contours preserved",
    traceParameters: { threshold: 130, turdSize: 40, alphaMax: 1, optTolerance: 0.8 },
    sourceBounds: { x: box.x, y: box.y, width: box.width, height: box.height },
    icon: { viewBox: "0 0 64 64", artworkMaxDimension: 56, transform },
    colors, wordmark: { family: "Geist", weight: 600, license: "OFL-1.1", size: 32, tracking: -9, outlined: true },
  }, null, 2) + "\n");
  console.log(JSON.stringify({ exported: out, preview: path.join(reviewDir, "preview.png"), contours: 2, lockupWidth }));
}

main().catch(err => { console.error(err); process.exitCode = 1; });
