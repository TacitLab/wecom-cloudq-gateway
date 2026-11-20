# CloudQ Gateway 标志探索

日期：2026-11-20。品牌名称由用户明确为 **CloudQ Gateway**；不再采用 CA / CloudAgent 字母关联。

产品语义：连接企业微信对话、云端 Agent、运维告警与诊断结果。目标感受：可靠、清晰、有回应。本文件保留探索记录；A 造型 + B1 配色已定稿并应用，见文末「B1 定稿与应用」。

## 已确认的方向

首轮生成三种概念：Q 形通道、双向汇流、云端回声。用户选择 `a-q-portal.png` 的 Q 形通道逻辑，并提出小图标偏细，需要基于同一方向增加几版。

## 第二轮：小尺寸与笔画对比

- `q-refinements/a-bold-original.png`：保留内部对话尖角，增加笔画，缩短外部尾部。三版中视觉最饱满，推荐作为继续细化的基础。
- `q-refinements/b-square-gateway.png`：更方正的门框，较短、较平的尾部，强调网关结构。
- `q-refinements/c-soft-compact.png`：圆润轮廓，内部去掉尖角，更简单；对话语义相对减弱。
- `q-refinements/comparison.png`：三版大图、完整名称、16 / 24 / 32 / 48 px 与侧栏标题组合的对比图。
- `q-refinements/index.html`：100% 浏览器比例下的 CSS 实际尺寸预览，可下载各版原图。

用户已明确选择第二轮 **A 原形加粗**，随后提出增加色彩、避免单调。小尺寸直接使用相同生成图缩放；没有另画简化标志冒充缩小效果。16 px 下内部对话细节已经很弱，下一步应以外轮廓和 Q 尾部为识别重点。原图仍带生成栅格边缘，正式交付前需要矢量整理、像素对齐和深浅色验证。本轮未进行竞品标志对比，不作独占性或注册可用性结论。

## 第三轮：已选 A 的配色探索

以 `q-refinements/a-bold-original.png` 为编辑参考，保留厚重 Q、内部对话缺口和短尾，通过填色强化出口：

- **A1 海蓝青绿**：`q-colors/a1-blue-teal.png`。目标色为 `#2456DF` 与 `#11A99C`，蓝色主体搭配青绿出口；更接近现有蓝色界面。
- **A2 深蓝珊瑚**：`q-colors/a2-blue-coral.png`。目标色为 `#173B71` 与 `#F07858`，深蓝主体搭配珊瑚橙出口；冷暖对比鲜明，推荐继续细化。
- **A3 青绿渐变**：`q-colors/a3-teal-flow.png`。目标色为 `#006B77` → `#169F8A` → `#72BA45`，整体更柔和、有流动感。

`q-colors/comparison.png` 与归档的 `q-colors/index-diagonal.html` 提供此轮并排图、完整字标、16 / 24 / 32 / 48 px 和侧栏组合。色号为设计目标，生成图中的颜色存在像素级变化；正式矢量稿应以目标色重新定义填色。三版均以相同参考图编辑，当前仍是栅格配色方向稿。

完整生成提示词：`q-colors/prompts.json`。展示板生成文件：`q-colors/render-comparison.cjs`。正式产品资源尚未替换。

## 第四轮：内外双色（当前方向）

用户认为斜切分色有截断感，提出内外两个颜色。新的结构为：完整 Q 外框连同尾部使用同一主色，原内侧对话气泡填入第二色，颜色沿现有内轮廓交界；不再斜切 Q，也不加入额外细边。A 的加粗造型仍为已选基础。

- **B1 蓝色 × 浅青**：`q-colors/b1-blue-aqua.png`，外 `#2456DF`，内 `#6DE2CF`。
- **B2 深蓝 × 杏橙**：`q-colors/b2-navy-apricot.png`，外 `#173B71`，内 `#FFB17F`。
- **B3 墨青 × 薄荷**：`q-colors/b3-petrol-mint.png`，外 `#075D63`，内 `#8BE0B5`。

B1/B2/B3 仅指本轮配色编号，三者都沿用 A 造型。用户已明确选定 **B1 蓝色 × 浅青**。将原来的白色负形变为彩色实形，使气泡更突出；单色应用仍回到所选 A 的留白构造。16 px 下气泡尖角不明显，但完整 Q 外形与内外色块仍可区分。

配色对比板：`q-colors/comparison-inner-outer.png`。配色预览为 `q-colors/index.html`；生成文件为 `q-colors/render-inner-outer.cjs`，完整提示词为 `q-colors/inner-outer-prompts.json`。本目录保留探索过程，正式资源以如下定稿为准。

## B1 定稿与应用

- 最终预览：`final-b1/preview.png`；描摹与字标参数：`final-b1/trace-record.json`。
- 从选定原图自动描摹 Q 外形和内侧气泡为两条矢量轮廓；统一为目标纯色并收紧外侧留白。不是将 PNG 嵌入 SVG。
- 完整组合使用 Geist 600，字标转为路径；导出彩色、深底、单色、灰阶 SVG / PNG / JPEG，以及头像与应用图标。
- 正式资产：`web/public/brand/`；规范：`docs/brand.md`；导出程序：`scripts/render-brand.cjs`。
- 更新侧栏、首次配置向导、浏览器标题与图标、README Banner，名称统一为 CloudQ Gateway。
- 图形已在 16 / 24 / 32 / 48 px 及深浅背景预览，并在本地只读空数据页面检查向导与侧栏。前端构建、现有 6 项测试通过；检查工具仍有原先存在的警告。

探索对比板的 SVG 引用同目录 PNG，以避免重复嵌入大量栅格数据；PNG 对比图可独立分享。正式 `web/public/brand/*.svg` 为无外部依赖的纯矢量文件。

## 文件与生成记录

所有图形使用内置图像生成工具。首轮和第二轮的完整提示词分别保存在 `prompts.json` 与 `q-refinements/prompts.json`。第二轮以用户选择的首轮 Q 原图作为编辑参考。

对比图的文字独立使用系统 Avenir Next / 中文回退字体排版。`comparison.svg` 中的文字已由渲染器转为轮廓；标志本身仍是嵌入的生成 PNG，因此此文件是对比展示板，不是最终纯矢量 logo。

`q-refinements/render-comparison.cjs` 生成对比板和预览页，使用 `/tmp/cloudq-readme-tools/node_modules/@resvg/resvg-js`，与仓库现有 README 视觉资源采用相同临时工具目录，不增加运行依赖。
