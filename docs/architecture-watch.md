# 架构值守

在管理台「应用能力 → 架构值守」点击「添加架构图」，选择已有腾讯云凭证，按名称关键字搜索或分页浏览，选中一张架构图后添加。名称支持包含匹配并忽略英文大小写，例如搜索「广州」可匹配「广州CVM核心」。未配置凭证时，页面提供凭证管理入口。新增不依赖 Bot 或 WMA Agent。

点击架构图所在行进入详情页，支持浏览器返回、刷新和详情深链 `#architecture-watches/{配置ID}`。顶部合并展示资源总数与产品分布环图、紧凑地域地图与地域数，以及值守状态和快捷开关。地图自动根据资源所在城市拟合范围，单一地域会放大显示，点位及地域名称保持固定可读尺寸；不显示地域筛选条和底部说明。快捷开关只改变已保存配置的启用状态，保留产品范围、群绑定和持续提醒进度；尚未配置时引导到值守设置。

「架构图」页仅保留左侧原图与右侧节点详情两个内容块，不显示顶部说明行、节点下拉框或全量资源/容量表。2D/3D、放大、缩小、适应画布和刷新按钮悬浮在原图左上角。点击原图节点后，右侧显示该节点对应的资源、每个资源的容量监测指标和产品告警。地域/可用区容器节点汇总其子节点，资源按云厂商、产品、地域、资源 ID 去重。节点详情在服务端再次校验架构图及节点绑定范围。告警读取近 30 天首次发生且未恢复的记录，以及近 24 小时首次发生的其他记录；按资源 ID 精确核对返回项。每类最多读取 500 条，达到上限或读取失败会明确提示。接口依据[腾讯云查询告警历史文档](https://cloud.tencent.com/document/api/248/48684)，使用非零起始时间，避免云端对零时间戳查询返回内部错误。

原始 SVG 调用 `DescribeArchSvgData`，支持 2D/3D 切换、缩放和刷新，默认 3D。视图切换使用腾讯云官方导出流程的 `IsThreeDimension` 参数（2D 为 `false`，3D 为 `true`），两份原图独立缓存，刷新会使两份缓存失效。鼠标拖动（含从节点处起拖）可无边界平移，滚轮围绕指针缩放；拖动不会误触节点选择。背景沿用云端原生网格并随视口延展，不出现固定画布边界。适应画布按钮或键盘 `0` 会复位，方向键可平移，`+`/`-` 可缩放。交互画布在无同源权限的 sandbox iframe 中展示，移除脚本和事件属性，禁止云图发起网络请求，保留原始形状、坐标和标签；只对 `DescribeArch` 返回的 DiagramId 添加选择交互和选中边框。父页面核对消息来源与节点白名单，2D/3D 切换保留选中节点。不重绘架构，原图不可读时展示错误。右上角可直达腾讯云页面。

RCA Prompt 会声明本次分析所依据的架构图名称、ID 和腾讯云链接，并要求分析结果开头注明该架构图。事件通知、恢复通知、测试推送以及每条 RCA 分段消息都包含架构图名称、ID 和链接。长结果为架构标识预留消息字节空间；发送分段在首次推送前保存，重试复用同一份分段，从未成功发送的位置继续，不重复执行 RCA。升级前已发送部分结果的事件只转换尚未发送的正文。

值守设置分为「统一值守设置」和两类独立的监测范围：「云资源监测」与「APM 应用告警」。统一设置中的时间、推送群与 RCA 对两类来源共同生效。云资源表格仅控制对应产品，不影响 APM 应用。容量规则、RCA 环境说明与 APM 策略详情默认折叠；产品及应用名称旁显示图标以区分监测对象。

在云资源表格中点击「资源范围」打开弹窗，选择当前产品的资源；可输入 ID 或勾选绑定资源，留空表示全部。取消不改动表单，应用后仍需保存值守设置才持久化。

移除只删除本地配置及其值守设置、历史，保留腾讯云原图。被配置引用的腾讯云凭证和推送 Bot 必须先解除引用才能删除。

## 启用值守

1. 打开详情页「值守设置」。在「云资源监测」中按产品选择资源范围、纳入值守、告警推送及容量监测；默认全天、每 60 秒读取一次。
2. 选择推送 Bot，按需开启 RCA。RCA 使用该 Bot 当前绑定的 WMA Agent 及其使用版本和运行环境；需要云资源凭证时，在 WMA Agent 中创建并选择凭证注入版，不再在 RCA 中单独选择或通过 Prompt 追加凭证。
3. 保存设置。将所选 Bot 加入目标企业微信群，在群里 @Bot 并发送页面给出的 `/bind-watch {绑定码}`。
4. 在顶部概览开启架构值守；已开启、已绑定群且处于值守时段时开始检查。可点击「测试群推送」和「立即检查」，在「历史记录」查看结果。

可设置北京时间下的星期、起止时间（支持跨午夜）、读取间隔 30–3600 秒，以及各产品的资源 ID 范围。空范围代表该产品全部绑定资源。容量的指标、算法、阈值和分析周期完全沿用智能顾问，本地没有 CPU/内存阈值或连续采样设置；旧版保存的相关字段不再读取或生效。

产品开关控制资源状态检查和事件推送范围。告警查询覆盖架构图全部腾讯云绑定资源，不受容量是否支持、容量开关或推送范围影响；按地域分页读取近 30 天首次发生的云监控告警，不额外限制监控类型或告警状态，再按资源 ID 精确匹配。当前未恢复告警可在值守开启后被发现；恢复仅对值守时段内新恢复或此前已通知且现已确认恢复的告警生成事件。推送与 RCA 仍严格遵循产品告警开关和指定资源范围，不对账号内其他资源推送。

## 刷新容量监测数据

接口契约依据用户提供的 `capacity2` HAR 抓包，并通过 AK/SK 对同一张架构图验证。页面读取最新数据的流程是：

1. `DescribeArchThresholdConfigStatusV2`：`{ MapId }`，读取云端 `AnalysisDay`。
2. `UpdateNodeResourceCapacityMetricV2`：`{ MapId, SessionId, Source: 1, Period: AnalysisDay }`，刷新监测数据，返回 `CapacityAsyncId`。不修改指标、算法或阈值，不使用本地默认周期覆盖云端配置。
3. `DescribeNodeLoadInfoV2New`：`{ MapId, SessionId, TaskId: CapacityAsyncId, Mode: "monitor" }`，轮询本次任务。
4. 对本次已完成节点调用 `DescribeNodeResourceLoadInfoV2New`：`{ MapId, NodeUuid: NodeId, TaskId: CapacityAsyncId }`。核对节点任务 ID，不回退到上次成功任务。
5. 从 `ResourceLoadRiskInfos` 中按 `InsId`、`Region` 匹配当前架构图绑定资源，读取实例 `RiskLevel` 和 `MetricValueList[].MetricRiskLevel`。保留云端 `Value`、`Period`、`RiskDurationList` 和 `LatestUpdateTime` 作为证据。

同一架构图的值守检查与节点详情共用正在执行的刷新任务，完成后 30 秒内复用，未完成则继续查询同一任务，避免并发反复刷新。刷新失败、任务未完成或返回任务 ID 不匹配时，不拿旧任务结果顶替。云端没有返回有效分析周期时提示配置问题，不自行选周期。

等级 `3` 是高负载，`2` 是中负载；中负载不当作高负载推送。多个节点绑定同一实例时按产品、地域、实例 ID、指标去重，保留最严重的云端判定。未完成、不支持、未知等级、读取失败均不推断为健康，也不生成恢复事件。缺少有效指标与旧时间戳分别提示，不将不支持的资源误报为报告过期。

抓包中的 `DescribeInsResourceRealTimeInfoV2` 返回实例名称、IP、地域等实例信息；`DescribeCapacityMetricInfoV2New` 与 `DescribeInsCapacityMetricDataV2New` 返回云端容量配置和按周期计算的指标曲线。容量页展示值仍采用云端配置的周期与算法，不能称为秒级瞬时 CPU/内存利用率。网关不调用 `GetMonitorData`，不自行采样或重新实现阈值算法。

检查提示以顶部悬浮通知展示，6 秒后自动关闭，可手动关闭或跳转历史记录；相同提示不会随轮询重复出现。完整提示和错误仍保存在检查历史中。

## 关联 APM 应用

在「值守设置 → APM 应用告警」点击「添加 APM 应用」，选择业务系统后勾选应用，可跨业务系统、跨地域多选，最多 100 个。使用当前架构图的腾讯云凭证；关联保存在网关本地，不修改腾讯云架构图或告警策略。保存后共用本架构的值守时段、间隔、推送 Bot、群和 RCA 开关。也支持仅选择 APM 应用、关闭所有云产品值守。

选择应用后自动预览相关告警策略，包含启用、停用和范围待核对的配置，可展开查看完整筛选条件、触发条件和聚合维度。每次值守检查重新发现策略，所以新建、修改和删除策略会自动反映在下一次结果中。匹配依据为地域、业务系统 ID 和应用名，不通过策略名称猜测；识别指定应用、多应用及全业务系统策略，同时处理全局与单条规则的维度条件。接口/实例等附加条件标为条件覆盖；表达式、正则等尚不能可靠求值的条件标为待核对，结果不宣称完整。`GroupBy` 仅表示告警聚合维度，不用于判断应用归属。

APM 业务系统通过 `apm:DescribeApmInstances` 读取，应用通过 `apm:DescribeTagValues` 查询近 7 天 `service.name` 维度（`Type: agentConfig`）。已保存的关联不会因应用暂时没有上报而自动移除。保存新增应用时服务端重新校验可访问业务系统、地域和应用；浏览器传来的显示名不作为可信依据。实测 `DescribeApmServiceMetric` 可在有应用的系统中返回空列表，因此未将其用作选择器来源。业务系统接口携带的上报 Token 不返回浏览器。

策略使用 `monitor:DescribeAlarmPolicies` 分页读取 `MT_TAW`，保留启用和停用配置，并包含全部对象策略；告警使用 `monitor:DescribeAlarmHistories` 读取近 30 天首次发生的 APM 告警。分页先按原始行数检查完整性，再按告警 ID 去重，保留最新状态，避免重复通知记录使分页误判。发生历史可能来自已修改或删除的策略，因此不会仅凭当前策略 ID 列表过滤历史。

告警按 `InternalDimensions`、`Dimensions` 或带明确字段标签的 `AlarmObject` 中的业务系统 ID 与应用名精确匹配。业务系统显示名不替代 ID；同名应用、其他业务系统及其他地域不会自动归入所选应用。共享策略的事件需再次确认应用归属；跨应用聚合或字段缺失的事件不自动推送，检查记录会报告待核对数量。查询失败、分页不完整不会显示为“无告警”。

匹配事件进入已有架构事件队列，按架构和告警 ID/状态去重；通知包含 APM 应用和业务系统，RCA 包含架构与应用上下文。恢复事件仅通知。历史记录增加每个应用的策略列表、查询状态、未恢复/总告警数及归属待核对数量。APM 查询独立于 Advisor 资源详情读取，Advisor 失败仍会尝试已配置的 APM 应用检查。

额外读取权限：`apm:DescribeApmInstances`、`apm:DescribeTagValues`、`monitor:DescribeAlarmPolicies`、`monitor:DescribeAlarmHistories`。发现范围以该凭证可访问的配置为限。

接口依据：[告警策略列表](https://cloud.tencent.com/document/product/248/51279)、[策略数据结构](https://cloud.tencent.com/document/api/248/30354)、[应用维度列表](https://cloud.tencent.com/document/api/1463/105645)。2026-11-23 已使用项目现有凭证只读验证单应用、多应用、业务系统全应用策略，以及真实 APM 告警的 `InternalDimensions` 与两种业务系统显示形式。

## 持续高负载提醒

同一资源同一指标的高负载首次发现即生成事件。以本地首次发现该高负载判定的时刻为起点，在持续确认高负载达到 **1 小时、6 小时、1 天、3 天、1 周** 时各提醒一次，此后每周一次。这些是累计持续时长，并非从上一条通知再加相同时长。

每次只生成当前到期的一条提醒，不补发错过的所有阶段。两次实际高负载通知至少间隔 1 小时；待发送通知会抑制新通知，发送重试耗尽后可在下一提醒阶段重新提醒。新鲜的低于高负载等级判定会记录恢复并重置周期；未被任何人收到的首次事件恢复时不额外播报。快速再次高负载会取消旧恢复通知，避免随后推送过时的「已恢复」。

提醒状态保存在 SQLite，不依赖内存定时器；网关重启和普通设置保存不会重置提醒阶段。换 Bot 或解除群绑定会重置容量提醒状态。旧报告、乱序报告、未完成任务不会消费提醒阶段或被当作恢复。消息会注明「高负载判定仍存在」、云端结果时间与分析周期，不声称实时水位连续超限。

事件通知与 RCA 队列独立执行：事件先成功推送后才进入 RCA。恢复事件仅推送恢复通知。RCA 只读分析，不自动修复。推送失败最多自动退避重试 5 次；已生成的 RCA 结果会复用，推送重试从未发送的文本分段继续。分析失败或重启中断可在历史中手动重试。关闭值守或修改配置会取消旧配置下未完成的事件；容量恢复后也会取消过时的待发送高负载通知和分析。

每次检查单独保存告警覆盖资源总数、成功查询资源数、请求次数、匹配告警数、未恢复告警数，以及每个资源的查询状态、告警数量与推送开关。容量无结果不会阻止该资源的告警查询；失败或分页不完整不会计为成功或显示为“无告警”。历史检查摘要和展开明细可查看这些统计；旧记录不补造告警统计。

检查结果、事件、提醒阶段、推送状态和 RCA 结果均持久化；保留最近 30 天已完成历史与检查记录。

地域地图使用本地 Natural Earth 公共领域陆地轮廓，点位为地域所在城市的近似坐标，不是机房位置；资源信息不发送给地图服务。架构图直接使用腾讯云原始 SVG，保留原有布局与图形。

## 腾讯云接口

2026-11-20 已使用项目现有凭证直接请求腾讯云，验证以下接口。控制台对应入口为 <https://console.cloud.tencent.com/advisor/directory>。

统一使用腾讯云 API 3.0 TC3-HMAC-SHA256 签名：`POST https://advisor.tencentcloudapi.com`，签名服务 `advisor`，`X-TC-Version: 2020-07-21`。架构图查询不要求地域。本功能复用「腾讯云凭证」中的 AK/SK，在服务端签名，浏览器只提交凭证配置 ID。

| Action | 实测请求参数 | 实测响应字段 | 本阶段用途 |
| --- | --- | --- | --- |
| `DescribeArchList` | `PageNumber`、`PageSize`；`ArchName` 为完整名称匹配，本功能不传此参数 | `ArchList`、`TotalCount`、`RequestId` | 分页查询可访问架构图，关键字由网关匹配 |
| `DescribeArch` | `ArchId`、`Username`（本应用固定 `cloudq-gateway`） | `Arch`、`RequestId` | 添加前重新校验访问权限，从云端读取名称、描述和版本 |
| `DescribeArchSvgData` | `ArchId`、`IsThreeDimension` | `ArchId`、`Svg` | 按官方视图参数读取 2D/3D 原始 SVG |
| `DescribeArchThresholdConfigStatusV2` | `MapId` | `AnalysisDay`、`ProductInfos` | 读取云端现有分析周期 |
| `UpdateNodeResourceCapacityMetricV2` | `MapId`、`SessionId`、`Source: 1`、云端 `Period` | `CapacityAsyncId`、`MapId` | 刷新容量监测数据 |
| `DescribeNodeLoadInfoV2New` | `MapId`、`SessionId`、本次 `TaskId`、`Mode: "monitor"` | `NodeLoadRiskInfos`、`IsFinish`、`FinishTime` | 读取本次容量节点判定 |
| `DescribeNodeResourceLoadInfoV2New` | `MapId`、`NodeUuid`、`TaskId` | `ResourceLoadRiskInfos`、`LatestUpdateTime` | 读取实例负载、指标等级及分析周期 |
| `DescribeArchResources` | `ArchId` | `ArchNodeList`、`ArchId`、`RequestId` | 获取节点实际绑定资源名称、状态及扩展信息 |
| `ListDirectoryV2` | `{}` | `FirstFolderId`、`Folders`、`RequestId` | 已验证可读取目录，本阶段选择器直接使用架构图列表，无需调用 |

`DescribeArchList.ArchList[]` 包含 `ArchId`、`ArchName`、可选 `Description`、`VersionName`、`UpdateTime` 等字段。`DescribeArch.Arch` 包含相同基础信息和 `Detail`、`NodeList` 等详情；本应用只保留基础信息，不存储完整拓扑。实测 `ArchName: "广州"` 无结果，完整名称 `ArchName: "广州CVM核心"` 能命中，不能将其作为关键字过滤。`Keyword`、`Keywords`、`KeyWords`、`Name` 均被服务端拒绝为未知参数。

无搜索词时直接使用云端分页；有搜索词时网关按每页 100 张拉取该凭证可访问的所有架构图，按名称包含关键字过滤后再分页，返回匹配总数。搜索覆盖云端所有页，不局限于当前展示的 20 张；任一云端页查询失败时返回错误，不展示不完整结果。每次搜索重新读取，不缓存跨凭证数据，架构图较多时查询耗时相应增加。

没有匹配结果时，实测腾讯云返回 `ArchList: []` 并省略 `TotalCount`；服务端将这种响应转换为 `items: []`、`totalCount: 0`，供页面显示空结果。非空列表缺少总数仍视为异常，避免错误分页。

架构图列表与详情接口可在腾讯云[云顾问 CAM 权限清单](https://cloud.tencent.com/document/product/598/69848)中核对；目录接口可在[智能顾问操作审计清单](https://cloud.tencent.com/document/product/629/137637)中核对。这些控制台接口未完整列入公开 API 概览，参数契约以本次真实请求验证为依据。

凭证需要 `advisor:DescribeArchList`、`advisor:DescribeArch`、`advisor:DescribeArchResources`、`advisor:DescribeArchSvgData`、`advisor:DescribeArchThresholdConfigStatusV2`、`advisor:UpdateNodeResourceCapacityMetricV2`、`advisor:DescribeNodeLoadInfoV2New`、`advisor:DescribeNodeResourceLoadInfoV2New` 及目标架构图访问权限。产品告警还需要 `monitor:DescribeAlarmHistories`。CAM 对目标架构的显式拒绝会直接显示，不自动修改权限。该账号应已开通智能顾问。本功能不自动开通服务或修改云端授权；查询失败会展示云端错误，允许重试。通用「测试凭证」使用 Monitor 接口，其成功与否不代表 Advisor 权限；应在架构图选择器中验证。

## 本地管理 API

以下接口均沿用管理台 HTTP Basic Auth。

| 方法和路径 | 输入 / 输出 |
| --- | --- |
| `GET /api/admin/tencent-credentials/:id/architectures` | 查询参数 `pageNumber`（默认 1）、`pageSize`（默认 20，上限 100）、`search`（名称，最长 100 字）；返回 `items`、`totalCount`、`pageNumber`、`pageSize` |
| `POST /api/admin/architecture-watches` | JSON `{ "credentialId": "…", "archId": "arch-…" }`；从腾讯云校验后返回已保存配置，状态码 201 |
| `GET /api/admin/architecture-watches` | 返回 `{ "items": [...] }` |
| `GET /api/admin/architecture-watches/:id` | 返回架构详情、产品、去重资源、地域和值守设置 |
| `GET /api/admin/architecture-watches/:id/apm-instances` | 返回当前凭证可访问的全地域 APM 业务系统选择项，不包含上报 Token |
| `GET /api/admin/architecture-watches/:id/apm-applications?region=…&instanceId=…` | 返回已校验业务系统中的应用选择项 |
| `POST /api/admin/architecture-watches/:id/apm-policies` | JSON `{ "applications": [{ "region": "ap-guangzhou", "instanceId": "apm-…", "serviceName": "…" }] }`；只读预览相关策略，返回 `items`、`complete`、`fetchedAt` |
| `GET /api/admin/architecture-watches/:id/diagram?view=3d` | `view` 支持 `2d`、`3d`，默认 `3d`；返回腾讯云对应视图的原始 SVG、`view` 和读取时间，由客户端隔离画布展示 |
| `GET /api/admin/architecture-watches/:id/nodes/:diagramId` | 只读获取节点绑定资源、容量指标和产品告警 |
| `PUT /api/admin/architecture-watches/:id/enabled` | JSON `{ "enabled": true/false }`，只改变启用状态并保留配置及提醒进度 |
| `GET /api/admin/architecture-watches/:id/capacity` | 按云端现有配置刷新监测后读取本次任务判定、更新时间及数据说明 |
| `GET /api/admin/architecture-watches/:id/settings` | 获取设置及实时群绑定/检查状态 |
| `PUT /api/admin/architecture-watches/:id/settings` | 校验云端产品/资源范围后保存设置，保留当前启用状态；启停只由顶部独立开关控制，不从客户端直接接收群 ID |
| `POST /api/admin/architecture-watches/:id/check` | 在启用、绑定且处于值守时段时执行一次检查 |
| `POST /api/admin/architecture-watches/:id/test-push` | 明确点击后向绑定群发送测试消息 |
| `POST /api/admin/architecture-watches/:id/unbind` | 解除群绑定并停用值守，轮换绑定码 |
| `GET /api/admin/architecture-watches/:id/history?page=1` | 分页获取事件及分析结果，附最近 20 条检查记录 |
| `POST /api/admin/architecture-watches/:id/events/:eventId/retry` | 重试失败的分析或未完成的推送 |
| `DELETE /api/admin/architecture-watches/:id` | 移除本地配置；成功返回 `{ "ok": true }` |
| `GET /api/admin/state` | 增加 `architectureWatches` 字段 |

SQLite `architecture_watches` 表通过外键引用腾讯云凭证，`(credential_id, arch_id)` 唯一约束防止重复添加，包括并发请求。新增时不信任客户端名称，重新请求云端详情；验证期间凭证发生轮换则要求重试。列表和配置响应不包含 AK/SK；云端错误中的凭证内容会脱敏。
