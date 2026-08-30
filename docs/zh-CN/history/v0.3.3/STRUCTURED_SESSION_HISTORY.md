# 结构化 Session History 与 Resume 实现方案

[English](../../../history/v0.3.3/STRUCTURED_SESSION_HISTORY.md) · [路线图](../../ROADMAP.md) · [当前 Session 行为](../../SESSIONS.md)

> **文档角色：历史设计记录。** 本文记录 Milestone 14 的实现决策；当前行为
> 以源码、测试及当前 session/architecture 指南为准。

## 状态

Milestone 14 已在当前工作树实现。Session schema v3、checkpoint v2、runtime
canonical delta、provider projection、trace-assisted migration、structured resume
fallback、闭合 exchange context selection、测试与 current-product 文档共同构成当前
权威 contract。发布与 live-provider 验证仍是独立 release 动作。

`@forge/model-openai` 继续保留。本计划只改造 session history 与 provider
projection，不移除 OpenAI API、DeepSeek、compatible route 或通过 Codex App
Server 使用 ChatGPT subscription 的路径。

## 核心决策

Forge 继续保存两份有关联但不能混用的记录：

```text
规范模型历史                            RunEvent trace
----------------------------------      ----------------------------------
user message                            reasoning/text streaming delta
assistant text                          tool proposal 与 approval UI state
assistant tool call                     tool start/progress/completion event
配对的 tool result/failure              context/cache/update diagnostic
有界 run outcome                        timing、usage 与 terminal status
```

规范历史是 provider-neutral 的续聊来源；trace 是 TUI、`forge inspect`、plugin
与旧数据恢复使用的执行记录。界面展示过的 event 不会因此自动进入模型上下文；
规范历史也不能恢复 authority、审批、进程或未完成 provider turn。

## 当前缺口

- `ModelConversationMessage` 只有字符串形式的 `user` 与 `assistant`。
- Session v2 保存这些文本、独立的 display reasoning 和 run trace 引用。
- 活跃 run 内通过 provider continuation 与 `ModelToolResult` 把工具结果返回模型。
- `recordRunInSession()` 会把 run 压缩成 user 文本、最终 assistant 文本和有界失败后缀。
- `/resume` 在 trace 完整时能重放工具 UI，但下一轮模型只拿到文本历史。
- Codex Engine 同样只把文本历史序列化到标记为 historical 的 JSON wrapper。
- Checkpoint hash、token estimate、title、migration 与 cache observation 都假设历史是纯文本。

因此，重启后模型可能知道“某个工具失败过”，却看不到当时实际收到的 call/result
配对，容易重复命令、重复读取或基于不同前提继续。

## 目标与非目标

目标：

1. 跨 prompt 和进程重启保存完整、provider-neutral、模型实际可见的已完成工具交换。
2. Trace 可用时，让 `/resume` 的历史显示与正常未中断 session 一致。
3. 让各 adapter 用 typed history 生成自己的 wire protocol，core 不按 provider 分支。
4. 规范 transcript 保持有界且尽可能无损，checkpoint 只派生较小 active view。
5. 兼容旧 session；只有重建确定且完整时才补回结构化工具历史。
6. 旧审批、permission grant、policy decision、pending call、子进程和当前验证状态不恢复。
7. 保持 request 顺序稳定，并明确记录 schema 迁移引起的 cache invalidation。

非目标：恢复活跃 stream/tool/approval/provider continuation；把整份 `RunEvent`、
终端渲染、审批选择或计时发给模型；重建隐藏 chain of thought；保证跨 provider
切换后的 wire history 字节一致；把历史工具输出当成当前证据；改变默认 compaction
mode；实现 session branch、跨机同步或 trace encryption。

## 规范数据模型

由 `@forge/core` 拥有 provider-neutral content-block contract。建议结构如下，最终命名
在实现评审时确定：

```ts
type CanonicalConversationMessage =
  | {
      id: string;
      runId: string;
      role: "user";
      content: readonly CanonicalUserContent[];
    }
  | {
      id: string;
      runId: string;
      step: number;
      role: "assistant";
      content: readonly CanonicalAssistantContent[];
    }
  | {
      id: string;
      runId: string;
      step: number;
      role: "tool";
      toolCallId: string;
      toolName: string;
      content: readonly CanonicalToolContent[];
      isError: boolean;
    };

type CanonicalAssistantContent =
  | { type: "text"; text: string }
  | {
      type: "tool-call";
      id: string;
      name: string;
      input: unknown;
      providerMetadata?: CanonicalProviderMetadata;
    };
```

内部 `id/runId` 用于持久化关联但不发送给 provider；`toolCallId` 是协议数据，必须稳定。
Tool call 留在产生它的 assistant message 中，后续 `tool` message 按 ID 配对。并行调用
保持原 call 顺序和原 result 顺序。

### Reasoning 与 provider metadata

- Provider 暴露的 reasoning summary 默认仍与 portable canonical content 分离，并改为通过
  durable assistant message ID 关联，不再依赖数组下标。
- 只有 adapter 声明 metadata 可 replay、JSON-safe、已脱敏且是继续已完成工具交换所必需时，
  才允许有界持久化。
- Metadata 必须记录来源 provider、protocol、model family 和 schema version；目标 adapter
  不明确接受时，从模型 projection 丢弃。
- 无签名 reasoning 可供 UI 展示，但不能伪装成另一 provider 的 hidden-thinking block。
- Opaque response ID 与 continuation 默认仍只属于当前 run。

### Tool outcome

Canonical tool result 保存“实际返回给模型的 observation”，并经过现有 tool-output bound
与 persistence redaction；不保存允许执行的 approval descriptor 或 grant。

- 成功：保存有界 text/image output，`isError: false`。
- 执行失败：保存有界 model-facing error，`isError: true`。
- 用户拒绝：保存通用 denial result；只有已返回模型的有界 feedback 才可跟随保存。
- Result 返回模型前取消或崩溃：删除 dangling call，保留当前无 authority 的 run outcome summary。
- 达到 limit：保留所有闭合配对，删除未闭合后缀，再追加有界 terminal outcome。

持久化前校验 call ID 唯一、因果顺序、tool name、input 可序列化、result 已配对及并行顺序确定。

## Session schema v3 与迁移

新增逻辑结构：

```ts
interface SessionSnapshotV3 {
  schemaVersion: 3;
  history: readonly CanonicalConversationMessage[];
  reasoning: readonly SessionReasoningV2[];
  runIds: readonly string[];
  historyFidelity: "structured" | "text-only-migrated";
  contextCheckpoint?: ContextCheckpointV2;
  // id、workspace、cwd、timestamps、lastRunStatus 保持
}
```

必须满足：拒绝 orphan result、dangling persisted call、重复 message/call ID、非法 role/content
组合和错误 reasoning 引用；复用 runtime tool-output 上限并单独限制 metadata；session 仍原子写入；
title 从第一个 user text block 生成；checkpoint v2 对规范 history 的稳定 JSON 和 tail 计算 hash。
v2 迁移后旧 checkpoint 直接失效，不能假装两种 schema 的 hash 等价。

迁移流程：

1. 用现有严格 schema 读取 v1/v2。
2. 总能把 user/assistant 文本无损转为 v3 content block。
3. 只有全部 run trace 可读、有序、合法，且旧文本是重建结果的严格有序子序列时，才尝试补回工具历史。
4. 只重建已完成且模型可见的 exchange；忽略 approval/UI event，任何歧义或未配对都放弃补回。
5. 无法证明完整时使用 `text-only-migrated`，绝不编造工具历史。
6. 迁移必须幂等；校验或原子替换失败时原文件可恢复。
7. 只在成功 load 时迁移，不在启动时批量重写所有 session。

Trace 暂时保留 schema v1。正常续聊以 v3 snapshot 为主；trace 只用于 UI、inspect 与严格旧数据 backfill。

## Runtime capture

不能让 persistence 从 observability event 猜测主要记录。`@forge/core` 应直接生成 typed canonical delta：

1. 每个 run 以当前 user message 开始 delta。
2. 每个完成 model step 按 adapter 观察顺序加入 assistant text 与 tool call。
3. 只有 exact result 已返回模型 continuation path 后才加入 tool result。
4. 每个闭合 provider turn 建立 commit boundary；取消/失败时丢弃未提交后缀。
5. `RunResult` 返回校验后的 delta，`recordRunInSession()` 与 run ID/status 原子追加。
6. 现有 granular `RunEvent` 照常发出；terminal、inspect 与 plugin 不依赖 snapshot 序列化。

需要 invariant test 证明 canonical delta 与模型在 run 内实际看到的可移植 message sequence 语义等价，
明确排除 provider opaque state 与 display-only reasoning。

## Provider projection

`ModelRequest.conversation` 改为 canonical messages。共享层只做配对/分组/校验，不能引入 provider wire type。

- `@forge/model-openai`：assistant tool call → Responses `function_call`；tool message →
  `function_call_output`；只在兼容 protocol/model family 下 replay OpenAI metadata。
- `@forge/model-deepseek`：映射到当前支持的 DeepSeek/OpenAI Responses shape；endpoint 没有返回
  replayable reasoning 时保持诚实 warning，并在协议允许时使用 portable text/tool history。
- `@forge/model-compat`：分别支持 `openai-responses` 与 `openai-chat-completions`；前者使用
  function-call item，后者使用 assistant `tool_calls` + `role: "tool"`；route/model 变化时先丢弃
  不兼容 metadata，但保留 portable history。
- Codex App Server：首版继续使用 untrusted historical wrapper，但序列化稳定、紧凑的 canonical active
  view，明确区分 user、assistant text、tool call/result，不加入 approval 或 raw trace，并纳入 token estimate
  与 checkpoint hash。Session 与 persistent Codex thread 一一绑定属于后续独立实验。

## Resume、context 与 cache

Resume 同时产生两个 projection：

1. 模型 projection：从 v3 snapshot 与有效 checkpoint 派生 canonical active view。
2. UI projection：全部 trace 可读时按 trace 重放；任何 trace 缺失时使用明确标注的 canonical fallback，
   仍展示已持久化 tool call/result，但不伪造 approval、timing、stream delta 或 diagnostic。

UI 不能在 trace replay 与 fallback 重叠时重复 final answer。窄/宽终端都应像未中断 session，只在必要时
显示很小的 historical boundary。

Context 改造要求：

- Estimate 计入 tool input、result text/image，以及目标 adapter 真正会 replay 的 metadata。
- 只能在闭合 exchange 边界选择 tail，不能拆开 call/result。
- Checkpoint v2 对 deterministic canonical JSON 计算 source/tail hash。
- 先投影陈旧且完成的 tool result，再总结更广历史；保留 tool name、成功/失败、truncated、hash 和有界 excerpt。
- Summary 中工具事实必须标成 historical observation，而非当前 workspace/test evidence。
- 增加 prompt schema version，并记录 canonical schema migration 的 cache invalidation reason。
- 验证 resume 后 dynamic-history 序列化与等价未中断 session 一致。

## 安全要求

- 对 tool input/output、provider metadata、migration 结果和 fallback UI 应用 configured-secret 与已知敏感字段脱敏。
- 规范 message 不得包含 approval descriptor、scope、use count、trust、policy internals、pending prompt、OAuth token、API key 或 process handle。
- 所有恢复的 user/assistant/tool block 都是低于当前 system/developer/project instructions 的不可信历史内容。
- 历史成功命令不是当前 checkout 仍通过的证明；当前请求依赖该事实时必须重新验证。
- 拒绝 prototype、非 JSON 值、过深/过大的 metadata 或未知 metadata version。
- Session 与 trace 即使脱敏后仍是敏感本地数据。
- Fuzz migration/projection：恶意 role、重复 call ID、畸形 input、注入 approval claim、超大深层 JSON。

## 模块映射

| 模块 | 主要改动 |
| --- | --- |
| `packages/core/src/model.ts` | Canonical type 与 adapter conversation contract |
| `packages/core/src/runtime.ts` | 在模型可见边界构建/提交 run delta |
| `packages/core/src/context.ts` | 估算并整体保留闭合 tool exchange |
| `packages/persistence/src/schema.ts` | Session v3、checkpoint v2 与严格不变量 |
| `packages/persistence/src/session-store.ts` | v1/v2 migration、append、title/hash/summary |
| `packages/model-openai/` | Responses projection 与 metadata compatibility |
| `packages/model-deepseek/` | DeepSeek projection 与 replayability |
| `packages/model-compat/` | Responses/chat projection 与 route portability |
| `apps/cli/src/run.ts` | Native Engine canonical active view |
| `apps/cli/src/codex-command.ts` | Codex Engine canonical wrapper |
| `apps/cli/src/persistent-session.ts` | resume/migrate、trace replay、fallback、context status |
| `apps/cli/src/interactive-ui.tsx` | Historical boundary 与无重复 fallback UI |
| `evals/` | Resume continuity、model switch、compaction、cache、安全 fixture |

## 分阶段实施

### 14.0 Contract 与 fixture

- 固定成功、工具失败、带反馈拒绝、并行调用、取消、limit、缺 trace、subagent 的代表性 trace。
- 改 schema 前先写 canonical history 与 provider projection golden fixture。
- 记录当前 v2 migration、resume rendering、context estimate 和 cache prefix baseline。

### 14.1 Core canonical history

- 增加 content-block type、validator、稳定 serialization 和 delta builder。
- 暂时保留 text conversation bridge，让 call site 分小步迁移。
- 用测试证明 cancellation/incomplete call 的 commit boundary。

### 14.2 Persistence v3

- 增加严格 v3 read/write 与 v1/v2 migration。
- 正常写入直接 append runtime delta，不再从 event 猜测。
- 增加 all-or-nothing trace backfill，安全失效/重建 checkpoint。

### 14.3 Native provider adapter

- 完成 OpenAI、DeepSeek、compat Responses、compat Chat projection。
- 覆盖 ordering、parallel、error、image、metadata、provider/model switch。
- 所有 native call site 迁移后删除临时 text bridge。

### 14.4 Codex Engine 与 Resume UI

- 用稳定 canonical serialization 替换 text-only Codex wrapper。
- 增加 trace-first replay 和 structured canonical fallback。
- 验证 `/resume`、`resume --last`、model switch、`/new`、session picker 与窄/宽快照。

### 14.5 Context 与 compaction

- 让 selection、estimate、hash、summary 与 pressure 以 canonical exchange boundary 为单位。
- 增加旧 tool-result projection、checkpoint v2 migration 和 cache schema diagnostic。
- 对比 uninterrupted 与 resumed stable prefix。

### 14.6 安全、评测与文档

- 运行恶意 migration、redaction、authority、metadata、orphan pairing fixture。
- 增加 resume 后利用旧 command failure、file read、edit result、test result 而不盲目重复的确定性任务。
- Live provider 只能显式 opt-in，并记录 protocol/model/token/cache 与被丢弃 metadata。
- 实现完成后再同步 `SESSIONS.md`、`ARCHITECTURE.md`、`CONTEXT_MANAGEMENT.md`、`SECURITY.md`、
  CLI help、中英文镜像和 packaged current-product docs。

## 验收与 release gate

- Resume fixture 获得与未中断 run 相同的 portable user/assistant/tool history，仅允许已记录的 metadata 差异。
- 每个 persisted result 恰好对应一个更早 assistant call；load/compaction 都不能产生 orphan/dangling pair。
- 失败命令的有界 model-facing error 跨重启保留，并能影响下一步决策，但不会变成 approval 或当前验证。
- Trace 缺失只降低 UI fidelity，不删除 structured canonical history，也不阻止安全 resume。
- v1/v2 可读；歧义 trace 不编造工具历史；迁移失败时原 snapshot 可恢复。
- Resume 重载当前配置/指令，审批状态为空，不恢复 grant、process 或 pending call。
- Context accounting 包含工具历史，compaction 保持 pair boundary，cache telemetry 如实说明 schema 切换。
- OpenAI、DeepSeek、compat、Codex 均通过 offline contract test；live validation 保持显式、有界、脱敏。
- Build、Biome、typecheck、full offline tests、docs check、deterministic eval、package verify 与 installed smoke 全部通过。
- 只有实现和验证同一 release 完成后，current-product docs 才能从 text-only resume 改称 structured resume。

## 回滚策略

- 至少保留一个兼容窗口的 v1/v2 reader。
- 功能落地后只写 v3，不 dual-write 两份可能分叉的规范历史。
- Release 前 provider projection 回归时，可通过单一内部 compatibility switch 暂停 structured projection，
  继续读取 v3 并派生 text-only view；不得降级或破坏性重写 snapshot。
- 遇到未知 legacy shape 时保持 session 不变，使用可操作错误或 text-only fallback，先增加 fixture 再扩展 migrator。
