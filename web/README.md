# CloudQ 网关管理台

企业微信 CloudQ 运维网关的 React 管理前端，提供首次配置向导、WMA 凭证与 Agent 管理、Bot 配对、腾讯云凭证、告警 RCA 及架构值守配置。部署与业务流程见[根目录 README](../README.md)。

技术栈：React 19、TypeScript、Vite、Tailwind CSS 4、shadcn/ui 与 Base UI。

## 开发

在仓库根目录安装后端与前端依赖，复制 `.env.example` 为 `.env`，设置 `ADMIN_PASSWORD` 并将本地 SQLite 路径改为 `./data/gateway.db`，再启动后端：

```bash
npm ci
npm --prefix web ci
npm run dev
```

另开终端，在仓库根目录运行：

```bash
npm run dev:web
```

开发代理将 `/api` 转发到 `http://localhost:3000`，后端需保持 3000 端口。先在 Vite 输出的同一地址下打开 `/api/admin/state`，通过浏览器的 HTTP Basic Auth 登录，再访问 `/admin/`；例如使用默认端口时，先打开 `http://localhost:5173/api/admin/state`，再打开 `http://localhost:5173/admin/`。

## 构建与检查

以下命令在仓库根目录运行：

```bash
npm --prefix web test
npm --prefix web run lint
npm --prefix web run build
```

构建先执行 TypeScript 检查，再生成 `web/dist`。后端通过 `/admin` 提供静态资源；Vite 的 `base` 固定为 `/admin/`。Docker 构建会自动安装前端依赖并完成构建。

## 代码导航

- `src/App.tsx`：管理台入口与页面组合。
- `src/components/views/`：Bot、Agent、凭证、告警和首次配置页面。
- `src/components/forms/`、`src/components/dialogs/`：配置表单、版本选择与弹窗。
- `src/components/ui/`：基础 UI 组件。
- `src/lib/`：管理 API、状态、类型与告警来源定义。
- `src/components/forms/agent-form.test.tsx`：Agent 表单与版本工作流测试。
