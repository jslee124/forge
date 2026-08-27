# 安全模型

[English](../SECURITY.md) · [中文目录](README.md)

## 状态

本文描述截至 Milestone 10 的已实现安全模型：内置工具留在选定 workspace 内，每个有效工具操作都经过策略决策，没有审批通道时需要审批的操作会被拒绝。`safe` 与 `workspace-write` 已实现；恢复 session 只恢复已完成对话，每次恢复都会获得新的策略和审批状态；`full-access` 仍延后。

Context checkpoint 是派生且不可信的 conversation memory，不能携带审批、信任决定、permission profile 或当前验证状态。新指令和当前请求始终有效；规范 transcript 另外保留。Provider-native opaque context 属于敏感状态，不暴露给 plugin observer 或普通 trace payload。

## 原则与默认决策

默认安全不等于隔离。Forge 必须说明自己实现了哪些边界，以及哪些风险仍由用户承担。

| 操作 | 默认决策 |
| --- | --- |
| workspace 内读取、列出或搜索 | Allow |
| workspace 内首次写入 | Confirm |
| 被本次 run 审批覆盖的后续写入 | Allow |
| 任意进程命令 | Confirm |
| 任意注册网络工具 | Confirm |
| 任意委派 subagent 模型运行 | Confirm |
| 内置文件工具访问 workspace 外 | Deny |
| 需要审批但无审批通道 | Deny |

## Permission profile

### `safe`

默认 profile。workspace 读取自动执行；workspace 修改、进程命令、注册网络工具和委派 subagent 模型运行依照上表确认。

### `workspace-write`

用户选择此 profile 后，workspace 文件工具可以自动修改文件；进程命令、网络工具和委派 subagent 模型运行仍需确认，v0.1 仍拒绝 workspace 外访问。

### `full-access`

v0.1 之后再考虑。未来的显式高级模式必须有清晰警告和用户决定，项目文件或插件绝不能静默启用它；Forge 不会暴露一个暗示隔离、实际却不隔离的 profile。

## 配置边界

`~/.forge/config.json` 是用户控制的配置。项目 `.forge/config.json` 可以覆盖普通项目行为，但不能降低 permission profile、标记项目已信任、抑制强制审批、增加用户安全限制，或启用未信任项目中的插件。API key、OAuth credential 和其他 secret 在用户及项目配置中都无效；API key 来自环境变量或 Forge owner-only credential file，ChatGPT subscription credential 则留在 Codex App Server 边界内。加载插件或开始 run 前必须先校验配置，并在适用平台提示不安全的文件权限。

## 文件系统边界

内置文件工具先解析规范路径和符号链接，再应用策略。workspace 内路径遵循当前 profile；v0.1 拒绝外部路径。

本地图片附件是独立的、由用户明确授权的输入能力。只有用户使用 `--image`、粘贴/拖放，或选择 workspace 内 `@` mention 时，Forge 才接受 workspace 外路径；不会从普通 prompt、仓库内容或模型输出推断附件。模型文件工具仍限制在 workspace。编码前会检查规范路径、普通可读文件、JPEG/PNG/GIF/WebP magic bytes，并限制单图、总大小和数量。用户提供的 HTTP(S) 图片 URL 由选定 provider 获取，Forge 不自行抓取；snapshot 和普通 run event 不保存 base64 图片。

策略只约束 Forge 文件工具，不会自动限制已经获批的子进程。

## 进程边界

v0.1 `run_command` 接受 program 和 args 数组，以 Node.js `spawn`、`shell: false` 启动。pipeline、重定向、命令替换和复合 shell 语法不接受。默认 profile 下每条命令都需确认，审批提示至少显示精确 program、逐项引用的参数、工作目录、超时和相关环境变化。

工作目录在 workspace 内不代表进程不能读写外部。没有 OS sandbox，Forge 不能声称获批子进程具有文件系统或网络隔离；`shell: false` 只防止 Forge 自己解析 shell 表达式。

## 网络边界

网络工具必须由插件声明 `network:access`，且在 `safe` 与 `workspace-write` 下每次调用都需确认。非交互且无审批通道时拒绝。仓库中的 `web-tools` 示例还限制协议/端口、校验初始和 redirect 地址、阻断本地/私有/保留范围，并限制 MIME、redirect、时间、下载和输出，但这些措施不能提供 OS 级网络隔离，也不能彻底消除 DNS rebinding。

获批进程或受信任插件代码仍可直接访问网络；manifest capability 只约束 Forge 注册 API，不能约束任意 Node.js 调用。UI 和文档不得暗示更强的隔离。

## 委派模型运行

Subagent 工具使用独立的 `model` risk，在 `safe` 和 `workspace-write` 下每次调用都需确认，因为它会产生额外模型运行。审批界面显示生成的 tool 名和委派 task。宿主创建 child adapter，插件不会拿到 credential。

Child 继承有效 policy/approval，只获得声明的非 subagent 工具，共享有界 run/step/tool 预算、workspace 和 abort signal，返回有界结果，且不能递归委派。启用 trace 时，child event 写入带 `parentRunId`/`subagentName` 的独立 trace，parent tool result 记录 child run ID。这是 runtime containment，不是 provider 或 OS 隔离。

## 非交互操作

没有审批通道时，除非用户在运行前提供了匹配的窄审批，否则需要审批的操作会被拒绝；沉默永远不解释为同意。评测 harness 的审批只允许 fixture 声明的精确 program、参数、工作目录和超时，是测试基础设施，不是通用绕过。

## 插件信任

进程内 JavaScript 插件是受信任的本地代码，可以直接调用 Node.js API，读取文件、启动进程或访问网络。插件 API 能防止插件通过支持的 hook 降低核心策略，但不等于隔离恶意插件。项目插件加载前需要明确的项目 trust；trust 以规范 workspace path 为 key，存储在仓库外的用户 Forge home 中，仓库 `.forge/` 不能自行标记 trusted。发现阶段或用户作出 trust 决定前不得执行 `.forge/plugins/` 代码。

## 仓库指令、Reasoning 与会话

`AGENTS.md`、`.agents/` 和非可执行 `.forge/` 配置是仓库控制的输入，可能含 prompt injection，但不能审批工具、启用 `full-access` 或削弱核心策略。Skill 发现只读取有界 metadata；`load_skill` 只接受登记的不透明 ID，会重新检查 canonical root、非 symlink 普通文件和发现时身份，并返回有界正文，且不扩大 workspace `read_file`。发现不等于执行，引用的脚本和动作仍走正常工具、审批和 trace 流程；Skill 来源、选择原因、加载拒绝和截断会写入 trace。

模型实际返回的 reasoning/thinking 默认对用户可见，必须标记为 provider 提供；不能声称访问 provider 没有返回的 reasoning。reasoning 可能含仓库敏感信息，trace 和导出使用同一脱敏策略。

恢复 session 只恢复完成的对话，不恢复可执行 authority；每次恢复创建新策略实例，不恢复旧审批、待调用工具、子进程或 provider continuation，并重新加载当前配置和项目指令。session snapshot 和 trace 在 `FORGE_HOME` 外仓库存储，但仍可能含仓库文本、diff、命令和模型输出，是本地敏感数据。

## Credential 处理

API key、access/refresh token、authorization code 和 PKCE verifier 都是 secret，不能出现在 prompt、trace、终端 debug、plugin event、crash report 或仓库文件中。Forge 当前先从进程环境变量解析 API key，再使用显式的 `$FORGE_HOME/auth.json` fallback。该文件位于项目外，原子写入，目录权限为 `0700`、文件为 `0600`，属于受文件权限保护的敏感明文，而不是 OS keychain；OS credential-store integration 仍是后续改进。

Provider/model/reasoning 选择是普通配置，可保存到 `FORGE_HOME`，credential 与普通配置分离。OAuth refresh 应 single-flight；Forge 不得静默导入或修改其他应用的 credential 文件。ChatGPT 订阅的 OAuth 和刷新全部交给官方 Codex App Server，Forge 不读取 Codex credential 文件，也不接收 token。

打包产品文档使用独立的白名单资源目录。搜索返回不透明、带版本的文档/章节引用；读取会重新校验文件、内容哈希、包版本与输出预算。文档工具拒绝任意路径，也不会扩大工作区文件访问。Skill 与文档文本始终是不可信内容，不能授予权限、暴露秘密或授权命令。
