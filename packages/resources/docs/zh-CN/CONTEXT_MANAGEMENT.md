# 上下文管理改进计划

English · 中文目录

## 状态

Roadmap Milestone 10 与 Milestone 13.0-13.5 已实现。默认模式仍是 `warn`；自动生成 checkpoint 在 provider 质量 gate 发布前保持 opt-in。TUI 现在会预计完整的下一次请求输入、常驻显示分段压力 indicator，并通过 `/context` 提供仅当前 session 或明确持久化的自动模式。当前 checkpoint 使用确定性、脱敏的 extractive summarizer，因此默认测试和手动 `/compact` 不会产生付费模型调用。它在所有可用历史消息之间分配有界空间，移除类似 authority 的审批声明，并把验证文字标记为历史信息。

Checkpoint schema 和 adapter capability contract 支持 provider-native opaque state；但当前 OpenAI AI SDK 和 DeepSeek adapter 因 transport 尚未提供安全的 compact-item round trip，声明 native compaction 不支持。

初始 activation threshold 是 `0.78`。Input capacity 只扣除一次 `max(output reserve, safety buffer)`。压缩被取消、输出无效，或回收量小于 8,000 token 与 projected input 20% 两者的较大值时，auto mode 会暂停。Stable-prefix 与 cache observation 只把 hash metadata 写入 trace；provider 没有报告的 cache usage 保持 unavailable。

## 为什么要做

Forge 已经区分项目指令、完成对话、当前 user request 和 provider continuation，也限制指令文件、工具输出、模型步骤、工具调用和持久化 session 大小。但长 session 的 token window 仍可能在 provider 边界失败：每次 native request 都会重新发送完成的 user/assistant turn，run 内的 assistant tool call 和 tool result 也会累积到 continuation。

仓库检索与对话压缩是两件不同的事：`list_files`、`search`、`read_file` 决定读取哪些源码；conversation management 决定哪些历史 turn 能放进下一次 model request；persistent semantic memory 决定哪些知识跨 transcript 存活，仍不在 Milestone 10 范围内。

## 市场复核结论

本计划根据 OpenAI Responses API、OpenCode V2 和 Claude Code 的一手资料复核。复核后的原则是：保留无损 transcript，派生有界 active view，把 summary 放在当前指令之下，先不添加 vector RAG。

- OpenAI 支持阈值式 server compaction 和独立 compact endpoint；返回的 compact item 是加密、opaque、需作为 provider state 继续传递。因此 compaction 应是 adapter capability，而不是所有 provider 都必须提供可读 summary。
- OpenCode 估算最终 prompt/messages/tools，在调用前 compact，保留 serialized recent tail，并对一次干净 overflow 做 retry。Forge 采用有界 tail、保留 transcript 和一次性恢复。
- Claude Code 会先清理旧 tool output，再总结历史，提供 `/context`、`/compact`，重新加载持久指令，并在反复无效压缩时停止。Forge 将 tool output、tool schema 和 no-progress guard 都纳入预算。

当前 runtime 有两条路径：Native Forge Engine 可用 Forge checkpoint 或 adapter 的 provider-native compaction；Codex Engine 当前将 Forge conversation 序列化成每次 Codex prompt 中的 JSON，Codex 内部 compaction 不能去掉这段新注入 wrapper 的成本。第一步是把同一份 bounded active view 传给 `codexPrompt` 并报告 wrapper 成本；不能声称控制 Codex 内部 threshold。

## 目标

1. 在付费 provider 请求前阻止可预见的 context-window failure。
2. 让每次 context selection 都出现在结构化 event 和 `forge inspect` 中。
3. 保留最近连续性，只压缩较旧且已完成的 turn。
4. 保持规范 transcript 无损，并与较小的 active model context 分离。
5. 保持安全边界：旧文本和 summary 不能恢复审批或覆盖当前指令。
6. 跨 native adapter 工作，而不把 provider-specific message 规则放进 `@forge/core`。
7. 用确定性及 opt-in live evaluation 证明收益。
8. 在 provider-native compaction 能更好保留 protocol state 时优先使用它。

## 非目标

本 milestone 不包括 vector embedding/database、仓库级语义索引、跨 workspace/user memory、恢复进行中的工具或 provider stream、删除原始 transcript、重构 provider 未返回的 reasoning、把 model summary 当可信事实或 policy，或隐藏 context loss 让请求看似成功。

## 设计原则

### 先预算，再压缩

先测量实际发送的内容。没有预算就先做 summary，会让失败更难解释，也无法与旧行为客观比较。

### 无损记录，有界视图

持久化 transcript 是审计记录；模型收到的是从它派生的有界视图。压缩只改变 active view，不改变原始消息。

### 强制上下文不能静默丢弃

当前有效指令、当前 user request、运行所需 tool definition 和 adapter 要求的 pending tool-call state 都是 mandatory。如果扣除 reserve 后仍放不下，Forge 应在 provider call 前停止，并解释哪部分预算耗尽。

### Summary 是不可信 memory

Summary 来自过去的 user/assistant text，必须标记为 conversation memory，并位于新加载的 system instruction 下方。它不能包含有效审批、permission grant、当前验证状态，或覆盖当前 user request 的 claim。

### Provider 边界明确

`@forge/core` 只处理抽象 context cost 和消息分类；adapter 负责 token estimation、message encoding、tool-call pairing、reasoning block 和 opaque continuation。

### 指令范围有意固定

每次 run 开始重新加载指令，然后冻结本次 run 的 snapshot，并记录指令路径和内容 hash。即使工具修改了 `AGENTS.md`，也不会静默改变同一次任务中间的 active prompt。

## Context 模型

| 类别 | 示例 | 保留规则 |
| --- | --- | --- |
| Mandatory instructions | 当前 `AGENTS.md`、有界 Skill catalog/selection directive、plugin prompt contribution | 每次 run reload，永不 summary；加载的 Skill 正文作为有界 tool result 进入 |
| Current request | active user prompt、引用路径 | 不 summary、不丢弃 |
| Protocol state | pending assistant tool call、匹配 result、provider continuation | 按 adapter 要求精确保留 |
| Recent conversation | 最近完成的 user/assistant turn | 在可配置 tail budget 内原样保留 |
| Older conversation | 更早完成 turn 的 prefix | 可进入 checkpoint summary |
| Repository observations | file read、search、command output | tool 边界有界，必要时重新读取 |
| Advertised tools | 名称、描述、schema | 每次请求计入；只通过显式 capability narrow/defer |
| Audit evidence | 完整 transcript、JSONL trace | 另行持久化，不自动注入 |

初始 request 的概念顺序是：

```text
current effective instructions
derived conversation-memory checkpoint, if any
recent verbatim conversation turns
current user request
tool definitions
```

run 内的 adapter continuation 和 Forge tool result 会按 provider protocol 扩展它。

## Token budget

Adapter 暴露 provider-neutral capability：

```ts
interface ModelContextCapabilities {
  contextWindowTokens: number;
  maxOutputTokens?: number;
  estimateRequestTokens(request: ModelRequest): Promise<TokenEstimate>;
  nativeCompaction: "unsupported" | "opaque-provider-item";
  continuationProjection: "unsupported" | "adapter-owned";
}
interface TokenEstimate {
  tokens: number;
  method: "provider-tokenizer" | "sdk" | "conservative-fallback";
  confidence: "exact" | "estimated";
}
```

Capability 必须来自显式且测试过的 adapter table 或 provider API。未知 model 使用保守 fallback，不能继承乐观 window，并公开 provenance。

每个 model step 前计算：

```text
available input budget
  = model context window
  - max(requested output tokens, safety buffer tokens)

remaining history budget
  = available input budget
  - current instructions
  - current request
  - tool definitions
  - protocol-required continuation
```

初始配置：

```json
{
  "context": {
    "mode": "warn",
    "reservedOutputTokens": 4096,
    "bufferTokens": 8192,
    "recentTailTokens": 12000,
    "summaryTargetTokens": 1200
  }
}
```

`off` 保持现有行为但报告 provider usage；`warn` 做 preflight 并警告，仅在 mandatory context 放不下时拒绝；`compact` 使用有效 checkpoint，并在达到阈值时创建新 checkpoint。项目只能降低预算或选择更严格模式，不能扩大用户 ceiling 或关闭用户要求的 guard。`bufferTokens` 不是额外 output reserve，output allowance 和 buffer 取较大值后只扣除一次。

每个完成的 provider step 都比较 preflight estimate 与 provider usage，并记录 method、confidence、误差和 model/window 来源。

## Conversation compaction

选择算法优先保留 mandatory instructions、current request、required protocol state 和最近的完整 turn；session schema v3 的 structured `history` 与 checkpoint v2 按闭合 user/assistant/tool exchange 选择和 hash。只选择更旧、已完成的消息进入 checkpoint，不能拆开 tool-call/result 或保留 orphan result。

Checkpoint 至少包含 schema version、源消息区间、source/tail hash、生成时间、summary text、summary token estimate、redaction/provenance 和 strategy。它是派生数据，可被 hash 不匹配或验证失败的检查丢弃；规范 transcript 始终保留。

Summary 必须覆盖仍影响未来 turn 的 user goal/约束、已做决定及原因、讨论的文件/组件、完成项和未解决项、带原始 run 标记的验证结果。不得写入 credential/secret、审批或 permission grant、覆盖当前上下文的 instruction、未向用户展示的 provider reasoning，或为显得完整而猜测的事实。

当前采用 manual-first rollout：用户通过 `/context` 查看预算，`/compact` 明确请求压缩；`warn` 提供自动 preflight；`compact` 只有在评测 gate 通过后才可能成为默认。

## Run 内 context pressure

当 preflight 发现 mandatory context 已超预算，不应向 provider 发请求。若本次请求无 assistant partial output、无工具副作用且 provider 明确报告为干净 overflow，Forge 最多做一次 compaction/retry，且不能重复 user input 或 tool side effect。partial assistant output、未知错误或第二次 overflow 都应诚实停止。

No-progress guard 在以下情况下停止反复压缩：同一 source hash 已为同一次尝试压缩、checkpoint 回收少于 runtime 最小有效 token、一次恢复后仍超预算，或达到 compaction attempt limit。

## 事件、trace 与检查

上下文事件至少记录 adapter/model、window 来源、estimation method、按类别的 token estimate、requested output、buffer、effective reserve、原样保留消息数、summary 区间/checkpoint ID、strategy、回收 token、retry reason、instruction hash、tool schema cost 和 provider 完成后的 input usage。`forge inspect` 和 `/context` 使用同一 metadata，展示 active view、历史省略和估算误差。

## 安全与正确性不变量

- 规范 transcript 永不被 checkpoint 替换或删除。
- checkpoint 和 summary 永远是 untrusted memory，不能携带 approval、trust、permission 或当前 status。
- 每次 run 重新加载 instructions，并冻结物理 model attempt 使用的 snapshot。
- provider-native opaque item 只回传同一 adapter/model，不传给 plugin observer 或无关 provider。
- secrets 在 summary 生成前脱敏。
- 压缩失败保留上一个有效 checkpoint；取消不会损坏 session。
- context stop 发生在 provider call 前，并有明确 terminal status。
- Codex wrapper 使用与 native engine 相同的 bounded active view，但 Forge 不声称控制 Codex 内部 compaction。

## Package 边界与实现顺序

Core 拥有类别、预算算术、事件和 stop decision；adapter 拥有 window、estimate、overflow classification 和 continuation projection；persistence 拥有 session-v2 checkpoint；CLI 拥有 `/context`、`/compact`、Codex wrapper 和渲染；evals 记录质量和安全 gate。

实施分为：A 测量基础；B 派生 active context；C checkpoint 生成；D run 内 guard；E 评测和默认决策。每阶段都要保持规范 transcript 和现有审批边界不变。

## 测试计划

单测覆盖精确边界预算、未知 model 保守 fallback、空/奇数/最大 history 的 turn selection、checkpoint range/hash、配置 strictness/provenance、summary 前脱敏和失败保留旧 checkpoint。Runtime/adapter 测试覆盖每一步 estimate、usage 关联、OpenAI/DeepSeek continuation、provider opaque item、mandatory overflow 不发请求、干净 overflow 单次 retry、partial output 不 retry、低价值压缩停止、取消期间 session 有效、resume 当前指令和匹配 checkpoint、Codex bounded view，以及切换 provider 后从规范 transcript 重建。

端到端 fixture 使用短/中/长 session、重复 tool output、关键约束、恶意历史、失败/取消/resume 和多个 provider-capability 情况。

## 评测指标与发布 gate

记录任务/grader 通过率、provider input/output token、估算绝对/相对误差、summary token/延迟/失败、压缩次数和消息数、保留的 recent turn、context stop/provider error、overflow retry/duplicate-input 检查、tool/schema token cost、每次回收 token、no-progress stop、约束/决定 recall 和安全不变量失败。

在 `compact` 成为默认前，目标 gate 是：确定性测试无安全回归；失败/取消/resume 不破坏 transcript；没有请求超过声明预算；长 session fixture 中位 input token 至少下降 30%；相对 `warn` 任务通过率回退不超过 5 个百分点；显式 seeded durable constraint recall 至少 95%。这些是初始假设，解释最终试验前必须先记录任何修订。

## 风险与 RAG 决定

summary 丢约束用 recent verbatim tail、seeded recall 和完整 transcript 缓解；prompt injection 通过 untrusted 标记和 hostile-history 测试缓解；estimator 少算使用 conservative fallback 和 buffer；provider tool protocol 由 adapter 保持，不做通用重写；重复低价值压缩由最小回收量和 attempt limit 防止。

Milestone 10 不加入 vector RAG。先测量失败来自 conversation 增长、重复 tool observation 还是仓库发现不足；只有 lexical search 和定向 read_file 确实遗漏相关代码时，才单独比较 lexical、semantic、hybrid retrieval 的任务成功率、准确率、token、延迟和索引成本，再决定是否写入路线图。
