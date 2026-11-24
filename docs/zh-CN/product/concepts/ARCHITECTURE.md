# 架构设计

[English](../../../product/concepts/ARCHITECTURE.md) · [中文目录](../../README.md)

Forge 将**界面呈现**、**工作流编排**、**策略与预算决策**、以及**模型传输适配**明确拆分开。这样做的核心收益是：安全策略、路径校验和预算会计可以完全脱离终端、Electron 窗口或真实模型 API 独立测试，同时各模型厂商的协议差异不会污染主循环。

## 分层架构与工作区布局

仓库共包含 15 个工作区成员，分为五个层次。对外发布到 npm 的只有 CLI 包 `@jslee124/forge`，所有 `@forge/*` 内部实现包保持私有：

```text
入口与界面层        apps/cli（Ink 终端界面）        apps/desktop（Electron 桌面工作台）
                             \                       /
应用编排层                    packages/application
                    （单次运行、持久会话、斜杠命令目录、多会话调度）
                                      |
核心与契约层       packages/core · @forge/config · @forge/auth · @forge/plugin-api
                                      |
能力、适配与存储   tools · persistence · resources · model-{deepseek,openai,compat} · codex-app-server
                                      |
评测与验证层       evals（确定性契约测试、可选真实模型试跑、发布报告）
```

| 层次 | 成员包 | 核心职责 |
| --- | --- | --- |
| 入口与界面层 | `apps/cli`、`apps/desktop` | 解析命令、驱动 Ink 终端或 Electron 工作台、渲染流式输出/diff/审批弹窗、处理信号。桌面端验收测试脚本独立存放在 `apps/desktop/src/main/acceptance/`。 |
| 应用编排层 | `packages/application` | 编排完整运行流程、持久会话管理、图片预处理、斜杠命令目录与解析、启动资源发现以及多会话调度器（`SessionScheduler`）。 |
| 核心与契约层 | `packages/core`、`packages/config`、`packages/auth`、`packages/plugin-api` | 与模型厂商无关的 Agent 循环、策略内核、上下文预算与压缩控制、运行事件流、配置分层合并与来源追踪、凭据解析与插件契约。 |
| 能力与适配层 | `packages/tools`、`packages/persistence`、`packages/resources`、`packages/model-*`、`packages/codex-app-server` | 有边界的文件/命令工具、Session v3 快照与脱敏 JSONL trace、Skills 与插件加载、单轮模型流式适配、Codex App Server stdio JSON-RPC 客户端。 |
| 评测层 | `evals` | 离线确定性跨层测试、夹具仓库、需显式开启的真实模型评测与版本报告。 |

依赖方向严格单向指向 `@forge/core`：核心层绝不反向依赖 Ink、React、Electron、命令行解析器或任何具体厂商 SDK。

## 双执行引擎边界

Forge 提供两条职责隔离的执行引擎路径：

```text
用户输入 ─┬─► 原生 Forge 引擎 ─► @forge/core 主循环 ─► @forge/model-*（单轮调用）
          │                                          └─► 策略内核 + 内置工具 + JSONL trace
          │
          └─► Codex 引擎 ─────► @forge/codex-app-server ─► 官方 Codex App Server（stdio JSON-RPC）
                                   （由 Codex 自身持有工具、沙箱、审批与会话状态）
```

- **原生 Forge 引擎**：由 Forge 自己驱动多步 Agent 循环（`runAgent`），在每次副作用前执行工作区路径校验和策略审批，如实展示模型返回的推理过程（reasoning），并记录结构化 JSONL trace。
- **Codex 引擎**：通过 stdio JSON-RPC 对接官方 Codex App Server。Forge 负责向其传入当前提示词（及有上限的活动历史包装）并通过 `model/list` 校验推理强度，但 OAuth 登录、工具执行、沙箱隔离和审批全权归 Codex 所有。

认证隔离与路由选择详见[认证说明](../start/AUTHENTICATION.md)。

## 原生引擎的运行机制

### 模块化运行时结构

`packages/core/src/` 以 `runtime.ts` 为入口，按单一职责拆分为六个协作者：

| 模块 | 职责 |
| --- | --- |
| `runtime.ts` | 运行入口（`runAgent`）、多步循环主控、只读循环与无效动作防空转检测（`ReadProgressTracker`、`InvalidActionLoopTracker`）、单次超限恢复、停止条件与终态结果汇总 |
| `runtime-conversation.ts` | 厂商中立的对话格式转换与规范消息投影（`runConversationMessages`、`canonicalExchange`、`canonicalDeltaWithOutcome`） |
| `runtime-step.ts` | 单轮模型流式调用（`consumeModelStep`）、工具定义投影（`toModelToolDefinitions`）、缓存命中观测与步骤错误分类 |
| `runtime-budget.ts` | 请求组装、提示前缀缓存标记（`cacheControl`）、上下文预算核算、压力阈值检查与步前适配器续接压缩（`prepareModelStepRequest`） |
| `runtime-tools.ts` | 单次工具参数校验、同运行重复拒调拦截、策略评估、用户审批交互、执行分发与 Skill/Docs 领域事件发射（`executeToolCallBatch`） |
| `runtime-events.ts` | `RunEvent` 联合类型、运行选项/结果/上限接口、默认上限常量与 `exitCodeForRunStatus`（脱敏与 JSONL 写入归 `packages/persistence`） |

### 单轮适配器与不透明续接状态

所有原生适配器（`@forge/model-deepseek`、`@forge/model-openai`、`@forge/model-compat`）每次只执行**一轮模型请求**，将底层响应标准化为 Forge 事件流。Forge 不会把多步控制权交给外部循环包装器（如 `ToolLoopAgent`），也不会把工具执行回调直接挂给 AI SDK。

像 DeepSeek 思考模式这样需要在工具回调轮次之间保留思维链的场景，适配器会在事件之外返回一个**不透明续接记录（continuation record）**。`core` 在同一次运行内原样保存并回传该记录给同一适配器，既不解析厂商私有字段，也不从终端显示文本重新拼凑。

### 内置工具与安全边界

所有内置工具都使用 Zod 校验参数，通过显式的 `ToolContext` 获取工作区根目录、`AbortSignal`、预算上限与事件通道，并返回结构化错误码：

| 工具 | 作用 | 默认风险 | 关键约束 |
| --- | --- | --- | --- |
| `list_files` | 列出工作区目录文件 | 只读 | 有文件数量上限的有序遍历 |
| `read_file` | 读取文件内容 | 只读 | 支持 `startLine`/`lineCount` 分段读取、二进制拒读（`not_text`）、并发修改检测（`stale_file`），仅完整无截断读取时返回整文件 SHA-256 |
| `search` | 工作区内文本搜索 | 只读 | 仅字面量匹配（`mode: "literal"`），受文件体积与总扫描预算限制，支持相对 glob 过滤 |
| `edit_file` | 创建、精确替换或整文件覆盖 | 写入 | 扁平 `operation` 枚举；整文件重写必须校验此前完整 `read_file` 返回的 SHA-256 |
| `run_command` | 执行外部程序 | 可变 | 基于 Node `spawn` 且固定 `shell: false`，不支持管道与重定向语法 |

`examples/plugins/` 下的示例插件还展示了可选的 `web_search`、`web_fetch`（网络风险）以及只读代码审查子代理 `delegate_code_review`（宿主管理的单层无递归子任务）。

### 策略内核（`allow` / `confirm` / `deny`）

每一次工具调用在真正执行前，都必须经过策略内核裁决：

```text
模型提出工具调用
       │
       ├──► 工作区内的只读操作（list / read / search）─► allow（默认 safe 策略下）
       ├──► 当前运行内首次写入工作区 ────────────────────► confirm（批准后可按范围复用）
       ├──► run_command 或已注册的网络工具 ──────────────► 每次调用都 confirm
       ├──► 越出工作区根目录的内置文件操作 ──────────────► deny（先解析符号链接再判定）
       └──► 需要审批但没有可用的交互通道（如非交互管道）──► deny
```

插件钩子和项目配置**只能把 `allow` 收紧为 `confirm` 或 `deny`**，永远不能放宽核心裁决。需要注意的是：策略内核属于应用层的安全与确认边界，不是操作系统级沙箱；一旦你批准了 `run_command` 或信任了项目本地 JS 插件，相关代码就会以 Forge 当前用户权限运行。完整边界见[安全模型](./SECURITY_MODEL.md)。

## 配置、指令与扩展边界

1. **配置优先级（`@forge/config`）**：按 `默认值 → ~/.forge/config.json → .forge/config.json → 环境变量 → CLI 参数` 合并，并通过 `forge config show` 追踪每一项的来源。项目级 `.forge/config.json` 只能下调上限或收紧策略，不能篡改默认模型、写入密钥或启用插件。
2. **指令加载（`AGENTS.md`）**：每次运行开始时加载用户全局 `~/.forge/AGENTS.md` 和从仓库根到当前工作目录的 `AGENTS.md` / `AGENTS.override.md`，随后在本次运行期间冻结快照，防止运行过程中写入 `AGENTS.md` 暗中改变系统指令。
3. **Skills 与插件（`@forge/resources`、`@forge/plugin-api`）**：内置和 `.agents/skills` 中的 Skill 仅以有界元数据暴露给模型，正文只有调用 `load_skill` 后才作为受限工具结果进入上下文；项目内 `.forge/plugins/` 的代码在工作区获得显式信任前不会加载。详见[项目上下文与扩展](../reference/PROJECT_CONTEXT.md)和[插件开发指南](../reference/PLUGINS.md)。

## 会话、事件流与 Trace

CLI 终端界面、Desktop 桌面界面以及 JSONL 持久化日志共同消费同一套不可变的 `RunEvent` 事件流：

```text
created ──► running ◄──► awaiting_approval
               │
               ├──► completed
               ├──► failed
               ├──► cancelled
               ├──► denied
               └──► limit_reached
```

| CLI 退出码 | 运行终态 / 含义 |
| --- | --- |
| `0` | `completed` — 运行完成且所需验证成功 |
| `1` | `failed` — 未恢复的 runtime、provider 或工具失败 |
| `2` | CLI 用法或配置无效 |
| `3` | `limit_reached` — 运行未成功结束（包括触及步数/工具/上下文上限或无进展停机） |
| `4` | `denied` — 必需动作被拒绝或没有可用的审批通道 |
| `130` | `cancelled` — 用户通过 Ctrl+C 取消 |

Forge 严格区分**会话（Session）**与**运行（Run）**：

- **Session**（v3 结构）长期保存已经完成的用户/助手对话消息以及配对的工具调用与结果。
- **Run** 是针对单条指令的一轮有限 Agent 执行，拥有独立的步数上限、全新的内存授权状态与脱敏后的 JSONL trace。

恢复（Resume）旧会话时，Forge 会重新校验规范工作区路径并重新加载当前配置与 `AGENTS.md`，随后开启一次全新的 Run；旧的临时审批、未完成调用、子进程或厂商续接状态都不会被复活。详见[持久化会话与 Trace](../reference/SESSIONS.md)和[上下文管理](./CONTEXT_MANAGEMENT.md)。

## 测试与验证分层

日常开发测试和 `pnpm eval:deterministic` 均不触发任何付费模型调用：

- `packages/core`、`packages/tools` 与策略测试使用确定性模拟适配器（Fake Adapter）和临时目录完成验证。
- 模型适配器集成测试覆盖流式事件映射、工具调用配对、思考内容往返以及本地环回 HTTP 路由。
- `evals/` 负责跨层确定性契约测试（包括工具异常恢复、工作区越界拦截、会话恢复与 `pnpm check:docs` 文档校验）。
