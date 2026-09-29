# 聊天渠道接入 Spec

[English](../../development/CHAT_CHANNELS_SPEC.md) · [Intent](CHAT_CHANNELS_INTENT.md) · [路线图](ROADMAP.md)

> 文档角色：current-development。0.4.0 已实现 Telegram 实验性功能。
> 维护者选择直接发布 0.4.0 CLI；下方原定预发布顺序被此决定取代。
> C10 完整真实验收仍未完成，不宣称全部验收门槛通过。

## 实现说明

源码已包含网关及 Telegram 传输。验证结果记录于路线图链接的带日期开发证据；
C10 真实验收仍待完成。远程策略比普通 `safe` 和 `workspace-write` 更严格：
每个非只读动作都要求单次审批。CLI、Desktop、Gateway 的原生/Codex 执行入口
共用宿主级租约，包括只读运行；不协调其他机器或外部编辑器。

新增本地恢复命令 `forge gateway retry-delivery`：网关停止时重置投递重试次数，
不重跑任务或恢复审批。当前审批 renderer 拒绝超过单消息预算的动作描述
（最多 1,450 个 UTF-16 code unit），也拒绝被脱敏改变的描述。
outbox 为终态与审批预留容量，达到 80 条待投递消息时暂停新任务，inbox 最多保留 10,000 条记录。

## 1. 当前基础与架构边界

当前 [application runner](../../../packages/application/src/run.ts) 提供 `runTask`、
`cwd`、`sessionId`、`conversation`、`approvalChannel`、`signal` 和 `onEvent`。
[会话持久化](../../../packages/application/src/persistent-session.ts) 提供准备、记录与恢复。
[Desktop application](../../../apps/desktop/src/agent/application.ts) 调用共享 runner，
但还持有 Desktop 专用会话锁。这些是复用点，不代表已经存在跨入口网关或共享锁协议。

拟定职责：

| 层 | 职责 |
| --- | --- |
| CLI | 本地设置、前台生命周期、诊断；不让模型修改渠道配置 |
| 内部渠道适配器 | 平台传输、身份提取、格式转换、回调、错误重试分类 |
| Gateway service | 准入、所有者/工作区绑定、任务生命周期、并发、审批路由、消息投递 |
| Application | 共享 session/run 编排，接入跨入口执行租约 |
| Core | 工具策略、审批语义、上下文、取消、执行限制 |
| Persistence | 版本化 inbox、绑定、任务/投递元数据、原子写入与恢复 |
| Model adapters | 保留 provider 协议转换，不加入平台行为 |

Telegram SDK 对象不得进入 application/core/persistence 契约。先使用内部模块，
只有实现需要时才增加 private workspace package。不能通过解析 CLI 屏幕输出或
把聊天文本拼进 shell 来实现网关。

## 2. 渠道契约

统一入站消息包含 `channel`、`accountId`、`eventId`、`senderId`、`conversationId`、
可选 `threadId`、`receivedAt`、`kind`，以及有界文本或审批载荷。ID 作为不透明字符串。
Telegram 适配器保留 `update_id` 用于传输去重，发送者取自平台消息信封中的身份，
不能取自转发内容、昵称或显示名称。

适配器提供 start/stop、标准化入站事件、send、可选 edit、审批展示及能力描述。
能力包括消息编辑、按钮、话题、附件与文本长度限制。网关要求文本投递能力，
其余功能明确降级。无按钮时可使用 `/approve <opaque-token>` 或
`/deny <opaque-token>`，仍要求同一绑定所有者、会话、有效期和单次消费校验。
没有安全审批输入能力的适配器必须拒绝需要审批的执行。

任务路由键包含渠道、账号、对话、话题及已验证所有者，不能只用 chat ID。
平台身份默认隔离，未来必须有显式本地关联流程才能跨平台绑定。
首版在调用模型前拒绝群聊、转发或编辑的任务消息、附件及 bot 发起的任务；
忽略服务事件。受支持的回调仍必须验证身份。

## 3. 本地配置与命令

拟定 CLI：

- `forge gateway setup telegram`：本地设置，不自动启动执行。
- `forge gateway run`：运行一个前台实例，直到停止。
- `forge gateway status`：显示脱敏后的连接、绑定和任务状态。

非敏感设置存放在用户拥有的版本化文件 `FORGE_HOME/gateway/config.json` 中，
默认 home 沿用现有 Forge 解析规则。配置包含 `schemaVersion`、`channel`、
`accountId`、`tokenEnv`、`allowedUserIds`、`workspaceAlias` 和规范化 `workspaceRoot`。
v1 要求 `channel=telegram`、恰好一个所有者 ID 和一个绑定；token 从
`FORGE_TELEGRAM_BOT_TOKEN` 读取，不把值写入配置或日志。
启动时拒绝缺失身份、密钥、无效目录、不支持的引擎及重复实例。
白名单为空即全部拒绝，不能让第一个发送者自动取得所有权。
项目配置、聊天命令和模型输出均不能修改这些网关设置。

本地设置必须显式选定现有 permission profile，不能静默选用更宽权限。
v1 使用 Forge 原生引擎。现有模型和工作区指令仍由 application 加载，
但这些指令不能影响网关准入。轮换 token 后通过本地重启生效。

拟定 Telegram 命令仅向所有者开放：

| 命令/输入 | 行为 |
| --- | --- |
| 普通文本 | 空闲时在当前绑定会话启动任务 |
| `/help` | 展示支持的命令及主机/工作区限制 |
| `/new` | 空闲时新建对话，保留历史记录 |
| `/status` | 不调用模型，返回当前状态和最近完成结果 |
| `/cancel` | 取消当前任务，使待处理审批失效 |

未知命令返回帮助，不调用模型。忙碌时拒绝 `/new`。
不自动开放其他 CLI slash command。配对、任意工作区路径、provider 修改、shell 命令
和远程配置不在首版范围内。忙碌时普通文本返回活动任务 ID，不暗中排队。

## 4. 准入、持久化与执行

顺序：验证信封类型和大小 → 验证所有者/私聊 → 去重 → 检查容量和工作区租约 →
持久化接收 → 确认 → 执行。一个活动任务，控制事件队列上限 100 项。
任务文本默认最多 16 KiB UTF-8，超出时确定性拒绝。
对未授权请求的回应限流，不透露项目、会话、模型或任务详情。

持久化维护以渠道/账号/事件为键的版本化 inbox、session/run 路由、传输 checkpoint、
任务状态与有界 delivery outbox。原子写入，文件权限仅限当前 OS 用户。
轮询 checkpoint 前移前，必须先持久化接收事件或最终处置。
接收取消和审批事件不能等待模型完成。每个 bot 账号只允许一个 poller 租约；
webhook 传输后续再做。

状态：`accepted → running ↔ awaiting_approval → completed | failed | cancelled`。
重启后，上一进程遗留的 accepted/非终态任务全部变为 `interrupted`，不能自动再次调用。
completed、failed、cancelled、interrupted 都是终态；新消息建立新任务。

重复事件不重新运行 agent。事件处置记录默认保留七天，超过保留接收时间窗口的重放应拒绝；
Telegram 单调 checkpoint 在清理 inbox 后继续保留。逐条记录投递状态，只重试发送，
不重试执行。不承诺外部副作用 exactly-once：工具可能已执行，但结果还没持久化就崩溃。
必须报告这种不确定性，由新的用户任务检查和处理。

复用规范化的已完成对话历史，不恢复待处理审批、进程，不从展示文本重建 provider
continuation，不恢复历史权限。首版 gateway 使用独立会话，不静默附着现有 Desktop/CLI 会话。

开放写操作前，必须将以规范化工作区为键的共享执行租约接入 CLI、Desktop、Gateway 的
application 路径。首版竞争执行明确返回 busy；仍需 session snapshot 冲突检查。
租约恢复验证进程归属，不能只因超时就删除仍有效的租约。
它只协调遵守协议的 Forge 入口，不能锁住编辑器、其他进程或任意 shell 副作用，
现有 stale-write 检查仍保留。未实现共享租约，远程修改操作不能通过发布验收。

## 5. 审批、取消与敏感信息

core 审批请求映射到服务端记录，绑定已验证所有者、渠道/账号/对话、session、run、
工具调用/动作摘要、有效期及密码学不可预测 token。
通过转义且有界的展示呈现具体动作和范围；若无法安全完整呈现，应拒绝并解释，
不能让用户盲批被截断的动作。

默认审批有效期五分钟，不超过任务剩余时间。仅在对应请求仍等待时允许单次回应，
原子消费后再完成 core 审批。错误用户/对话/run、过期 token、重复点击、动作变更、
重启、取消或断网期间过期均不能授权。core 拒绝不可被网关覆盖。
v1 不开放整个 session 的持久授权。

取消使用现有 abort 路径，停止后续工具派发、拒绝待处理审批并记录实际结果。
runner 尚未结束时显示 cancelling，不能提前声称已取消；已有副作用不会回滚。
任务总时限默认 30 分钟，包含审批等待；现有 step/tool/output/command 限制继续适用，
聊天不能提高这些限制。

日志和投递存储前应用现有脱敏及 gateway token 脱敏。不得发送环境变量全量内容、凭据、
隐藏推理或原始 trace。Telegram markup 必须转义不可信输出。
最终文本通过有界脱敏 renderer，不承诺自动识别任意仓库文本中的所有秘密。
本地操作者需明确了解选定任务文本和结果将离开主机。

## 6. 投递与运行行为

持久化接收后才确认。进度更新最多每两秒一次，合并多余进度，保留终态与待处理审批。
遵守平台当前文本限制，在安全边界分段。最终输出默认上限 16 KiB UTF-8，
超出则明确说明截断并给出本地会话引用。v1 不发送任意文件或原始工具输出，
不能把本地路径伪装成可远程访问的产物链接。

限流遵守服务端 retry 提示；网络/5xx 使用有限退避；无效凭据停止连接并要求本地修复。
每项出站消息最多重试五次，outbox 上限 100 项；先丢弃可合并的进度，
无法保存终态投递时暂停接收新任务。发送结果不确定时回复可能重复，以稳定任务 ID 辨认。
投递失败不能让已完成任务重新执行。

本地展示 disconnected/reconnecting/connected 和待投递状态。轮询采用有上限的指数退避。
断线后收到超过五分钟的旧任务文本应拒绝，不启动过时工作；审批回调按自身有效期处理。
优雅关闭时停止接收新任务、取消活动任务，在 10 秒内保存状态，未解决任务留为 interrupted。
不承诺主机睡眠、断电或断网期间持续工作。

## 7. 验收矩阵

除 intent 明确延期的内容外，下列全部为必要项。

| ID | 所需证据 |
| --- | --- |
| C01 | 所有者私聊通过真实 application + fake provider 执行；陌生用户/群聊/转发/编辑/bot/附件不能调用模型和工具 |
| C02 | 单 bot/所有者/工作区配置；缺白名单/token/目录与重复 poller 均关闭执行；诊断脱敏 |
| C03 | 多轮与 `/new` 保持会话隔离；重启恢复已完成历史，不恢复待处理权限 |
| C04 | 审批允许/拒绝，以及错误用户/对话/run、动作变化、过期、重启、取消、重复回调测试 |
| C05 | 在模型/工具/审批阶段取消；控制事件持续可响应；终态与实际执行结果一致 |
| C06 | inbox 持久化、checkpoint、工具副作用、outbox 发送前后崩溃注入；无自动重放，说明不确定性 |
| C07 | Desktop/CLI/Gateway 同工作区并发被拒绝，不影响其他工作区；验证失效/有效租约及 snapshot 冲突 |
| C08 | fake transport 覆盖格式、长度、洪泛、429、5xx、无效 token、旧消息、outbox 满和重连 |
| C09 | 第二个假适配器通过共享路由/审批/生命周期测试，包含不能编辑/无按钮时的降级 |
| C10 | opt-in 真实 Telegram 验证所有者和第二个未授权账号；真实原生 provider 任务、审批、拒绝、取消、重启、断网 |
| C11 | npm 构建产物包含拟定命令和网关依赖/资源；现有 CLI/Desktop 回归通过 |

离线 gates：`CI=true pnpm check`、`CI=true pnpm check:docs`、聚焦 Vitest、
`CI=true pnpm test`、`CI=true pnpm eval:deterministic`、`CI=true pnpm package:verify`。
新增测试路径在实现时确定，本文不虚构可运行测试。
真实试验需要操作者提供 bot 和模型凭据，脱敏证据记录在 `evals/reports/<version>/`。
分别注明 OS、架构、provider、传输方式、失败及排除项。

## 8. 实施顺序与发布

1. 确定内部契约，实现 fake transport 生命周期与一致性测试。
2. 完成本地配置、inbox/outbox 持久化、共享执行租约与准入。
3. 接通原生 application/session、审批、取消和恢复。
4. 增加 Telegram 轮询、展示、诊断，执行 opt-in 真实验收。
5. 准备 0.4.0-beta.1；只把已交付行为写入双语用户指南。
6. 必要证据通过后发布 0.4.0，后续渠道独立迭代。

当前 [npm workflow](../../../.github/workflows/publish.yml) 接受 `v*` 标签；
[dist-tag 选择](../../../scripts/release-version.mjs) 将预发布路由到 `next`，正式版到 `latest`。
发布前重新核实路由。[版本脚本](../../../scripts/set-version.mjs) 目前不包含 Desktop，
其 `desktop-*` 产物采用独立构建/版本合同。发布准备时同步相关 manifest、lockfile 元数据、
版本常量、发布说明路径与打包检查；内部实现包保持 private。
本次文档变更不升级版本、不创建标签、不发布。

待后续决策：第二个生产平台、后台服务、Desktop 设置与共享会话接续、多用户/群聊策略、
附件、Codex 引擎兼容。每项在交付前都必须补充对应验收合同。
