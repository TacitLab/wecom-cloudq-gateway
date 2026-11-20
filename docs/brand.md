# CloudQ Gateway 标志

2026-11-20，用户选定 **A 加粗 Q 造型 + B1 蓝色外层 / 浅青内层**。正式品牌名称为 **CloudQ Gateway**，不再使用 CA 或 CloudAgent 字母关联。

## 造型与颜色

- 外层为完整连贯的 Q，内侧为对话气泡；短尾和加粗轮廓服务于浏览器标签、侧栏等小尺寸场景。
- 外层固定为蓝色 `#2456DF`，内层固定为浅青 `#6DE2CF`。字标颜色为 `#142238`，深底版使用白色字标。
- 两色沿内外轮廓交界；不斜切分色，不给尾部单独着色，不加渐变、投影、描边或背景框。
- 矢量轮廓来自用户选定的生成图自动描摹。保留原始造型，将栅格中的轻微色差统一为上述纯色，并收紧外侧留白。
- 图标画板为 64 × 64，图形最大边为 56，四周最小留白为 4。图形按实际轮廓居中，所有尺寸使用同一套路径。

## 字标与组合

- 标准横向组合：图形 + 完整名称 **CloudQ Gateway**，作为一个锁定文件放置，不重新拼接或排字。
- 字体为 Geist Variable，字重 600，保留字体 kerning，并增加轻微负字距。字体采用 SIL Open Font License 1.1；授权原文随资源交付。
- 字标已经转为矢量轮廓，SVG 无字体依赖、不嵌入位图、不引用外部资源。
- 页面标题与侧栏使用完整产品名；侧栏的说明文字为「运维消息网关」。

## 正式资源

| 文件 | 用途 |
| --- | --- |
| `web/public/favicon.svg` | 应用侧栏、首次配置向导、现代浏览器图标的规范源文件 |
| `web/public/favicon.ico` | 16 / 24 / 32 / 48 / 64 / 128 / 256 px 浏览器兼容图标 |
| `web/public/brand-icon.png` | 512 × 512 透明图标 |
| `web/public/apple-touch-icon.png` | 180 × 180 白底图标，保留移动端裁切安全区 |
| `web/public/brand/logo-icon.svg` | 与 favicon 相同的独立标志，供其他材料复用 |
| `web/public/brand/logo-lockup.svg` | 彩色图形 + 深色字标的完整横向组合 |
| `web/public/brand/logo-lockup-inverse.svg` | 彩色图形 + 白色字标，用于深色背景 |
| `web/public/brand/logo-{icon,lockup}-{black,white,gray}.svg` | 对应的黑、白、灰阶版本 |
| `web/public/brand/avatar.svg`、`app-icon.svg` | 白底方形头像 / 应用图标安全区构图，由平台处理外框裁切 |
| `web/public/brand/raster/` | 各版本 PNG 与 JPEG；PNG 保留透明，白色字标 JPEG 使用深色底 |
| `web/public/brand/Geist-LICENSE.txt` | 字体许可证 |

单色版将内侧气泡恢复为透明留白，保留原 A 的单色识别方式。双色版内侧是实色浅青，并非透明。不要把两个颜色同时改成相同颜色，否则内侧气泡会消失。

## 使用边界

- 独立图标最小显示尺寸为 16 px；完整横向组合建议至少 180 px 宽。
- 图形周围至少保留图标画板的 1/16 净空（64 画板上为 4）；正文和其他图形不得进入。
- 只使用交付的配色版本，不随 CSS 主题任意染色。
- 不拉伸、不裁切、不改变尾部与气泡形状、不改变图形和字标比例、不额外加框，不重排组合标志。
- 16 px 下气泡尖角很细，识别主要来自 Q 外形和内外色块；24 / 32 px 及以上更适合展示完整细节。
- 此次做了描摹、尺寸与页面应用检查，未进行商标检索或竞品排他性认证。

## 重新导出

转换工具安装在临时目录，不加入应用运行依赖：

```bash
npm install --prefix /tmp/cloudq-logo-tools --no-audit --no-fund potrace fontkit @resvg/resvg-js
NODE_PATH=/tmp/cloudq-logo-tools/node_modules node scripts/render-brand.cjs
NODE_PATH=/tmp/cloudq-readme-tools/node_modules node scripts/render-readme.cjs --hero-only
```

描摹源为 `docs/logo-concepts/2026-11-20/q-colors/b1-blue-aqua.png`。参数、原图轮廓范围与字标设置保存在 `docs/logo-concepts/2026-11-20/final-b1/trace-record.json`；最终对比板为同目录的 `preview.png`。

浏览器图标使用 Vite 的 `BASE_URL`，兼容 `/admin/` 部署。当前版本查询参数为 `cloudq-b1-1`；后续更新图标时应同步递增所有引用，避免沿用旧缓存。
