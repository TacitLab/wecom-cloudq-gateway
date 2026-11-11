# 企业微信 Bot ↔ WorkBuddy Managed Agents：CVM 长连接网关

这是一个部署在 CVM/IDC 的常驻 Node.js 服务。它使用企业微信智能机器人的 WebSocket 长连接接收对话并主动发送告警通知，通过 WorkBuddy Enterprise Managed Agents（WMA）腾讯云 API 3.0 / ACP 执行 Agent；同时可以定时轮询腾讯云可观测平台的告警历史，自动执行 RCA 并推送到固定企业微信群。

## 配对模型

- 网关可以管理多组企业微信 Bot 和 WMA Agent 配置。
- 每个企业微信 Bot 只能绑定一个 WMA Agent。
- 同一个 WMA Agent 配置可以被多个 Bot 复用。
- 管理员在 Web 页面修改配对后，新消息立即进入新 Agent。
- 配对或 Agent 版本会进入会话键，换绑不会误用旧 Agent 的 Session。
- Bot 配对中的“显示思考过程”默认勾选（已有 Bot 也保持开启）。取消勾选后，对话和告警 RCA 只推送最终回复，处理中保留占位提示，不展示 Agent 执行过程。

用户不需要选择 Agent。单聊默认按 `Bot + 用户` 复用 Session，群聊默认按 `Bot + 群` 复用 Session；只有发送严格匹配的 `/new` 才创建新 Session。群聊中企业微信回调可能保留 `@Bot` 前缀，`@Bot /new` 会被网关归一化为同一指令。

发送 `/stop`（群聊可发送 `@Bot /stop`）会取消当前正在执行的 Agent 任务并清理该会话的排队消息，但保留现有 Session 上下文。“告警 RCA”页面也提供独立的“暂停/启用”按钮；暂停只影响后续自动轮询，已进入诊断或推送阶段的任务会继续完成。

### HTML 文件附件

用户可以在 Bot 对话中要求“生成一个 HTML 周报，以 HTML 附件发给我”，也可以在告警 RCA 自定义诊断 prompt 中要求“先输出简报，再输出完整 HTML 报告”。网关会引导 WMA Agent 输出完整 HTML 源码，将源码转换成 UTF-8 `.html` 文件，上传企微临时素材。普通对话回复到原对话；告警 RCA 先推送简报，再将附件主动发送到绑定群。HTML 源码不占用聊天文本字节限额。无需配置网页托管，也无需修改管理前端。

交付协议为最终回复中的专用代码块：

````text
```wecom-html filename="周报.html"
<!DOCTYPE html>
<html lang="zh-CN"><head><meta charset="UTF-8"><title>周报</title></head><body>周报内容</body></html>
```
````

网关自动追加此协议到普通对话和告警诊断请求中；要求交付 HTML 时也兼容标准 `html` 代码块，普通问答中的 HTML 示例仍保留为文本。每轮最多 5 个附件，HTML 源码总计最多 5 MiB，文件仍受模型输出长度限制；仅发送完整文档和正常结束任务的结果。CSS、JavaScript 应内嵌，沙箱本地图片等资源不会自动打包。

当用户要求 HTML，但 Agent 只返回“报告已生成”、路径或总结时，网关会在同一 Session 内追加一次导出请求，要求读取已有报告并回传完整源码。仍未取得完整 HTML 时，会明确提示附件未发送并标记任务失败。告警附件会先去除运行时诊断凭证，再保存到 SQLite；发送失败或服务重启后继续重试未发送的附件，不重复已成功发送的附件和完整简报。附件随告警历史一同清理。日志 `alert_html_result` 记录附件数量和异常提示数量，不记录源码。

升级后，旧版已完成但缺少 HTML 的告警任务不会自动补发；在管理台点击“重试”会重新诊断并生成附件。用户向 Bot 上传文件和图片尚未接入。

告警 RCA 配置选择一个已有 Bot，自动使用该 Bot 当前绑定的 WMA Agent。每条新告警创建独立 WMA Session，不会污染员工的聊天上下文。

## 架构

```text
企业微信 Bot ──WebSocket 对话/主动推送──┐
                                       ├── CVM 网关 ── WMA 云 API/ACP ── WorkBuddy Managed Agents
腾讯云告警历史 API ──定时轮询───────────┘       │
                                               └── SQLite（配置、Session、告警去重、任务）
```

不再需要公网回调 URL、SCF 自调用、Redis 或额外的配置加密密钥。Bot Secret 和 WMA AK/SK 直接保存在本机 SQLite 中，管理页面和管理 API 不会回显明文。请通过文件权限和主机访问控制保护数据库。

## 网络要求

服务不需要入站公网端口，但 IDC 必须允许以下出站访问：

- `wss://openws.work.weixin.qq.com:443`（企业微信长连接；私有部署企业以管理端显示地址为准）
- `https://monitor.tencentcloudapi.com:443`（云产品监控、APM 告警策略与历史）
- `https://cls.tencentcloudapi.com:443`（CLS 日志告警策略与历史，使用 CLS 来源时需要）
- `https://workbuddyenterprise.tencentcloudapi.com:443`（WMA 云 API，TC3 签名）
- WMA 返回的 `*.ma.workbuddy.cn:443` 等 ACP 地址
- 正常 DNS 解析

如果 IDC 完全不能访问公网，长连接和 WMA Agent 都无法工作，需要先配置企业代理、专线或出口白名单。

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

企微 Bot ID、Bot Secret、WMA Agent ID 和 AK/SK 不再放环境变量，全部在管理页面维护。

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

1. 在腾讯云 WMA 创建并发布 Agent，配置可用版本路由并开启公网 API 访问。在 [腾讯云 API 密钥管理](https://console.cloud.tencent.com/cam/capi) 准备具备 WMA 访问权限的 `SecretId` / `SecretKey`；凭证对应账号需关联企业身份。无需另建 WorkBuddy API Key，也无需手动填写企业 ID。
2. 在管理页“WMA 凭证设置”新增名称、SecretId（AK）、SecretKey（SK）。默认 API 接入地域是 `ap-guangzhou`，可在高级配置修改。点击“测试”只查询该凭证可见的 WMA Agent，不创建会话。编辑时密钥留空表示保留原值；页面只显示掩码。
3. 在“WMA Agent”新增配置：选择 WMA 凭证 → 自动拉取列表 → 选择 Agent → 保存。支持刷新、搜索和已添加标记。切换凭证会清空旧选择；保存时再次检查 Agent。WMA ID 按字符串处理，支持 ULID 和数字字符串。
4. 在管理页“企业微信 Bot 配对”区域新增配对，二选一：
   - **扫码创建（推荐）**：选择“扫码创建”标签页，生成二维码后用企业微信扫码确认“一键创建机器人”，网关自动取得 Bot ID/Secret 并完成配对（Secret 只保存在服务端）。扫码来源标识通过 `WECOM_PAIRING_SOURCE` 配置，未设置时回退 `wecom_cli_external`，生产环境应向企业微信申请正式来源标识。
   - **绑定已有机器人**：在企业微信管理端把机器人连接方式改为“使用长连接”，取得 Bot ID 和 Secret 后手动填写。
5. 保存后观察连接状态变为 `authenticated`。
7. 在企业微信发送“你好”，再追问“我刚才问了什么”，确认复用同一 Session。
8. 发送 `/new`，确认创建新 Session。

### WMA 存储与升级

本分支只支持腾讯云 AK/SK 接入 WMA。凭证、Agent、聊天 Session 和任务分别存入新表 `wma_credentials`、`wma_agents`、`wma_conversations`、`wma_tasks`。没有旧 CloudAgent SDK、WorkBuddy API Key、provider 路由、启动 Manifest 或本地 Runtime ID 兼容路径。

旧 `api_keys`、`cloud_agents`、`conversations`、`tasks` 表不读取、不迁移，可保留在数据库内作为旧数据留存。新安装不会创建这些表。升级到本分支后，需要重新录入 WMA AK/SK，并从列表选择 Agent。

**Bot 与告警配置保留。** 首次启动会执行一次性 Bot 绑定结构切换：保留 Bot ID、Secret、开关和会话设置，解除旧 Agent 绑定；保留告警策略、诊断模板、凭证引用和群绑定。旧 Agent 相关的未完成告警任务标记失败，避免误用新 Agent 继续执行。切换过程在事务内校验外键，重新启动不会重复解绑已经绑定的 WMA Agent。

未绑定 WMA Agent 的 Bot 不建立长连接，页面显示“待绑定 WMA Agent”；其关联告警保留启用设置，但跳过自动轮询。管理员新增 WMA Agent 后，编辑原 Bot 完成绑定即可恢复，不必重录机器人凭据或重新绑定告警群。发布前请备份 SQLite 数据库。

WMA 按平台版本路由加载提示词与技能，网关使用腾讯云 API 3.0（`2026-07-09`）与 ACP SSE 对话。每个聊天只复用自己保存的 Session，AK/SK 或地域变更会轮换相关 Agent 的会话命名空间。会话创建和失败对话均不会自动重试；`/new` 和独立告警会创建新托管会话，关闭连接不会销毁会话，运行资源可能持续计费。

接口依据：[ADK & API](https://cloud.tencent.com/document/product/1831/140287)、[Agent 列表](https://cloud.tencent.com/document/api/1831/138576)、[会话详情](https://cloud.tencent.com/document/api/1831/138629)、[官方接入说明](https://cloud.tencent.com/document/product/1831/140759)。

## 告警 RCA 配置

1. 确认用于 RCA 的 WMA Agent 已绑定 CloudQ 等诊断技能，并使用最小权限凭据。
2. 在左侧“腾讯云凭证”录入并测试 `SecretId` / `SecretKey`；创建告警 RCA 配置必须先有可用凭证。
3. 在“告警 RCA”新增配置，按四步完成设置：
   - **告警来源**：选择云产品监控、应用性能监控 APM 或日志服务 CLS，再选择腾讯云凭证和告警所在地域。每条配置对应一种来源；切换来源、凭证或地域会清空旧策略选择。
   - **监控范围**：选择“指定告警策略”（至少选择一个，最多 100 个），或明确选择“全部符合条件的策略”。全部范围会包含以后新增的策略；云产品监控和 APM 还可以按策略类型缩小范围。留空策略类型表示全部类型，不会隐式限定到 CVM。编辑旧配置时保留原有 CVM 等类型过滤。
   - **诊断与推送**：填写配置名称、选择已有 Bot、设置轮询间隔，配置自动轮询与 CloudQ 诊断凭证。首次回溯、重叠窗口、自定义 Prompt 和恢复状态放在高级配置中。
   - **确认配置**：最后统一核对来源、查询凭证、地域、策略范围、执行 Bot/Agent、群绑定、诊断凭证及高级设置；支持返回对应步骤修改，确认后才保存。凭证只显示名称。
4. 保存后，页面会显示一次性绑定指令，例如 `/bind-alert A7K92F`。
5. 把所选 Bot 加入固定告警群，在群里 @该机器人后发送绑定指令（例如 `@多云管理 AIOPS agent /bind-alert A7K92F`）；Bot 会确认绑定并记录群聊 `chatid`。企业微信中的显示名称可以包含空格，也无需与网关配置名称一致；绑定码必须属于当前接收消息的 Bot。
6. 回到页面点击“测试推送”，确认长连接可以主动向该群发送 Markdown。
7. 点击“立即轮询”验证腾讯云 API 权限。之后服务按配置间隔自动轮询。

“复制指令”优先使用浏览器 Clipboard API，并兼容普通 HTTP 环境的选中文本复制。若浏览器禁止两种自动复制方式，会弹出已选中的指令，支持快捷键或长按手动复制。复制只在浏览器本地执行，不会发起网络请求。

云产品监控和 APM 分别使用 `MT_QCE`、`MT_TAW`，通过 Monitor 的 `DescribeAlarmPolicies` 获取策略、`DescribeAlarmHistories` 获取历史；策略列表和轮询均按来源过滤，指定策略后仍保留来源过滤。

CLS 使用 `cls.tencentcloudapi.com`（版本 `2020-10-16`），通过 `DescribeAlarms` 获取策略、`DescribeAlertRecordHistory` 获取历史。凭证需额外具备 `cls:DescribeAlarms` 和 `cls:DescribeAlertRecordHistory` 读取权限。配置中 `MT_CLS` 是本服务用于来源路由的标识，不会作为 Monitor 参数发送。CLS 历史的 `RecordId` 用作告警事件 ID，`AlarmId` 用作策略 ID；毫秒时间、告警状态、日志主题和触发条件会转换为统一 RCA 字段，并保留原始记录供诊断使用。

默认每 60 秒执行一次，并重叠查询最近 5 分钟；SQLite 使用 `配置 ID + AlarmId + AlarmStatus` 去重，所以重叠窗口不会重复执行 RCA。首次启用默认只回溯 10 分钟，避免一次性处理大量旧告警。更改来源、凭证、地域或策略范围后会重置轮询游标，按首次回溯窗口重新查询；更换执行 Bot 后会解除旧群绑定，需要用新 Bot 重新绑定。

告警任务状态依次为：`queued → analyzing → delivery_pending → delivering → delivered`。诊断失败会标记 `failed`；主动推送失败会指数退避重试，页面支持手动重试。

当前版本默认只处理 `ALARM`。虽然高级配置可以同时查询 `OK`，但告警历史接口的时间范围基于首次发生时间，持续很久后才恢复的告警可能超出轮询窗口；对恢复通知有严格要求时应改用通知历史接口。

告警历史返回的数据通常比实时 Webhook 少。如果 RCA 必须获得完整阈值条件，可以在后续版本根据 `PolicyId` 再调用策略详情接口补全。

“自定义诊断 Prompt”会直接显示后端使用的系统默认模板，可在其基础上编辑，也可点击“恢复默认”。未修改时只保存默认模式，后续继续使用系统默认模板；已有自定义内容不会被覆盖。悬停、聚焦或点击旁边的问号可查看全部变量、当前来源的字段说明和填写示例。

云产品监控、APM、CLS 共用一套模板变量名，运行时内容随来源变化，缺失字段为空。原有 `{{alarm_json}}`、`{{alarm_id}}`、`{{alarm_object}}`、`{{alarm_content}}`、`{{policy_name}}`、`{{region}}` 保持兼容；另外支持默认模板中使用的来源、状态、策略 ID、策略类型、时间、维度、指标和原始 JSON 等变量，完整清单见页面提示。CLS 的 `{{alarm_id}}` 对应事件 `RecordId`，`{{policy_id}}` 对应策略 `AlarmId`；`{{raw_json}}` 保留日志主题和触发条件等来源特有字段。模板只支持 `{{变量名}}` 替换，不支持点路径表达式；APM 未返回的应用 ID、Trace ID 不会自动补全。

“诊断与推送”步骤在“启用自动轮询”上方提供 **CloudQ 诊断凭证（可选）**，无需展开高级配置，也不依赖是否修改 Prompt，可独立选择“腾讯云凭证”中已保存的条目，与拉取告警使用的凭证分开。默认不嵌入，继续使用 Agent 已有环境。选择后，每次诊断开始时读取该凭证的最新值，在实际发送给 WMA Agent 的 Prompt 末尾追加运行时配置，要求 Agent 将 `TENCENTCLOUD_SECRET_ID`、`TENCENTCLOUD_SECRET_KEY` 和当前配置地域 `TENCENTCLOUD_REGION` 传入执行 CloudQ 的进程环境。此方式依赖 Agent 按技能说明设置并使用环境变量，不会直接改变网关或云端沙箱的全局环境。

页面、默认模板及模板变量接口不会返回追加的凭证正文；SQLite 的配置只保存诊断凭证引用。告警任务的 Prompt 只保存诊断正文和“运行时已注入”的标记，不保存追加的凭证块。带凭证的诊断使用独立适配器，并在结果、错误和本地日志写入前遮盖已知 SecretId/SecretKey（包括常见 JSON/URL/base64 编码形式）。这些措施不控制 WMA Agent 云端会话和技能内部的记录；真实凭证会随请求发送给所选 WMA Agent，可能保留在云端会话中。轮换凭证后新诊断自动使用最新值；被诊断配置引用的凭证不可删除，先取消选择或更换引用即可。

从 URL 回调切换成长连接后，应停用原 SCF 网关，避免同一个 Bot 存在两套接入方式。企业微信若发出 `disconnected_event`，通常说明同一 Bot 又建立了一条新连接。

## 会话行为

- 单聊：同一配对下的 `aibotid + userid` 共用一个 Session。
- 群聊“整个群共用”：同一配对下的 `aibotid + chatid` 共用一个 Session。
- 群聊“按用户隔离”：再加入 `userid` 进行隔离。
- 更新 WMA Agent 配置会提升配置 revision，后续消息使用新会话，后续使用新配置创建会话。
- 把 Bot 改绑到另一个 Agent 后，后续消息使用新的会话命名空间。
- Session 已失效或被归档时不会悄悄创建新会话，而是提示发送 `/new`。

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
src/registry.js           WMA AK/SK 凭证、Bot/Agent 配置、唯一配对与敏感字段隐藏
src/database.js           SQLite 初始化与 schema
src/store.js              Session/任务持久化
src/scheduler.js          按会话串行调度
src/worker.js             WMA Agent 执行与企业微信流式回复
src/agent.js              WMA Agent 适配与回复处理
src/prepare-wma-storage.js 一次性保留 Bot/告警配置并解除旧 Agent 绑定
src/wma.js                WMA 腾讯云 API、托管 Session、token 缓存与 ACP SSE 对话
```

## 运维与安全

- `/healthz` 提供不含密钥的健康信息；`/admin` 和 `/api/admin/*` 使用 HTTP Basic Auth。
- 管理页面可以通过 CVM 内网 IP + HTTP 使用；跨不可信网络时再配置 HTTPS 或 SSH 隧道。
- HTTP Basic Auth 和页面提交的数据在普通 HTTP 中不会被传输加密，因此必须通过安全组把 3000 端口限制在可信内网。
- SQLite 内的 Bot Secret、WMA 凭证、腾讯云 SecretId/SecretKey 为明文，请限制数据库文件权限并保护备份。
- 不要在日志中输出 Bot Secret、AK/SK、ACP Token 或完整用户消息。
- 任务完成或失败后会立即清除 SQLite 中的原始企微消息和回调帧，只短期保留回复与幂等状态。
- SDK 收到认证失败时会在页面显示 `error` 状态；网络中断时自动指数退避重连。
- 对 `wecom_connection_error`、`wma_task_failed`、`alert_job_failed`、`alert_poll_tick_failed`、`gateway_start_failed` 配置日志告警。
- SDK 的 `session.prompt()` 结束后会主动断开 ACP SSE，避免遗留连接。
- 删除仍被 Bot 配对引用的 WMA Agent 会被拒绝，需先调整或删除对应 Bot。

## 测试与打包

```bash
npm test
npm run package
```

生成文件：`dist/wecom-cloudagent-cvm.zip`。
