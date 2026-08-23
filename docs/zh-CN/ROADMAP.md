# 路线图

[English](../ROADMAP.md) · [中文目录](README.md)

## 当前 milestone

**Milestone 11：OpenAI-compatible provider routes 已完成。** 自动 context checkpoint 仍保持 opt-in，同时收集 live provider-quality gate。

## 工作规则

- 完成一个 milestone 后再扩展下一个。
- 每个 milestone 都必须产生可运行行为。
- 是否完成由验收标准决定，而不是写了多少文件。
- 默认测试套件不依赖付费模型调用。
- 只有 milestone 需要时才新增 workspace package。
- 实现证明计划错误时更新本文。
- 以 [v0.1 验收与评测](V0.1_SPEC.md) 作为 release contract。

## Milestone 0：项目基础（已完成）

建立最小、可运行、易测试的 pnpm monorepo：Node.js 24、pnpm 11.18.0、`apps/cli`、`packages/core`、仅 ESM 的严格 TypeScript project references、`tsc -b`、Biome、Vitest、Commander CLI 和 CI。验收包括 clean checkout 安装、`pnpm forge --version/--help`、`pnpm build/check/test` 和 core 不依赖 CLI。

## Milestone 1：DeepSeek 对话（已完成）

加入 `packages/model-deepseek`、Vercel AI SDK、`DEEPSEEK_API_KEY` 解析、默认 `deepseek-v4-flash`、显式 thinking、单轮 streaming adapter、`forge ask`、独立 text/reasoning event、token/provider metadata、可读错误和 Ctrl+C 取消。缺 key 必须以退出码 `2` 结束且不泄漏 secret；默认测试不发付费请求。

## Milestone 2：Workspace 与只读工具（已完成）

加入 `packages/tools`、规范 workspace/cwd、`list_files`/`read_file`/`search`、路径和 symlink 校验、workspace 外拒绝、输出限制及 AI SDK schema translation。工具失败必须是结构化 result，模型 tool call 不能通过 AI SDK 的直接 execute callback 绕过 Forge。

## Milestone 3：Native Agent loop 与策略基础（已完成）

运行时在 core 内控制多步循环、tool result 和可恢复失败，保留 DeepSeek continuation，设置默认 12 model steps/40 tool calls，支持取消、`allow/confirm/deny` policy、无审批 channel 时拒绝，以及完整退出码映射。Fake-model 测试覆盖 completed、failed、cancelled、denied、limit-reached 和 thinking tool round trip。

## Milestone 4：安全 coding vertical slice（已完成）

实现结构化 patch、精确 diff、首次写入审批、仅当前 run 的写入范围、`spawn`/`shell:false` 的 `run_command`、60 秒 timeout、65536 bytes 输出限制、取消和超时进程终止、不覆盖已有用户修改、`validation-bug` fixture、端到端测试和失败验证后的纠正恢复测试。验收要求 fixture 从检查到通过验证完整完成，shell 表达式及 workspace 外文件操作被拒绝。

## Milestone 4.5：交互式 CLI（已完成）

无 subcommand 时进入交互 session，跨 prompt 保留 conversation，按 run 明确审批和 patch 范围，提供 `/help`、`/clear`、`/exit`，Ctrl+C 取消但保留 session，第二次 Ctrl+C/EOF 正常退出，并提供 `forge` 全局 link。退出或取消不能遗留 model request 或 child process。

## Milestone 4.6：交互 TUI 与上下文引用（已完成）

使用 Ink 作为 `apps/cli` renderer，实现多行编辑、Enter/Shift+Enter/Ctrl+J、`/` 命令菜单、统一 command registry、`@` 有界 fuzzy 文件 picker、结构化 workspace-relative mention、running/streaming/cancel/approval 状态和精确 diff panel。UI 不依赖 paid model；runtime/tools 不 import React/Ink。详细交互合约见[交互式 CLI UI](CLI_UI.md)。

## Milestone 5：配置、指令与 permission profile（已完成）

加入 `packages/config`、`FORGE_HOME`（默认 `~/.forge/`）、版本化 Zod schema、用户和项目 `.forge/config.json`、带 provenance 的合并、`forge config show/validate`、用户/项目 `AGENTS.md` 分层发现和 size limit、`safe`/`workspace-write` profile（`full-access` 延后）。验收要求错误带 source path、值和来源可查看、指令顺序确定、项目不能削弱 policy，并且从子目录启动与 root 的 workspace 配置相同。

## Milestone 6：结构化 trace、会话与 resume（已完成）

定义 versioned run event，从同一 event stream 渲染终端并写 JSONL；持久化 session snapshot，区分 session/run ID，只保存完成对话，typed provider reasoning，脱敏 credential，提供 `forge inspect`、`forge resume`、`--last` 和 workspace-scoped `/resume`。恢复重新加载配置/指令，绝不恢复旧审批、continuation 或未完成工具调用。详细合约见[持久化会话](SESSIONS.md)。

## Milestone 7：评测与首个 release（已完成）

保留规范 fixture，增加至少两个任务和 hidden grader；默认 suite 使用 fake model；付费 DeepSeek 试验显式 opt-in；多次运行记录 model/settings、通过率、耗时、步骤、工具调用和 token；加入 terminal demo、README setup/results/limitations、许可证、model ID 复核并打 `v0.1` tag。所有 v0.1 gate 见 [V0.1_SPEC](V0.1_SPEC.md)。

## Milestone 8：受信任插件 API（v0.2，已完成）

定义 versioned manifest/API，发现 user plugin、portable project Skill 和 `.forge/plugins` 项目插件；注册 tools/commands，暴露 immutable event，提供 prompt/policy hook，项目插件先 trust，并禁止削弱 core policy。Forge 无插件也必须正常工作；plugin tool 走与内置工具相同的 policy/trace pipeline。详细合约见[插件指南](PLUGINS.md)。

## Milestone 9：OpenAI 认证扩展（已完成）

重新检查官方文档和条款，泛化 authentication manager，保留 DeepSeek API key，加入 OpenAI API key，通过适当公开/授权集成提供 ChatGPT 登录，支持 browser/headless flow，将 credential storage/refresh 交给 Codex App Server，提供 `forge auth status/logout`、Codex model/reasoning discovery、`forge codex`、`--engine codex`、`/model`、`/login`、掩码 API key 输入和 owner-only 文件。验收要求不读取其他应用 credential file，清晰区分 API key/订阅，refresh 并发安全，且上游变化给出可操作错误。

## Milestone 10：有预算的上下文管理（已完成，默认仍 opt-in）

目标是在不隐藏丢失上下文、不改变指令优先级和不提前引入 retrieval 的情况下让长 session 可预测。

### 10.1 预算与可观察性

provider/model capability 与 runtime limits 分开；提供保守 token estimator；为 output、instructions、tool schema、当前 request、history 和 continuation 分配预算；只扣除 `max(output, buffer)` 一次；发出 versioned context event；`forge inspect` 展示 estimate/provider usage/保留/省略；native request 和 Codex wrapper 都计预算；可能超 window 前预警。

### 10.2 安全 conversation compaction

checkpoint 与 canonical session transcript 分离；可用时支持 adapter-owned opaque compaction，否则使用 Forge inspectable checkpoint；保留当前指令、当前请求和 recent serialized tail，只压缩完成 turn prefix；summary 是 untrusted memory，不能携带审批、验证证据或权限；记录 strategy、provenance、hash、model、token 和时间；失败/取消/无效 summary 可预测地 fallback；提供 `/context`、`/compact --dry-run` 和手动 `/compact`，自动默认需等待 gate。

### 10.3 Run 内压力

每步前重新检查预算，统计 continuation/tool call/result，压缩旧 tool output，使用有界 result、定向重读和 measured tool set；仅在无 assistant output/副作用的 provider-classified clean overflow 时恢复一次；检测 compaction thrashing；不能安全缩减时以带具体 context reason 的 `limit_reached` 停止；provider-specific 行为只能在 adapter capability/feature flag 下启用。

### 10.4 评测与默认 rollout

增加 long-session、recall、指令变化、tool-result pressure、resume 和 hostile history fixture；测量任务成功、tokens、估算误差、延迟、压缩和 summary regeneration；比较 `off`/`warn`/`compact`；在 automatic compaction 默认前定义 threshold；semantic/vector retrieval 保持延后。中文详细设计见[上下文管理](CONTEXT_MANAGEMENT.md)。

## Milestone 11：OpenAI-compatible provider routes（已完成）

目标是支持 gateway 和 self-hosted server，同时让 credential destination 始终由用户控制。已实现：用户级 Chat Completions/Responses route profile；禁止仓库定义 route；除 canonical loopback 外要求 HTTPS；显式 bearer/no-auth；stored credential 绑定规范 endpoint；有界且不跟随 redirect 的 model discovery 和手动 fallback；可选 reasoning metadata（不付费 probe）；`@forge/model-compat`；将 route capability 接入 context、图片、`/model`、`/effort`；区分 explicit `none` 与 provider default；在 stateless continuation 中保留可 replay reasoning metadata；credential-redacted provider error；TUI 中分离 model/effort；bearer、无认证、缺 key 和 no-downgrade 测试。

验收要求 loopback OpenAI-compatible server 可以通过 bearer 和 no-auth route 完成 compiled CLI 请求；项目不能定义或重定向 route；endpoint 变化不能复用旧 key；大型 model catalog 可搜索；context/output capacity 与 reasoning gears 到达既有 UI；build、format、typecheck 和无付费请求的全量 suite 通过。

## 后续扩展

后续方向包括更多评测和 grader、Anthropic Messages/Gemini 等 native protocol、窄的 workspace 外审批、明确警告的 `full-access`、可选 shell language、LangChain/LangGraph 对比、HTTP/SSE、SQLite session/run index、session branch/跨机同步、经 context evaluation 证明有价值的 semantic retrieval、MCP 和更强的进程隔离。它们不是当前 v0.2 的完成条件。
