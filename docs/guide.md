# 部署与使用指南

[← 返回项目首页](../README.md)

将企业微信智能机器人接入 WorkBuddy Managed Agents（WMA），在企业微信中与运维 Agent 持续对话，并将腾讯云告警自动交给 Agent 进行根因分析（RCA），向指定群推送诊断结果和 HTML 报告。

网关以单实例 Node.js 服务运行在 CVM 或 IDC，通过企业微信 WebSocket 长连接收发消息，通过腾讯云 API 3.0 和 ACP SSE 调用 WMA。配置、会话映射、任务和告警历史保存在本机 SQLite，管理台使用 React、TypeScript 和 shadcn/ui。

CloudQ 等诊断技能、工具和业务提示词由 WMA Agent 提供，需要在 WMA 侧配置；网关负责消息接入、会话管理、告警调度和结果交付。

## 主要能力

| 能力 | 当前支持 |
| --- | --- |
| Bot 与 Agent 管理 | 多组 Bot / WMA Agent；每个 Bot 绑定一个 Agent，同一 Agent 可供多个 Bot 复用；支持扫码创建或绑定已有 Bot |
| 持续对话 | 单聊上下文复用、群聊共享或按用户隔离、流式回复、思考过程显示开关、`/new` 与 `/stop` 指令 |
| WMA 版本管理 | 跟随平台路由或固定可用版本；从指定源版本创建腾讯云凭证注入版，再显式选择并保存 |
| 告警自动 RCA | 轮询云产品监控、APM、CLS 告警；策略多选、事件去重、独立诊断会话、可编辑 Prompt |
| 结果交付 | 回复原对话，或主动推送到绑定群；支持 HTML 文件附件、告警推送失败重试和历史查看 |
| Web 管理台 | 首次配置向导、凭证管理、连接状态、告警群绑定、测试推送、立即轮询、暂停与手动重试 |

## 架构

```text
企业微信单聊 / 群聊
        │ WebSocket 长连接：接收消息、流式回复、主动推送
        ▼
┌──────────────────────────────────────────────┐
│ Node.js 网关                                 │
│ Bot 配对 · 会话队列 · 告警轮询 · HTML 附件交付 │
│ Web 管理台 / 管理 API / SQLite                │
└───────────────┬──────────────────┬───────────┘
                │                  │ 腾讯云 API：读取策略与告警历史
                │                  └── Monitor（云产品 / APM）、CLS
                │ 腾讯云 API 3.0 + ACP SSE
                ▼
       WMA 托管 Agent / Session
       CloudQ 等技能、工具与云资源访问
```

企业微信消息接入无需公网回调 URL，也不依赖 SCF 或 Redis。管理端口供管理员访问，Bot 和云 API 连接需要可用的出站网络。

<a id="deployment"></a>

## 快速部署

### 环境要求

- Docker 与 Docker Compose；直接运行时需要 Node.js **24+**。
- 一台可持久化存储、具有出站网络的 CVM / IDC 主机。
- 已创建并发布、开启公网 API 访问的 WMA Agent，以及具备相应权限且关联 WorkBuddy 企业身份的腾讯云 AK/SK。
- 企业微信智能机器人长连接接入权限；也可在管理台扫码创建机器人。

请使用**单实例**部署。同一个 Bot 同时只应有一条活动长连接，SQLite 数据目录必须可写且持久化。

### 使用 Git 与 Docker Compose

```bash
git clone --branch main https://cnb.woa.com/buddy-op/wecom-cloudq-gateway.git
cd wecom-cloudq-gateway
cp .env.example .env
# 编辑 .env，设置高强度 ADMIN_PASSWORD
./deploy.sh
```

部署成功后访问 `http://<主机内网 IP>:3000/admin`，使用 `.env` 中的 `ADMIN_USERNAME` / `ADMIN_PASSWORD` 登录。首次进入按向导添加 WMA 凭证、Agent 和 Bot 配对。

后续在同一源码目录执行 `./deploy.sh` 即可更新。脚本从当前分支执行 `git pull --ff-only`，校验 Compose，重新构建并更新容器，再等待健康检查；检测到已跟踪文件有未提交修改时会停止，容器异常时输出最近日志。

也可直接管理容器：

```bash
docker compose up -d --build
docker compose logs -f gateway
docker compose ps
```

Compose 项目名仍为 `wecom-cloudagent`，镜像名和打包文件名保留历史命名，以便沿用现有部署。SQLite 存储在 `wecom-cloudagent_gateway-data` 卷中；迁移源码目录时保留 `.env` 和数据卷，**不要执行 `docker compose down -v`**。

默认映射主机 TCP 3000 端口。请通过安全组或防火墙将访问限制到可信内网；跨不可信网络访问管理台时使用 HTTPS 反向代理或 SSH 隧道。

### 直接运行

以下命令包含管理台构建，并显式加载 `.env`：

```bash
npm ci --omit=dev
npm run build:web
cp .env.example .env
# 编辑 .env，设置 ADMIN_PASSWORD，并将 SQLITE_PATH 改为 ./data/gateway.db
mkdir -p data
node --env-file=.env server.js
```

`npm start` 只执行 `node server.js`，适合由进程管理器或容器注入环境变量的场景，不会自动读取 `.env`。缺少 `web/dist` 时，管理台返回 503，需要先执行 `npm run build:web`。

<a id="bot-setup"></a>

## 首次接入 Bot

1. 在 WMA 侧准备可用 Agent、提示词和技能，发布版本并开启公网 API 访问。需要 CloudQ 诊断时，先确认该 Agent 的 CloudQ 技能与云资源权限可用。
2. 在「WMA 凭证设置」添加腾讯云 `SecretId` / `SecretKey`。默认 API 接入地域为 `ap-guangzhou`；「测试」只拉取可见 Agent，不创建会话。编辑时密钥留空表示保留原值。
3. 在「WMA Agent」选择凭证，从列表选择 Agent 并保存。高级配置可设置使用版本、调用超时和思考内容选项。
4. 在「企业微信 Bot 配对」选择 Agent，并选择接入方式：扫码创建新机器人，或手动填写已开启「使用长连接」的 Bot ID 和 Secret。
5. 保存后等待连接状态变为 `authenticated`，在企业微信发送「你好」，再追问「我刚才问了什么」，验证上下文复用。

扫码创建使用 `WECOM_PAIRING_SOURCE` 标识来源，未设置时回退为 `wecom_cli_external`；生产环境应向企业微信申请正式来源标识。Bot Secret 只保存在服务端，页面不回显明文。

### 对话与会话

| 操作 / 场景 | 行为 |
| --- | --- |
| 单聊 | 同一 Bot 与用户复用一个 WMA Session |
| 群聊默认模式 | 同一 Bot 与群共用一个 Session；可在 Bot 配置中改为按用户隔离 |
| `/new` | 后续对话使用新 Session |
| `/stop` | 取消当前任务并清空该会话排队消息，保留 Session 上下文 |
| Bot 换绑、Agent 配置或接入凭证变更 | 后续消息使用新的会话命名空间，避免复用旧配置的 Session |
| Session 已失效或归档 | 提示发送 `/new`，不会自动创建替代会话 |

群聊可在 @Bot 后发送网关指令。指令需完整匹配，普通句子中包含 `/new` 不会触发重置。同一会话的消息串行执行。

Bot 配置中的「显示思考过程」默认开启。关闭后，普通对话和告警 RCA 只交付最终回复；普通对话处理中保留占位提示。

<a id="wma-versions"></a>

## WMA 版本与运行时凭证

### 选择使用版本

在 Agent「高级配置 → 使用版本」选择一个可用版本，或选择「跟随 WMA 路由」。保存只验证并绑定所选版本，不会创建云端版本，也不会修改 WMA 共享流量路由。

固定版本时，聊天和告警会话创建请求显式携带 `VersionId`，发送消息前还会核对 Session 的实际版本；不匹配则停止使用。切换版本后，后续消息进入新会话。

### 创建凭证注入版

当 CloudQ、TencentCloudInfra 等技能需要从 Agent 运行环境读取腾讯云凭证时：

1. 在「腾讯云凭证」保存用于访问云资源的 AK/SK。
2. 打开 Agent 高级配置，**显式选择源版本**、腾讯云凭证和云资源地域。
3. 点击「创建凭证注入版」。网关通过 `CreateAgentVersionFromSource` 创建独立 PROD 版本，保留源版本的技能、工具及其他配置，向 Manifest 环境写入 `TENCENTCLOUD_SECRET_ID`、`TENCENTCLOUD_SECRET_KEY`、`TENCENTCLOUD_REGION`，并追加环境认证提示词。
4. 创建成功后点击「选择此注入版」，再点击「保存」，绑定才会生效。

创建版本与切换版本是两个独立操作。取消编辑不会删除已创建的云端版本；需要包含 WMA 控制台的新提示词时，应选取包含该修改的源版本。当前创建流程不支持仅通过 `system_prompt_file` 提供系统提示词的源版本，请先配置文本系统提示词。

凭证轮换不会自动更新云端版本。出现「凭证待同步」时，重新创建注入版、选择并保存。「跟随 WMA 路由」只解除本地版本绑定，已有云端版本及会话中的凭证仍需在 WMA 侧管理和轮换。

<a id="alert-rca"></a>

## 告警自动 RCA

每条新告警使用独立 WMA Session，执行 Agent 来自所选 Bot 当前的绑定，不占用员工聊天上下文。

### 配置步骤

1. 在「腾讯云凭证」添加用于读取告警的 AK/SK。
2. 在「告警 RCA」新增配置，依次完成「告警来源 → 监控范围 → 诊断与推送 → 确认配置」。选择来源、凭证、地域，以及指定策略（最多 100 个）或全部符合条件的策略；云产品监控和 APM 还可按策略类型过滤。
3. 选择执行 Bot，设置轮询间隔、自动轮询开关及可选的 CloudQ 诊断凭证。高级配置可调整首次回溯、重叠窗口、自定义 Prompt 和恢复状态。
4. 保存后复制一次性绑定指令，例如 `/bind-alert A7K92F`。将所选 Bot 加入目标群，在群内 @Bot 后发送指令；绑定码必须属于该 Bot。
5. 在管理台执行「测试推送」确认群绑定，再执行「立即轮询」验证告警读取和诊断链路。

更换执行 Bot 后需要重新绑定目标群。「暂停」只停止后续自动轮询，已进入诊断或推送阶段的任务会继续完成。

### 支持的来源

| 告警来源 | 服务 | 使用的查询接口 |
| --- | --- | --- |
| 云产品监控（`MT_QCE`） | Monitor | `DescribeAlarmPolicies`、`DescribeAlarmHistories` |
| 应用性能监控 APM（`MT_TAW`） | Monitor | `DescribeAlarmPolicies`、`DescribeAlarmHistories`，按来源过滤 |
| 日志服务 CLS（`MT_CLS`） | CLS | `DescribeAlarms`、`DescribeAlertRecordHistory` |

查询凭证需具备相应读取权限。CLS 来源还需要 `cls:DescribeAlarms` 和 `cls:DescribeAlertRecordHistory`；通用凭证测试使用 Monitor 接口，CLS 权限应通过该来源的策略列表和立即轮询验证。

默认每 **60 秒**轮询，首次回溯 **10 分钟**，后续重叠查询 **5 分钟**。SQLite 按配置、告警事件 ID 和状态去重。修改来源、凭证、地域或策略范围后会重置轮询游标，重新按首次回溯窗口查询。

默认只处理 `ALARM`。高级配置可包含 `OK`，但告警历史按首次发生时间查询，持续很久才恢复的告警可能落在窗口外，因此当前轮询方式不保证完整恢复通知。历史记录也可能缺少完整阈值、APM 应用 ID 或 Trace ID，网关不会自动补全这些字段。

### Prompt 与诊断凭证

「自定义诊断 Prompt」显示系统默认模板，可直接编辑或恢复默认。支持 `{{变量名}}` 替换，例如 `{{alarm_json}}`、`{{alarm_content}}`、`{{policy_name}}`、`{{region}}`；完整变量及来源差异见页面提示。模板不支持点路径表达式，来源缺失字段替换为空。

以下三种凭证用途独立：

| 配置位置 | 用途 |
| --- | --- |
| WMA 凭证设置 | 查询 Agent / 版本、创建托管会话、获取访问令牌 |
| 告警来源中的腾讯云凭证 | 读取 Monitor / CLS 策略与告警历史 |
| 凭证注入版 / CloudQ 诊断凭证 | 供 Agent 内部技能访问待诊断云资源 |

告警配置中的「CloudQ 诊断凭证」为可选项。未选时使用 Agent 已有环境；选中时每次诊断读取最新凭证，通过 Prompt 要求 Agent 将 AK/SK 与告警地域传入实际工具进程。这依赖 Agent 按技能说明执行，不会直接修改沙箱全局环境，也不同于写入 Manifest 的凭证注入版。

### 任务与重试

```text
queued → analyzing → delivery_pending → delivering → delivered
```

诊断失败标记为 `failed`，可在管理台手动重试；推送失败采用指数退避，最多尝试 5 次。服务重启后，正在诊断的告警任务标记失败，待推送结果和附件继续交付。已记录成功的附件与完整简报不会重新发送；分段简报在中途失败或发送成功但状态尚未落库时仍可能重复。

<a id="html-reports"></a>

## HTML 报告附件

在对话中要求「生成 HTML 周报，并以 HTML 附件发给我」，或在告警 Prompt 中要求「先输出简报，再输出完整 HTML 报告」。网关引导 Agent 输出完整源码，将其转为 UTF-8 `.html` 文件并上传企微临时素材，发送到原对话或绑定告警群，无需网页托管。

推荐的最终回复格式：

````text
```wecom-html filename="诊断报告.html"
<!DOCTYPE html>
<html lang="zh-CN">
<head><meta charset="UTF-8"><title>诊断报告</title></head>
<body>完整报告内容</body>
</html>
```
````

每轮最多 **5 个附件**，HTML 源码总计最多 **5 MiB**，并受模型输出长度限制。仅交付完整文档及正常结束任务的结果；CSS、JavaScript 应内嵌，沙箱本地图片等资源不会自动打包。要求交付 HTML 时也兼容标准 `html` 代码块，普通问答中的 HTML 示例保留为文本。

若 Agent 只回复路径或「已生成」，网关会在同一 Session 追加一次源码导出请求；仍无完整 HTML 时提示附件未发送，并将任务标记失败。告警附件持久化保存，推送失败或重启后可继续发送，随告警历史一起清理。升级前已完成且没有附件的旧任务不会自动补发，需手动重试。

当前尚未接入用户上传的文件和图片，也没有 Agent 交互式授权或追问界面；Agent 发起相应 ACP 请求时，网关返回取消结果。

<a id="env-network"></a>

## 环境变量与网络

运行配置见 [.env.example](../.env.example)。Bot、WMA 和云资源凭证通过管理台维护，不放在环境变量中。

| 变量 | 默认值 | 说明 |
| --- | --- | --- |
| `HOST` | `0.0.0.0` | HTTP 服务监听地址 |
| `PORT` | `3000` | 容器内或直接运行时的监听端口；Compose 主机端口映射需另行修改 |
| `ADMIN_USERNAME` | `admin` | 管理台 Basic Auth 用户名 |
| `ADMIN_PASSWORD` | 必填 | 管理台密码，请替换示例值 |
| `SQLITE_PATH` | `./data/gateway.db` | 直接运行默认路径；示例环境和 Docker 使用 `/data/gateway.db` |
| `HTTP_BODY_LIMIT_BYTES` | `1048576` | 管理 API 请求体大小限制 |
| `WECOM_STREAM_MAX_BYTES` | `18000` | 单条企微流式内容截断上限 |
| `STREAM_FLUSH_INTERVAL_MS` | `500` | 流式内容刷新间隔 |
| `TASK_RETENTION_SECONDS` | `86400` | 已完成 / 失败聊天任务与幂等记录保留时间 |
| `ALERT_JOB_RETENTION_DAYS` | `30` | 已完成 / 失败告警历史保留天数 |
| `WECOM_PAIRING_SOURCE` | `wecom_cli_external` | 扫码创建机器人的来源标识 |

主机需具备正常 DNS，并允许以下出站访问：

| 地址 | 用途 |
| --- | --- |
| `wss://openws.work.weixin.qq.com:443` | 企业微信 Bot 长连接；私有部署可在 Bot 高级配置中指定地址 |
| `https://work.weixin.qq.com:443` | 扫码创建机器人 |
| `https://workbuddyenterprise.tencentcloudapi.com:443` | WMA 腾讯云 API 3.0 |
| WMA 返回的公网 ACP 地址，如 `*.ma.workbuddy.cn:443` | Agent 会话通信 |
| `https://monitor.tencentcloudapi.com:443` | 云产品监控 / APM 查询及通用凭证测试 |
| `https://cls.tencentcloudapi.com:443` | CLS 告警策略与历史 |

Agent 内部技能访问云资源的网络由 WMA 运行环境提供，需要在 WMA 侧单独确认。

<a id="operations"></a>

## 数据、备份与升级

SQLite 使用 WAL 模式。Bot Secret、WMA AK/SK 和腾讯云 AK/SK **以明文保存在本机数据库**，管理 API 只返回掩码或配置状态。请限制数据库、数据卷和备份访问权限。`/admin` 与 `/api/admin/*` 使用 HTTP Basic Auth，普通 HTTP 不加密凭证和请求内容；`/healthz` 无需登录，仅用于数据库可用性与连接状态检查，不代表外部链路均可用。

凭证注入版会将真实 AK/SK 存入 WMA 云端版本环境；选择 CloudQ 诊断凭证会将真实凭证发送到云端会话。本地诊断记录、结果及日志会遮盖已知凭证，但不能控制云端会话和技能内部记录。请按 Agent 的使用范围分配权限并做好密钥轮换。

文件级备份可先停止网关，再复制数据卷中的数据库：

```bash
docker compose stop gateway
docker run --rm -v wecom-cloudagent_gateway-data:/data:ro -v "$PWD":/backup alpine \
  cp /data/gateway.db /backup/gateway-$(date +%F).db
docker compose start gateway
```

恢复时停止网关，将备份放回数据卷并确保运行用户可读写；数据库备份和原有 WAL / SHM 文件不能混用。重启会保留已保存的 Session 映射；未完成的普通聊天任务标记失败，不自动重放，用户可重新发送消息。网关不会自动销毁 WMA 托管会话，请在 WMA 侧管理其生命周期与费用。

### 从 CloudAgent 旧版升级

当前 `main` 为 WMA 版本，原 `main` 已保留在 `CloudAgent-version` 分支。升级前先备份数据库。

- WMA 凭证、Agent、会话和任务使用新的 `wma_*` 表；旧 CloudAgent 凭证、Agent 和会话不读取、不迁移。
- 首次启动保留 Bot ID、Secret、开关、会话设置以及告警配置和群绑定，但解除旧 Agent 绑定；旧 Agent 相关未完成告警标记失败。
- 重新录入 WMA AK/SK、选择 Agent，并编辑原 Bot 重新绑定。未绑定的 Bot 不建立长连接，关联告警跳过自动轮询；完成绑定后恢复。
- 无需重录 Bot 凭据或重新绑定原告警群。若旧版使用 SCF 回调，请停用原入口，避免重复接入。

Compose 项目名保留只解决数据卷复用，不代表旧版可以直接读取升级后的数据库；需要回滚时应同时恢复升级前的数据备份。

<a id="development"></a>

## 本地开发与验证

```bash
npm ci
npm --prefix web ci
cp .env.example .env
# 设置 ADMIN_PASSWORD；本地 SQLITE_PATH 使用 ./data/gateway.db
npm run dev
```

另开终端运行 `npm run dev:web`。Vite 管理台路径为 `/admin/`，`/api` 代理到 `http://localhost:3000`，本地后端请保持 3000 端口。先在 **Vite 同一地址**下打开 `/api/admin/state` 完成 Basic Auth，再访问 `/admin/`。前端细节见 [web/README.md](../web/README.md)。

```bash
npm test                       # 后端 Node.js 测试
npm --prefix web test           # 前端 Vitest 测试
npm --prefix web run lint       # 前端静态检查
npm --prefix web run build      # TypeScript 检查与生产构建
npm run package                # 构建前端并生成 dist/wecom-cloudagent-cvm.zip
```

打包前先安装根目录依赖。压缩包包含运行依赖与管理台构建产物，不包含 `.env` 或数据库。

<a id="code-map"></a>

## 代码导航

| 路径 | 职责 |
| --- | --- |
| [server.js](../server.js) | 管理台静态资源、管理 API、鉴权、健康检查与进程生命周期 |
| [web/src](../web/src) | React 管理台、配置向导与表单 |
| [src/bot-manager.js](../src/bot-manager.js)、[src/wecom-pairing.js](../src/wecom-pairing.js) | 多 Bot 连接、热同步与扫码配对 |
| [src/gateway.js](../src/gateway.js)、[src/scheduler.js](../src/scheduler.js)、[src/worker.js](../src/worker.js) | 消息接入、幂等、会话队列与流式回复 |
| [src/wma.js](../src/wma.js)、[src/agent.js](../src/agent.js)、[src/agent-config.js](../src/agent-config.js) | WMA API / ACP、回复处理、版本选择与凭证注入版 |
| [src/alert-poller.js](../src/alert-poller.js)、[src/alert-worker.js](../src/alert-worker.js) | 告警轮询、独立诊断与推送重试 |
| [src/monitor-client.js](../src/monitor-client.js)、[src/cls-client.js](../src/cls-client.js) | 腾讯云接口签名与 Monitor / CLS 查询 |
| [src/html-reply.js](../src/html-reply.js)、[src/notifier.js](../src/notifier.js) | HTML 源码提取、附件与消息交付 |
| [src/database.js](../src/database.js)、[src/registry.js](../src/registry.js)、[src/store.js](../src/store.js)、[src/alert-store.js](../src/alert-store.js) | 数据库、配置、会话、任务和告警持久化 |
| [test](../test) | 后端回归测试 |

连接异常时先检查管理台状态与 `docker compose logs -f gateway`。`disconnected_event` 通常表示同一 Bot 建立了另一条连接；未绑定 WMA Agent 时先完成绑定；WMA 调用失败时核对接入凭证、API 权限、版本状态与出站网络。不要将 Bot Secret、AK/SK、访问令牌或完整用户消息写入排障日志。
