# README 视觉资源

项目首页使用仓库内资源，不依赖外部图床、徽章服务或 SVG 动画支持。

- `readme-hero.svg` / `readme-hero.png`：1200 × 360 深蓝 Banner。项目标题与介绍统一置于图内，右侧示意 Agent 自动推送告警分析与报告，用户随后请求协助修复。
- `pipeline.svg` / `pipeline.png`：1200 × 296 静态工作流程。
- `pipeline.gif`：同尺寸的四步流程动图，4 秒循环。文字始终可见，移动信号与节点高亮指示步骤；首页同时提供静态版链接。

Banner、交互示意和流程节点统一使用直角。生成源文件为 [`scripts/render-readme.cjs`](../../scripts/render-readme.cjs)，复用 `web/public/favicon.svg` 的字形，并在 README 中使用直角背板。PNG 用于保证常见 Markdown 渲染器的兼容性，SVG 保留可编辑的矢量输出。

## 重新生成

仅编辑文档图形时需要以下工具；它们不是网关运行依赖。将工具安装到临时目录，不修改项目依赖：

```bash
npm install --prefix /tmp/cloudq-readme-tools --no-audit --no-fund @resvg/resvg-js gifenc
NODE_PATH=/tmp/cloudq-readme-tools/node_modules node scripts/render-readme.cjs
```

只更新 Banner 时，可在最后一条命令末尾添加 `--hero-only`，跳过流程动图的生成。

在仓库根目录执行。渲染使用系统字体，建议安装 Avenir Next / Arial，以及 Heiti SC 或 Noto Sans CJK SC；生成后检查中英文字形、换行及边界。不同系统的字形细节可能有所不同，README 始终显示已导出的图片。
