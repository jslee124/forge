# 架构

[English](../ARCHITECTURE.md) · [中文目录](README.md)

## 状态

本文描述 `dev` 分支当前架构与 package 边界依据。接口代码块是便于理解的简化草图，不是稳定 public SDK；checkout 中的 TypeScript types 与 tests 才是权威。

## 实现基线

| 领域 | 当前决定 | 原因 |
| --- | --- | --- |
| Runtime | Node.js 24 LTS | 使用受支持的 LTS 和当前平台 API |
| Package manager | pnpm 11.18.0 | 快速、严格的依赖布局和 workspace 支持 |
| Module | 仅 ESM | 不维护双 ESM/CommonJS 输出 |
| 仓库形态 | pnpm monorepo | 不拆仓库也能看见 runtime 边界 |
| Build | TypeScript project references + `tsc -b` | 先以包方向约束替代 bundler |
| CLI 解析 | Commander | 成熟、轻量的进程命令和 help parser |
| 交互 UI | Ink + React | 处理终端渲染和键盘，不把 runtime 搬进 UI |
| 校验 | Zod | 在配置和工具输入之间共享 runtime validation |
| 格式/lint | Biome | 一个快速、配置面小的工具 |
| 测试 | Vitest | 快速 TypeScript 测试和易写 fake |
| 首个 provider | `@ai-sdk/deepseek` 的 DeepSeek | 泛化前先证明一条 provider 路径 |
| 首个 model | `deepseek-v4-flash` | 支持 tool 和 thinking 的快速模型 |
| 进程执行 | Node `spawn`、`shell: false` | 保持 program/args 结构化，避免隐式 shell 解析 |

根 `package.json` 是 private，并通过 `packageManager` 固定 pnpm。每个 workspace package 使用 ESM；依赖版本由 lockfile 固定，文档只固定 runtime/package-manager 基线。

### Monorepo 布局

```text
apps/
`-- cli/                    # @forge/cli：解析、渲染、审批 UI
packages/
|-- core/                   # @forge/core：循环、事件、策略合约
|-- codex-app-server/       # Codex JSON-RPC transport 和 auth 边界
|-- model-deepseek/         # DeepSeek AI SDK translation
|-- model-compat/           # OpenAI-compatible route translation
|-- model-openai/           # OpenAI Responses API translation
|-- auth/                   # provider-neutral API-key resolution
|-- persistence/            # session snapshots、JSONL traces、redaction
|-- plugin-api/             # 可执行 plugin discovery、trust、host 与 API v1
|-- resources/              # 非执行型 Skill catalog 与安全延迟加载
|-- tools/                  # 内置工具实现
`-- config/                 # 配置和 context loading
fixtures/                   # integration test 的小型仓库任务
evals/                      # task manifest、grader、runner、报告
```

`evals/` 是 private workspace package。Live runner 使用真实 CLI run boundary，将 fixture 复制到临时 workspace，注入窄审批 channel，保存正常 trace，并在 Agent 停止后调用外部 grader。生成物只有在选定报告后才发布。

### CLI 与进程约定

| 退出码 | 含义 |
| --- | --- |
| `0` | 运行完成且所需验证成功 |
| `1` | 未恢复的 runtime、provider 或工具失败 |
| `2` | CLI 用法或配置无效 |
| `3` | 未成功停止，包括触达限制 |
| `4` | 必需动作被拒绝或无审批 channel |
| `130` | 用户 Ctrl+C 取消 |

工具失败可能作为 observation 返回模型，不一定立即决定进程退出码；只有终止 run 状态决定退出码。普通用户错误默认不打印 stack trace。

## 系统上下文

```text
User -> CLI -> Agent Runtime
              |-- Model Adapter -> Auth Manager -> AI SDK -> Provider
              |-- Context Loader -> Instructions
              |-- Resource Catalog -> load_skill
              |-- Plugin Host -> Contributions
              |-- Policy Kernel -> Tool Executor
              `-- Run Events -> Terminal + Trace
```

## 组件职责

### CLI

CLI 负责命令和配置解析、持久化交互 session、多行编辑、斜杠补全、`@` 文件引用、workspace 选择、流式事件和 diff 渲染、敏感操作审批、通过 `AbortSignal` 转发取消，以及选择退出码。它不包含 agent loop 或工具实现；Commander 负责进程命令，Ink 只负责交互 presentation。文件 mention 只携带 workspace-relative path，不绕过 `read_file`、workspace 校验、policy 或 trace。

每个交互 prompt 开始新的有界 run 和审批实例；下一 prompt 携带已完成的 canonical user、assistant、tool-call 与严格配对的 tool-result block。session schema v3 可以跨重启恢复这些 provider-neutral 历史，但未闭合调用、tool continuation 和审批只属于产生它们的 run。

### Agent runtime

Runtime 拥有 run state/step count、conversation message、model/tool 循环、provider reasoning block、停止条件、工具校验和 dispatch、审批检查、project context、受控 plugin hook、event emission 和最终 status。它依赖 model、tools、approval、trace 的接口，从而可以独立测试。

### Model adapter

初始 adapter 使用 Vercel AI SDK 和 `@ai-sdk/deepseek` 流式传输。它只执行一次 provider turn 并把 stream 映射为 Forge event；多步骤循环由 Forge 控制，不交给 `ToolLoopAgent` 或 `stopWhen`。AI SDK tool definition 不带直接 execute callback；Forge 只有在 policy 记录决策后才验证和执行。

DeepSeek thinking tool call 要把 provider reasoning content 原样放入后续 tool-result turn，因此 adapter 返回和可观察事件并列的 opaque continuation。Core 可以保存并交还同一个 adapter，但不能从终端文字重构或丢弃 metadata。Provider 返回的 reasoning 作为 typed response part 输出；没有返回时不得伪造。

### Authentication manager

认证与 transport 分离。Native Forge Engine 通过 provider-neutral manager 先解析 `DEEPSEEK_API_KEY`/`OPENAI_API_KEY` 等环境变量，再读取 Forge owner-only credential store，然后交给 provider adapter；Codex Engine 通过 stdio JSON-RPC 启动官方 Codex App Server。Forge 发起 managed browser/device-code login，但 Codex 拥有 OAuth client identity、callback、token、持久化、刷新和 logout。Forge 不复制其他应用 credentials，也不静默读取 `~/.codex/auth.json`。

### Project context loader

Loader 先解析 `FORGE_HOME`（默认用户 `~/.forge/`），校验配置，再解析规范 workspace 和 working directory。配置从默认、用户、项目、环境和 CLI 合并，同时保留 provenance；user-only 和 strictness-only key 不可被普通覆盖。它按 root 到 leaf 读取 `AGENTS.md`，在每层优先 `AGENTS.override.md`，发现 `.agents/` 和 `.forge/`，并且只有 workspace 明确 trust 后才交给 plugin host 项目插件。项目 context 可以让 prompt 更严格，但不能授予权限或读取 secret。

### Plugin host

Plugin host 是扩展边界，不是安全 authority。受信任插件可注册 custom tool、user command、prompt、immutable event observer、有界的宿主管理 subagent 角色、特定 lifecycle hook，或让 policy 更严格。声明 `network:access` 的 network tool 每次调用都需确认；所有 custom tool 仍经过 policy kernel 和 executor。进程内 JavaScript plugin 是本地可信代码，API capability 不是隔离；强隔离需要子进程或 OS sandbox。

Subagent 声明会变成 `model` risk 的 parent tool。由宿主而非插件创建 child adapter、隔离对话、继承 policy/approval、共享预算、取消链路、有界结果和关联 trace。Child 工具集合排除所有 subagent tool，因此委派深度固定为一层。当前继承 parent model，不支持跨模型路由或可独立 resume 的 child session。

### Tools 与审批策略

每个工具有唯一名称、model-facing 描述、Zod input schema、执行函数、risk 分类和结构化结果。当前工具包括 `list_files`、带完整读取版本信息的 `read_file`、`search`、统一的 `edit_file`（安全 create、精确 replace、版本保护 rewrite）和 `run_command`，以及示例 plugin 的 `web_search`/`web_fetch` 与 `delegate_code_review`。历史 session 中的 `create_file`/`apply_patch` 仍可读取，但当前请求不再广告或执行它们。

`edit_file` 的 model-facing schema 是带 `operation` enum 的 flat object，因此 compatible
endpoint 不需要接受 `anyOf`/`oneOf`。Runtime 会在审批或执行前严格校验 create、replace
与 rewrite 的字段组合。

交互 CLI 保留 `interactive-ui.tsx` 作为兼容 facade；应用组合、Ink lifecycle 和 approval/diff 展示位于 `apps/cli/src/interactive/`。每次交互 invocation 只有一个 lifecycle owner 创建并 unmount Ink instance。

策略在执行前返回：

```text
allow    无需交互执行
confirm  执行前询问用户
deny     不执行
```

策略检查规范路径、写入、破坏性命令、time/output/call limits 和审批 UI。默认是 workspace 读/列/搜 allow，首次写入 confirm，同一 run 已批准范围内的后续写入 allow，所有进程和注册网络工具 confirm，workspace 外内置文件操作 deny，无审批 channel 的必需动作 deny。符号链接必须在决策前解析；`run_command` 用 `spawn`/`shell:false`，但确认、超时、输出限制和 trace 不是 OS 隔离。

### Hooks、事件和 trace

行为改变型 hook 与不可变观察 event 分开。Lifecycle hook 有类型化返回值；policy contribution 可以把 allow 提高到 confirm/deny，但不能降低强制决策；`RunEvent` 是 renderer、trace 和 metrics 共用的 immutable observation。事件包括 `run.started`、`model.started`、`model.reasoning`、`tool.proposed`、`tool.approved`、`tool.denied`、`tool.completed`、`tool.failed`、`run.completed`、`run.failed` 和 `run.cancelled`。Trace 不得保存 API key 或已知 secret。

### Session 与 run

Session 是持久用户对话，run 是一次有界 prompt 调用；一个 session 可包含多个 run，每个 run 有自己的 trace、limits、policy 和 terminal status。Session store 位于 application boundary，保存完成的 user/assistant turn 和有序 run ID，不保存 provider continuation、pending approval、活跃子进程或 in-progress tool call。Resume 重新加载当前配置/指令并创建新 run，因此不会把旧权限当 authority。

## 核心接口草图

```ts
interface ModelAdapter {
  stream(request: ModelRequest, signal: AbortSignal): AsyncIterable<ModelStreamEvent>;
}
interface AuthenticationManager {
  resolve(provider: string, signal: AbortSignal): Promise<ModelCredential>;
  logout(provider: string): Promise<void>;
}
interface ForgeTool<Input, Output> {
  name: string;
  description: string;
  inputSchema: ZodType<Input>;
  risk: ToolRisk;
  execute(input: Input, context: ToolContext): Promise<ToolResult<Output>>;
}
interface ApprovalPolicy { evaluate(action: ProposedAction): Promise<ApprovalDecision>; }
interface TraceWriter { append(event: RunEvent): Promise<void>; }
```

这些是设计草图，不是稳定 public API。

## Run 生命周期

```text
created -> running <-> awaiting_approval
             |              |
             +--> completed +--> failed / cancelled / limit_reached
```

只有 terminal state 能结束 run。自然语言声称成功不能覆盖 runtime 记录的失败验证。

## 依赖方向与上下文所有权

CLI、native runtime、AI SDK adapter、auth manager、context loader、tools 和 trace 实现都依赖 core interface；plugin host 依赖 core extension interface；core 不得 import CLI rendering、具体 provider、plugin implementation 或未来的 LangChain adapter。

Context ownership 保持分层：core 负责分类、预算计算、事件和停止；adapter 负责 model window、估算、overflow 分类和 continuation projection；persistence 负责 session schema v3 与 checkpoint v2；CLI 负责 `/context`、`/compact`、Codex wrapper budget 和 inspection rendering。规范 transcript 永远不被 active model view 替换。兼容 route 的 continuation 仍是 opaque adapter state，provider metadata 由 transport 保存。

## 测试策略与延后决定

测试覆盖路径、stop condition、policy、symlink、missing UI、临时 workspace 工具、fake model runtime、AI SDK message/tool translation、fake credential/refresh、context hierarchy/provenance、plugin hook 不削弱决策，以及小型 fixture 的端到端任务。默认 suite 不需要真实模型调用。

SQL/数据库存储、更多 provider、外部 workspace 审批、OS sandbox、plugin 子进程、分布式 trace 和更复杂的恢复语义，只有在对应 milestone 需要时决定。
