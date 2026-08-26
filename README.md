# 企业微信 Bot ↔ WorkBuddy CloudAgent：CVM 长连接网关

这是一个部署在 CVM/IDC 的常驻 Node.js 服务。它使用企业微信智能机器人的 WebSocket 长连接接收对话并主动发送告警通知，通过 WorkBuddy CloudAgent SDK 执行 Agent；同时可以定时轮询腾讯云可观测平台的告警历史，自动执行 RCA 并推送到固定企业微信群。

## 配对模型

- 网关可以管理多组企业微信 Bot 和 CloudAgent 配置。
- 每个企业微信 Bot 只能绑定一个 CloudAgent。
- 同一个 CloudAgent 配置可以被多个 Bot 复用。
- 管理员在 Web 页面修改配对后，新消息立即进入新 Agent。
- 配对或 Agent 版本会进入会话键，换绑不会误用旧 Agent 的 Session。

用户不需要选择 Agent。单聊默认按 `Bot + 用户` 复用 Session，群聊默认按 `Bot + 群` 复用 Session；只有发送严格匹配的 `/new` 才创建新 Runtime/Session。群聊中企业微信回调可能保留 `@Bot` 前缀，`@Bot /new` 会被网关归一化为同一指令。

发送 `/stop`（群聊可发送 `@Bot /stop`）会取消当前正在执行的 Agent 任务并清理该会话的排队消息，但保留现有 Session 上下文。“告警 RCA”页面也提供独立的“暂停/启用”按钮；暂停只影响后续自动轮询，已进入诊断或推送阶段的任务会继续完成。

告警 RCA 配置选择一个已有 Bot，自动使用该 Bot 当前绑定的 CloudAgent。每条新告警创建独立 Runtime/Session，不会污染员工的聊天上下文。

## 架构

```text
企业微信 Bot ──WebSocket 对话/主动推送──┐
                                       ├── CVM 网关 ── CloudAgent SDK/ACP ── WorkBuddy
腾讯云告警历史 API ──定时轮询───────────┘       │
                                               └── SQLite（配置、Session、告警去重、任务）
```

不再需要公网回调 URL、SCF 自调用、Redis 或额外的配置加密密钥。Bot Secret、CloudAgent API Key 直接保存在本机 SQLite 中，管理页面和管理 API 不会回显明文。请通过文件权限和主机访问控制保护数据库。

## 网络要求

服务不需要入站公网端口，但 IDC 必须允许以下出站访问：

- `wss://openws.work.weixin.qq.com:443`（企业微信长连接；私有部署企业以管理端显示地址为准）
- `https://monitor.tencentcloudapi.com:443`（腾讯云告警历史轮询）
- `https://www.codebuddy.cn:443`（AgentOS API）
- Runtime 返回的 `*.sandbox.codebuddy.cn:443` 等 ACP 地址
- 正常 DNS 解析

如果 IDC 完全不能访问公网，长连接和 CloudAgent 都无法工作，需要先配置企业代理、专线或出口白名单。

## 运行要求

- Node.js `24+`（使用稳定的 Node 内置 `node:sqlite`）
- 单实例进程。一个企业微信 Bot 同时只应有一个活动长连接；不要横向启动两份相同数据的网关。
- SQLite 文件所在目录必须持久化并可写。

## 环境变量

复制示例：

```bash
cp .env.example .env
```

把生成值填入 `.env`：

```text
HOST=0.0.0.0
PORT=3000
ADMIN_USERNAME=admin
ADMIN_PASSWORD=<高强度管理密码>
SQLITE_PATH=/data/gateway.db
```

可选参数：

| 变量 | 默认值 | 说明 |
| --- | ---: | --- |
| `WECOM_STREAM_MAX_BYTES` | `18000` | 企业微信单条流式内容截断上限 |
| `STREAM_FLUSH_INTERVAL_MS` | `500` | Agent 流式内容刷新间隔 |
| `TASK_RETENTION_SECONDS` | `86400` | 已完成/失败任务和幂等记录保留时间 |
| `ALERT_JOB_RETENTION_DAYS` | `30` | 已完成/失败告警 RCA 历史保留天数 |

企微 Bot ID、Bot Secret、CloudAgent ID 和 API Key 不再放环境变量，全部在管理页面维护。

## Docker Compose 部署（推荐）

```bash
cp .env.example .env
# 编辑 .env 后执行
docker compose up -d --build
docker compose logs -f gateway
```

## Git 部署与一键更新（推荐）

代码仓库：`https://cnb.woa.com/buddy-op/wecom-cloudagent-gateway`

首次部署：

```bash
git clone https://cnb.woa.com/buddy-op/wecom-cloudagent-gateway.git ~/wecom-cloudagent
cd ~/wecom-cloudagent
cp .env.example .env
vim .env
./deploy.sh
```

后续每次发布新代码后，CVM 只需执行一个命令：

```bash
cd ~/wecom-cloudagent && ./deploy.sh
```

`deploy.sh` 会依次执行：

1. 从当前分支执行 `git pull --ff-only`。
2. 校验 Compose 配置。
3. 重新构建并更新容器，不主动删除 SQLite Volume。
4. 等待容器健康检查；失败时自动输出最近 120 行日志。

脚本检测到源码目录存在未提交修改时会停止，避免更新覆盖服务器上的临时改动。`.env`、SQLite、日志和构建产物均被 `.gitignore` 排除，不会上传到代码仓库。

从 ZIP 部署迁移到 Git 部署时，可保留当前容器和数据卷，只替换源码目录：

```bash
cd ~
mv wecom-cloudagent wecom-cloudagent-backup
git clone https://cnb.woa.com/buddy-op/wecom-cloudagent-gateway.git wecom-cloudagent
cp wecom-cloudagent-backup/.env wecom-cloudagent/.env
cd wecom-cloudagent
./deploy.sh
```

Compose 项目名固定为 `wecom-cloudagent`，因此迁移后仍会使用原来的 `wecom-cloudagent_gateway-data` 数据卷。确认配置和历史数据正常后，再决定是否保留源码备份目录。

Compose 默认监听 CVM 的全部网卡。浏览器直接打开 `http://<CVM内网IP>:3000/admin`，使用 `ADMIN_USERNAME` / `ADMIN_PASSWORD` 登录即可，不要求域名或 SSL 证书。

请在 CVM 安全组或主机防火墙中只允许可信内网网段访问 TCP 3000，不要把管理端口开放给整个公网。若跨不可信网络访问，再使用 HTTPS 反向代理或 SSH 隧道。

## 直接运行

```bash
npm ci --omit=dev
mkdir -p data
export ADMIN_PASSWORD='<管理密码>'
export SQLITE_PATH="$PWD/data/gateway.db"
npm start
```

## 页面配置顺序

1. 在 WorkBuddy 创建并发布企业智能体，取得 `agent_...` ID 和 API Key。
2. 在管理页“CloudAgent”区域新增配置，通常只填 Agent ID 和 API Key；点击“测试”确认 API Key 能看到该 Agent。
3. 在企业微信管理端把机器人连接方式改为“使用长连接”，取得 Bot ID 和 Secret。
4. 在管理页“Bot–Agent 配对”区域新增配对，填写 Bot ID/Secret，并选择唯一绑定的 CloudAgent。
5. 保存后观察连接状态变为 `authenticated`。
6. 在企业微信发送“你好”，再追问“我刚才问了什么”，确认复用同一 Session。
7. 发送 `/new`，确认创建新 Session。

## 告警 RCA 配置

1. 确认用于 RCA 的 CloudAgent 已绑定 CloudQ 等诊断技能，并使用最小权限凭据。
2. 在左侧“告警 RCA”新增配置，选择一个已有 Bot，填写腾讯云 `SecretId` / `SecretKey`、Namespace 和可选的策略 ID。
3. 保存后，页面会显示一次性绑定指令，例如 `/bind-alert A7K92F`。
4. 把所选 Bot 加入固定告警群，并在群里发送该绑定指令；Bot 会确认绑定并记录群聊 `chatid`。
5. 回到页面点击“测试推送”，确认长连接可以主动向该群发送 Markdown。
6. 点击“立即轮询”验证腾讯云 API 权限。之后服务按配置间隔自动轮询。

轮询使用腾讯云 `DescribeAlarmHistories` API。默认每 60 秒执行一次，并重叠查询最近 5 分钟；SQLite 使用 `配置 ID + AlarmId + AlarmStatus` 去重，所以重叠窗口不会重复执行 RCA。首次启用默认只回溯 10 分钟，避免一次性处理大量旧告警。

告警任务状态依次为：`queued → analyzing → delivery_pending → delivering → delivered`。诊断失败会标记 `failed`；主动推送失败会指数退避重试，页面支持手动重试。

当前版本默认只处理 `ALARM`。虽然高级配置可以同时查询 `OK`，但告警历史接口的时间范围基于首次发生时间，持续很久后才恢复的告警可能超出轮询窗口；对恢复通知有严格要求时应改用通知历史接口。

告警历史返回的数据通常比实时 Webhook 少。如果 RCA 必须获得完整阈值条件，可以在后续版本根据 `PolicyId` 再调用策略详情接口补全。

从 URL 回调切换成长连接后，应停用原 SCF 网关，避免同一个 Bot 存在两套接入方式。企业微信若发出 `disconnected_event`，通常说明同一 Bot 又建立了一条新连接。

## 会话行为

- 单聊：同一配对下的 `aibotid + userid` 共用一个 Session。
- 群聊“整个群共用”：同一配对下的 `aibotid + chatid` 共用一个 Session。
- 群聊“按用户隔离”：再加入 `userid` 进行隔离。
- 更新 CloudAgent 配置会提升配置 revision，后续消息使用新会话，避免旧 Runtime 继续引用旧配置。
- 把 Bot 改绑到另一个 Agent 后，后续消息使用新的会话命名空间。
- Runtime/Session 被平台回收时不会悄悄创建新会话，而是提示发送 `/new`。

## SQLite 与备份

数据库默认位于 `/data/gateway.db`，使用 WAL 模式。Docker 的 `gateway-data` volume 必须保留。

最稳妥的文件级备份方式：

```bash
docker compose stop gateway
docker run --rm -v wecom-cloudagent_gateway-data:/data -v "$PWD":/backup alpine \
  cp /data/gateway.db /backup/gateway-$(date +%F).db
docker compose start gateway
```

网关重启时会保留所有已建立的 Session 映射。为避免对具有写操作能力的 Agent 重复提交，重启前尚未完成的任务会标记失败，不自动重放；用户可重新发送消息。

从使用 `CONFIG_ENCRYPTION_KEY` 的旧版本升级时，首次启动可临时保留原密钥。服务读取旧配置后会自动把对应密钥迁移为明文；确认所有 Bot 和 Agent 均已使用一次后即可删除该环境变量。也可以直接在管理页重新填写 Bot Secret 和 API Key。

## 代码结构

```text
server.js                 HTTP 管理页/API、健康检查与进程生命周期
src/admin-page.js         无外部前端依赖的配置页面
src/bot-manager.js        多 Bot WebSocket 连接、认证、重连与热同步
src/gateway.js            企业微信消息解析、幂等与任务入队
src/monitor-client.js     腾讯云 API v3 签名与告警历史查询
src/alert-poller.js       多配置告警轮询、时间窗口和分页
src/alert-store.js        告警配置、群绑定、去重任务和历史
src/alert-worker.js       独立 Agent RCA 与长连接主动推送
src/registry.js           Bot/Agent 配置、唯一配对与敏感字段隐藏
src/database.js           SQLite 初始化与 schema
src/store.js              Session/任务持久化
src/scheduler.js          按会话串行调度
src/worker.js             CloudAgent 执行与企业微信流式回复
src/cloudagent.js         Runtime、Agent Session 与 ACP 适配
```

## 运维与安全

- `/healthz` 提供不含密钥的健康信息；`/admin` 和 `/api/admin/*` 使用 HTTP Basic Auth。
- 管理页面可以通过 CVM 内网 IP + HTTP 使用；跨不可信网络时再配置 HTTPS 或 SSH 隧道。
- HTTP Basic Auth 和页面提交的数据在普通 HTTP 中不会被传输加密，因此必须通过安全组把 3000 端口限制在可信内网。
- SQLite 内的 Bot Secret、CloudAgent API Key、腾讯云 SecretId/SecretKey 为明文，请限制数据库文件权限并保护备份。
- 不要在日志中输出 Bot Secret、API Key、ACP Token 或完整用户消息。
- 任务完成或失败后会立即清除 SQLite 中的原始企微消息和回调帧，只短期保留回复与幂等状态。
- SDK 收到认证失败时会在页面显示 `error` 状态；网络中断时自动指数退避重连。
- 对 `wecom_connection_error`、`cloudagent_task_failed`、`alert_job_failed`、`alert_poll_tick_failed`、`gateway_start_failed` 配置日志告警。
- SDK 的 `session.prompt()` 结束后会主动断开 ACP SSE，避免遗留连接。
- 删除仍被 Bot 配对引用的 CloudAgent 会被拒绝，需先调整或删除对应 Bot。

## 测试与打包

```bash
npm test
npm run package
```

生成文件：`dist/wecom-cloudagent-cvm.zip`。
