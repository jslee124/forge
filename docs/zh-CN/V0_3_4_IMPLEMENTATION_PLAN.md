# Forge v0.3.4 详细实现方案

[English](../V0_3_4_IMPLEMENTATION_PLAN.md) · [路线图](ROADMAP.md)

> **文档角色：当前开发计划。** 本文定义 v0.3.4 拟实现的 contract、交付顺序与
> 验收标准，不描述已发布行为，也不能证明 release、package 或 live-provider 状态。
> 在各阶段真正实现前，当前源码与测试仍是权威事实。

## 状态与决策摘要

v0.3.4 聚焦四个已经观察到的产品问题，不新增 provider，也不扩大 Forge authority：

1. 用单一模型侧 `edit_file` 替代 `create_file`/`apply_patch` 二选一，支持安全创建、
   精确替换和带版本保护的整文件重写。
2. 按职责拆分 4,646 行的 `apps/cli/src/interactive-ui.tsx`，保留一个兼容 facade，
   且不改变终端交互行为。
3. 让 `/context` mode 可逆：用户既能在当前 session 的 Manual 与 Automatic 间切换，
   也能把任一模式保存为 user default。
4. 复现并消除 interactive resume 后出现的 `MaxListenersExceededWarning`，不能通过
   提高 listener 上限隐藏问题。

产品默认永久保持 **Manual**（配置值为 `manual`）。Automatic
compaction 只通过当前 session 或明确保存的 user opt-in 开启。Quality gate 可以改进或
暂停 Automatic 行为，但不能静默改变默认值。

## Release 依据

### 文件编辑工具选择失败

当前内置写工具为：

- `create_file` 接受 `{ path, content }`，以 exclusive `wx` 创建，路径存在时返回
  `already_exists`，绝不覆盖。
- `apply_patch` 接受 `{ path, edits: [{ oldText, newText }] }`，每个 `oldText` 必须
  精确且唯一，缺失、歧义或并发变化时返回 `stale_patch`。

现有 description 已写明 new/existing file，但字段 schema 没有 model-facing
description；同时 `apply_patch` 这个名字会让模型联想到 Forge 实际并不接受的传统
patch grammar。在真实 DeepSeek session 中，模型已经读过 `style.css`，也成功通过
`apply_patch` 修改了另外两个已有文件，却仍对 stylesheet 调用 `create_file`。失败后
才改用 `apply_patch`。因此根因不只是缺少文件状态，而是当前工具选择本身会浪费
model step、approval interaction 与 tool call。

### Context 控制只能单向开启

当前 persistence surface 有 `enableAutoForSession()`、`saveAutoDefault()` 与
`pauseAuto()`，但 `/context` 只连接了前两个和 compact/preview。`saveAutoDefault()`
固定写入 `context.mode: "compact"`；界面没有把当前 session 改回 `warn` 或把
`warn` 保存为 user default 的动作。`pauseAuto()` 也未连接 UI，而且 paused 是
circuit-breaker 状态，不是持久化的 warn preference。

底层 `saveUserContextMode()` 已接受 `off | warn | compact`，所以无需新增配置格式；
缺口位于 interactive session API 与 UI contract。

### Interactive 生命周期 warning

实际 cross-process resume 输出了：

```text
MaxListenersExceededWarning: Possible EventEmitter memory leak detected.
11 resize listeners added to [WriteStream].
```

这只能证明问题存在，尚不能证明根因。实现前必须结合 `--trace-warnings` 与 listener
count，区分 Forge lifecycle、Ink render cleanup、terminal-size hook 或 dependency
路径。`setMaxListeners()` 明确不属于可接受修复。

## 业界参照与结论

Forge 借鉴设计原则，而不照搬 provider-specific wire format：

- OpenAI Apply Patch 用一个经过专门训练的 operation family 处理 create/update/delete，
  payload 是 V4A diff；它不是普通 custom JSON schema，不能假设 DeepSeek 也掌握。
- Aider 会按模型选择 whole-file、SEARCH/REPLACE、fenced 或简化 unified-diff，说明
  edit format 可靠性与模型家族有关。
- OpenCode 同时提供 exact `edit`、可覆盖的 `write` 与 patch-text `apply_patch`，
  但共享同一 edit permission。
- Gemini CLI 同时提供可创建/覆盖的 `write_file` 与 exact `replace`，写入前显示 diff。

参考资料：

- [OpenAI Apply Patch](https://developers.openai.com/api/docs/guides/tools-apply-patch)
- [Aider edit formats](https://aider.chat/docs/more/edit-formats.html)
- [OpenCode tools](https://dev.opencode.ai/docs/tools/)
- [Gemini CLI file-system tools](https://google-gemini.github.io/gemini-cli/docs/tools/file-system.html)

v0.3.4 默认继续使用 provider-neutral JSON function tool，因为当前 DeepSeek、OpenAI
与 compatible adapter 都能投影该 contract。Raw unified diff 或 V4A 只能在同一任务
评测中胜出后，作为 adapter capability 增加，不能成为未经验证的统一协议。

## Release 目标

1. 普通文本编辑不再要求模型先在 create/update 两个工具名之间选择。
2. 支持高效的整文件换肤或重生成，同时禁止覆盖未读或已并发变化的文件。
3. 保留 workspace boundary、write approval、diff preview、取消、输出限制、trace 与
   session-history 不变量。
4. 旧 session 无需重写 canonical history 即可继续读取，且绝不恢复历史 authority。
5. 为 interactive CLI 建立清晰模块边界与唯一 render owner。
6. 用户无需改 JSON 或重启即可进入和退出 auto compaction。
7. 证明每条 interactive render/unmount 路径都会释放 terminal listener 与共享 client。
8. 用实际质量证据决定 auto 默认，而不是只看 deterministic token reclamation。

## 非目标

- 把文件删除加入 `edit_file`
- 允许 canonical workspace 外写入
- 让任意整文件覆盖免审批
- 默认引入 fuzzy、semantic 或 model-repaired edit
- 在 v0.3.4 实现 OpenAI V4A 或通用 GNU patch parser
- 重写 session v3 中历史 `create_file`/`apply_patch` call
- 只因 tool name 变化而升级 session/checkpoint/trace schema
- 一次性重排 `apps/cli/src` 所有文件
- 用 `EventEmitter.setMaxListeners()` 隐藏 listener 增长
- 用 scripted/fake model 声称 DeepSeek live selection quality
- 在 quality gate 前默认开启 auto compact
- 把 checkpoint 当成可信指令、审批、当前 verification 或 canonical transcript 替代品

## 跨功能不变量

### Authority 与安全

- `edit_file` 仍是 `write` risk，所有调用继续经过 core policy、approval、execution、
  event 与 trace。
- 一个 path/operation/content 的 preview 不会批准另一个动作。
- Project instruction、Skill、checkpoint、resume history 和 tool result 不能启用写权限
  或选择 permission scope。
- Create 不覆盖已有路径；rewrite 不创建缺失路径。
- Replace/rewrite 不丢弃用户并发修改。
- Commit 前取消保持原文件不变。
- Tool error 是有界 structured result，不暴露原始 filesystem detail。

### History 与迁移

- Canonical session history 原样保留模型看到的历史工具名与输入，不为制造“新工具早已存在”
  的假象而重写。
- Resume 后模型得到当前 tool definition 与历史已完成 call/result；历史存在不代表旧工具
  仍可执行。
- 迁移不能恢复 pending write 或 approval。
- Display fallback 同时理解 legacy 与新 tool event，不能伪造成功编辑。

### Context 与配置

- `warn` 和 auto 是用户可选 behavior；`paused` 是取消、无效输出、反复失败或低回收后
  的 runtime safety state。
- Session-only selection 不写入 snapshot，也不由 `/resume` 恢复。
- 保存 user default 只改 context mode，保留其他用户配置。
- 用户显式 session 动作可以暂时停止由 effective `compact` 启动的自动压缩；新进程重新
  计算 user/project precedence。
- 如果项目设置让 effective mode 比 user default 更严格，UI 同时显示 saved value 与
  effective provenance。

## 工作流 A：统一模型侧文件编辑

### A.1 语义 contract

稳定语义输入是带 operation discriminator 的 union：

```ts
export type EditFileInput =
  | {
      readonly operation: "create";
      readonly path: string;
      readonly content: string;
    }
  | {
      readonly operation: "replace";
      readonly path: string;
      readonly edits: readonly {
        readonly oldText: string;
        readonly newText: string;
      }[];
    }
  | {
      readonly operation: "rewrite";
      readonly path: string;
      readonly content: string;
      readonly expectedSha256: string;
    };
```

模型只看到一个工具：

```ts
const editFileTool: ForgeTool = {
  name: "edit_file",
  description:
    "Create a new text file, replace exact text in an existing file, or rewrite an existing file that was read at the supplied version. Never use create for an existing path.",
  inputSchema: editFileInputSchema,
  risk: "write",
  execute: editFile,
};
```

每个字段都增加简短 model-facing description。语义 union 固定，但 Phase A0 要在冻结 wire
schema 前比较两种 JSON Schema 表达：

1. Zod discriminated union：branch requirement 清楚，但可能生成 compatible endpoint
   不稳定遵循的 `anyOf`/`oneOf`。
2. 扁平 object：`operation` enum + optional branch fields，并在 runtime 严格做 cross-field
   validation；模型更容易生成，但 JSON Schema 表达力较弱。

两者使用相同 prompt、model settings 与 executor。最终依据 DeepSeek schema-valid rate 与
first-call operation accuracy 决定，再确认 OpenAI/compatible adapter 的 deterministic
projection。不能只按 TypeScript 类型是否漂亮选择。

实现结果：产品采用 flat JSON Schema encoding，并在 runtime 严格执行 cross-field
validation，同时保留 discriminated TypeScript semantic type。一次有界、明确授权的
DeepSeek development 对比可正常接受 flat call，而 discriminated-union request 被
HTTP 400 拒绝；legacy 与 union 只保留为 evaluator baseline。

### A.2 Operation 语义

#### `create`

- 复用 `resolveNewToolPath()` 与 exclusive `open(..., "wx")`。
- Path 非空且位于 workspace；content 上限保持 65,536 UTF-8 bytes。
- 任意已有路径返回 `already_exists`。
- 取消或写失败时继续清理 partial file。
- Preview 使用 `/dev/null` → `b/<path>`。

#### `replace`

- 复用 exact `oldText` → `newText`。
- 1-50 个 edits；每个非空 `oldText` 在逐步更新后的 content 中恰好出现一次。
- 单文件全部成功或全部不写。
- 写前再次读取；prepare 后变化返回 `stale_patch`。
- 保留有界 unified-diff 作为用户 preview；模型不提交该 grammar。

#### `rewrite`

- Target 必须是已有 regular UTF-8 file。
- 必须传入此前 `read_file` 返回的 `expectedSha256`。
- `ReadFileOutput` 增加对完整原始 content 的 lowercase SHA-256；truncated read 不产生可用于
  rewrite 的版本授权。
- Preview 前及 commit 紧前都对当前 bytes 计算 digest 并比较。
- 版本不一致返回 `stale_file`，要求重新读取后再调用。
- Approval 展示完整 old→new diff；展示可截断，但底层 comparison 不因截断放宽。
- 绝不创建缺失文件，也不 fallback 到 create。

`rewrite` 面向 stylesheet 或生成配置等明确整文件替换，不是 blind `write_file`。
Content-version precondition 防止用户或其他进程修改后仍被静默覆盖。

### A.3 输出与错误

成功结果共享稳定 metadata：

```ts
interface EditFileOutput {
  readonly operation: "create" | "replace" | "rewrite";
  readonly path: string;
  readonly bytes: number;
  readonly replacements?: number;
  readonly sha256: string;
  readonly diff: string;
}
```

主要 failure code：

| Code | 含义 | 恢复方式 |
| --- | --- | --- |
| `invalid_input` | Operation 与 branch fields 不匹配 | 修正 call shape |
| `already_exists` | create 指向已有路径 | 使用 replace 或 guarded rewrite |
| `not_found` | Existing-file operation 指向缺失路径 | 检查 workspace |
| `not_file` | Target 不是 regular file | 选择普通文本文件 |
| `stale_patch` | Exact context 缺失、歧义或变化 | 重读并使用精确文本 |
| `stale_file` | Rewrite digest 已变化 | 重读并传新 digest |
| `outside_workspace` | Canonical path 逃逸 | 选择 workspace 内路径 |
| `cancelled` | Commit 前取消 | 不得声明成功 |
| `io_error` | 有界 filesystem failure | 检查/重试且不暴露内部路径 |

### A.4 Registry 与兼容

- 模型侧 built-in definition 只注册 `edit_file`。
- v0.3.4 期间保留 `createFile()`、`applyPatch()` 与 schemas 作为 internal/exported primitive，
  新 dispatcher 复用它们，不复制执行逻辑。
- 新 model request 不再广告 `create_file`/`apply_patch`。
- 过渡期保留三个 reserved name，避免 plugin 占用 legacy name 后重新解释 resume history。
- 模型调用未广告 legacy name 时，返回有界 `unknown_tool` 并提示使用 `edit_file`；不能通过
  hidden alias 执行。
- Canonical historical call 不修改，trace/resume renderer 继续识别 legacy name。
- Tool name/schema 改变必须提升 `FORGE_PROMPT_SCHEMA_VERSION`，诚实使 prompt cache prefix
  失效。

### A.5 Approval 与界面

把 `apps/cli/src/run.ts` 中按 tool name 分支的 preview 改为按 `edit_file.operation` 分派。
Approval descriptor 继续由 host 从 validated input 派生。

Activity label：

```text
Preparing file creation · path
Creating file · path
Preparing file edit · path
Editing file · path
Preparing file rewrite · path
Rewriting file · path
```

Visible proposal 可以显示 operation：

```text
○ Proposed edit_file · rewrite style.css
◇ CONFIRM edit_file — The first workspace write requires approval.
✓ Completed edit_file · rewrite style.css
```

Diff 继续使用 Ink native style，并保留 `ADD`/`DEL`、`+/-` 与 line-number cue；不能把 raw
ANSI string 注入 Ink component。

### A.6 Tool-choice 评测

增加 deterministic contract 与显式 opt-in live runner。Deterministic suite 证明 schema、
执行、错误、preview、cache invalidation 和 recovery，不能证明 model selection quality。

DeepSeek live matrix 至少包含：

1. 创建明确不存在的文件。
2. 小范围修改已读文件。
3. 读取后重写大部分 stylesheet。
4. Create 指向已有文件并恢复。
5. Read 后外部修改，再从 `stale_file` 恢复。
6. 同一任务修改多个已有文件并创建一个新文件。

在相同 model ID、thinking、effort、prompt、workspace 与 limits 下比较当前双工具 baseline、
union candidate 与 flat candidate，记录：task success、第一次 write operation accuracy、
schema-valid rate、无意义失败写、首个成功写之前的 step/approval、provider 报告的 token 和
最终 filesystem grader。

不得提交 credential 或完整私有 trace。只有真正运行并复核后，才在
`evals/reports/v0.3.4/` 保存有界脱敏报告。

## 工作流 B：Interactive CLI 拆分

### B.1 目标布局

保留 `apps/cli/src/interactive-ui.tsx` 作为小型兼容 facade，使 `session.ts`、`resume.ts` 与
现有 import 在第一阶段不变。新增：

```text
apps/cli/src/interactive/
  app.tsx                 # 顶层 state composition 与 phase routing
  lifecycle.tsx           # 唯一 Ink render owner 与 terminal cleanup
  types.ts                # interactive-only state types
  providers.tsx           # provider/model/login/logout selectors
  prompt.tsx              # editor、cursor、completion、footer
  transcript.tsx          # canonical/run-event mapping 与渲染
  context.tsx             # context panel、mode selector、indicator
  approvals.tsx           # approval、permissions、diff
  resources.tsx           # plugin/resource/trust panels
  activity.ts             # run activity 推导与格式化
```

`interactive-model.ts`、`markdown.tsx`、`persistent-session.ts`、`provider-setup.tsx`、
`run.ts` 与 `update.ts` 在本 release 保持当前位置。一次性移动整个 CLI 只会制造大量 path-only
diff，不能直接解决本轮四个问题。

### B.2 依赖方向

```text
interactive-ui.tsx facade
          |
          v
interactive/lifecycle.tsx ---> interactive/app.tsx
                                      |
                 +--------------------+--------------------+
                 v                    v                    v
          pure UI panels       domain hooks/state     existing CLI services
                                                            |
                                  run.ts / persistent-session.ts / update.ts
```

- Panel 只 import Ink、React type、interactive type 和 pure formatter。
- Panel 不加载 config、不创建 model client、不执行 tool、不持久化 session。
- `app.tsx` 协调 domain，但不拥有 process-level render。
- `lifecycle.tsx` 对一次 interactive invocation 只拥有一个 `render()` 与完整 cleanup。
- Core/persistence/tools package 不得 import interactive directory。

### B.3 拆分顺序

1. 先移动 pure type/formatter 与对应 focused test。
2. 不改 props/snapshot 地移动 leaf panel。
3. 移动 transcript 与 run-activity derivation。
4. Render parity 通过后，再把 provider/resource/context/approval state 移入 domain hook 或
   controller。
5. 移动 `InteractiveApp` shell，facade 保留 re-export。
6. 最后隔离 lifecycle/render ownership 并增加反复 mount/unmount test。

每个 extraction commit 运行 focused UI test 与 `git diff --check`，不能把 mechanical move
和新的 context/tool 行为混在同一 commit。

### B.4 可维护性验收

- `interactive-ui.tsx` 只保留 export 与 CLI wiring，不再承载数千行 state/render logic。
- Leaf panel 不 import `runTask`、config loader、session store 或 provider client。
- 只有一个 module 拥有 process-level Ink render/unmount。
- 过渡期 facade 继续暴露 `InteractiveApp`、`runInkInteractiveFromCli`、keyboard helper 与
  测试使用的 panel。
- 宽/窄 snapshot 保留有意义内容、语义颜色、Enter/newline/Ctrl+C、approval、completion
  navigation 与 screen-reader 可见文本。

## 工作流 C：可逆 Context mode

### C.1 状态模型

区分当前 UI 混在一起的三个概念：

```ts
type ConfiguredContextMode = "off" | "manual" | "automatic";
type SessionContextOverride = "manual" | "automatic" | undefined;
type AutoCompactionState = "inactive" | "armed" | "compacting" | "paused";
```

现有 pressure label 可以继续使用 `warn`、`auto-session`、`auto-default`、`paused`，但它们
应从 configured mode、session override 与 safety state 推导，不再作为可变 source of truth。

用对称 intent API 替代单向方法：

```ts
interface InteractiveSessionPersistence {
  setContextModeForSession?(mode: "manual" | "automatic"): void;
  saveContextModeDefault?(mode: "manual" | "automatic"): Promise<{
    readonly path: string;
    readonly savedMode: "manual" | "automatic";
    readonly effectiveMode: "off" | "manual" | "automatic";
    readonly effectiveSource: string;
  }>;
  compact?(dryRun: boolean): Promise<string>;
}
```

`pauseAuto()` 保留为内部失败/取消 transition，或重命名突出该职责。选择 `warn` 不能显示
为 `paused`。

### C.2 `/context` 交互

快捷行改为：

```text
m change mode · c compact now · p preview · Esc close
```

按 `m` 打开 selector：

```text
Context mode

› Manual · ask before compacting
  Automatic · compact when needed
  Save Manual as user default
  Save Automatic as user default
```

No-progress guard 导致 paused 时额外显示 `Resume auto for this session`。Session mode 与
保存 default 始终是两个不同动作。

每次动作后刷新 footer 与 panel 共用的 `ContextStatus`，并显示明确反馈：

```text
Context mode · Manual for this session
Context mode · Automatic for this session
Saved Manual as the user default in /…/.forge/config.json
```

如果 project `compact` 仍让 effective mode 为 auto，则显示：

```text
Saved user default: Manual
Effective mode: auto · project .forge/config.json
```

Precedence 没有改变 effective mode 时，不能假装切换成功。

### C.3 Session 与 resume

- `Manual · ask before compacting` 立即禁止 pressure-driven checkpoint generation，但手动
  `/compact` 仍可用。
- `Automatic · compact when needed` 持续到退出、显式 Manual 或 safety pause。
- 两种 session choice 都不序列化、不恢复。
- 保存 default 更新 `$FORGE_HOME/config.json` 且保留其他字段。
- 新进程加载 default 并重新应用 project/CLI precedence。
- `/clear`、`/new`、`/resume` 清理 transient activity/safety state，但不静默改写已保存
  preference。

### C.4 Auto 默认 gate

把 `DEFAULT_CONTEXT_CONFIGURATION.mode` 和 config schema default 从 `warn` 改为
`compact` 是最终可选阶段，不是前置任务。

必须满足：

- deterministic safety/resume suite 零 invariant regression
- 没有 request 超过声明 input budget
- long-session matrix 中位 projected input reclamation 至少 30%
- 相对 warn 的 task pass rate 回退不超过 5 个百分点
- seeded durable-constraint recall 至少 95%
- edited-file tracking、unresolved work 与 verification provenance 保留
- recovery 不重复 user request 或 tool side effect
- 低价值 compact 会 pause 而不是循环
- 有界 opt-in DeepSeek live report 通过同一 task-quality 标准

观察到的 DeepSeek model 有超大 context window，因此 live harness 可以在隔离配置下降低
activation threshold 并注入 synthetic completed history；报告必须披露这一点，不能宣称自然
跑到了 1M context 的 78%。

任一 gate 失败时，v0.3.4 仍交付可逆控制并保持默认 `warn`。这不阻塞文件编辑器或 CLI
lifecycle release。

## 工作流 D：Terminal listener 生命周期

### D.1 先复现再修复

仅在 test 或显式 local diagnosis 中加入诊断：

1. Render 前记录 `process.stdout.listenerCount("resize")` 与相关 stream event。
2. 用受控 TTY-like stream 反复启动/退出/resume interactive UI。
3. 在 `waitUntilExit()`、显式 unmount 与 client cleanup 后分别记录 count。
4. 用 `node --trace-warnings` 捕获 listener 注册 stack。
5. 区分同进程反复 render 与真正 cross-process resume；listener 不可能跨 OS process 保留。

Warning 文本本身不足以确定 owner，必须按 stack 与 count delta 决定修 Forge、Ink、
`useWindowSize` 或 test/render reuse。

### D.2 Lifecycle contract

- 一次 `runInkInteractiveFromCli()` 只拥有一个 Ink instance。
- 正常 `/exit`、double Ctrl+C、初始化失败、resume 拒绝、task throw 与取消都 exactly-once
  unmount。
- Shared Codex App Server client 在 UI 退出后关闭，不能因 React re-render 重建。
- 订阅 stream、timer、signal、update service 或 model event 的 effect 必须返回 cleanup。
- Cleanup idempotent，error + `finally` 不会删除其他 invocation 的 listener。
- 每个已完成 invocation 后 listener count 回到 render 前 baseline。

### D.3 回归测试

- 对同一受控 output stream 真实 mount/unmount interactive shell 至少 12 次，断言无 warning
  且 listener count 回到 baseline。
- Mounted 时投递 resize，确认 UI 仍响应。
- 覆盖 resume、`/new`、`/clear`、正常退出与取消。
- 断言无 leaked timer、signal handler、Codex client 或 update subscription。
- Release checklist 保留 Ghostty manual smoke，因为 mocked stream 不能证明真实 reflow。

## 模块变更映射

| 方向 | 当前文件 | 计划职责 |
| --- | --- | --- |
| Tool schema/execution | `packages/tools/src/create-file.ts`、`apply-patch.ts`、`read-file.ts`、`registry.ts` | 新增 `edit-file.ts`、digest/version、dispatcher 与 registry transition |
| Core | `packages/core/src/runtime.ts`、`approval.ts`、`cache.ts` | 保持 generic tool path；更新 prompt schema version/fixture，不按 provider 分支 |
| Adapter | `packages/model-deepseek`、`model-openai`、`model-compat` | 验证同一 model definition 正确投影，adapter 不拥有 edit 语义 |
| CLI approval | `apps/cli/src/run.ts` | Operation-aware preview 与 output |
| Interactive UI | `apps/cli/src/interactive-ui.tsx` | 兼容 facade；行为移入 `apps/cli/src/interactive/` |
| Context persistence | `apps/cli/src/persistent-session.ts` | 对称 session/default API 与 provenance-aware result |
| Config | `packages/config/src/loader.ts`、`schema.ts` | 复用 mode writer；gate 前不改默认 |
| Resume | `packages/persistence`、`apps/cli/src/resume.ts` | 不升级 schema；安全显示 legacy/new history |
| Evals | `evals/src`、`evals/reports/v0.3.4/` | Deterministic contract 与显式 opt-in report |
| Docs | Roadmap/current product guides | 实现前把 plan 与 shipped behavior 分开 |

## 测试矩阵

### Tools

- 创建 empty/non-empty UTF-8 file
- 拒绝 existing path、traversal、symlink-parent escape、directory target 与非法 parent
- 单个/多个 exact replacement 与顺序应用
- 缺失/歧义 `oldText`
- Matching digest rewrite
- External modification 后 rewrite
- Truncated/unavailable read version
- Prepare/commit 前取消
- 有界 diff/output、multibyte UTF-8、final newline 与 65,536-byte limit
- Model schema 只导出 `edit_file` 且无 execute callback

### Runtime、policy 与 history

- 首次 workspace write 确认，session scope 保持窄
- Failed edit 不错误扩大或复用 approval
- 每种 operation/failure 的 canonical call/result 都闭合
- Legacy session 不迁移即可 resume
- 当前 model definition 不广告 legacy tool
- Cache-prefix reason 记录 tool-schema change
- Plugin reserved-name collision 确定且可操作

### CLI 与 Ink

- Create/replace/rewrite 在 color 与 `NO_COLOR` 下都有 diff preview
- 宽/窄 panel 保留 `ADD`/`DEL` cue
- Activity 与 failure label 包含 operation/path
- Enter/newline/Ctrl+C 不变
- Context selector 支持 arrow、Enter、Escape 与窄终端
- Saved/effective provenance 文案准确
- 12 次 mount/unmount 后 listener count 不变

### Context

- warn → auto-session → warn（同一进程）
- warn → save auto default → save warn default
- auto-default → warn session 且不改磁盘
- project compact + user warn 显示 effective project compact
- safety pause 与 selected warn 可区分
- resume 不恢复 session override
- warn 下 manual compact 仍可用
- cancel/low reclaim pause auto 且不损坏 session

### Provider/evaluation

- DeepSeek mocked round trip 覆盖每个 edit operation
- OpenAI/compatible schema projection 不引入 provider-specific execution
- Fake model 从 `already_exists`、`stale_patch`、`stale_file` 恢复
- 显式 opt-in DeepSeek selection matrix 与 compaction quality matrix
- `pnpm test`/`eval:deterministic` 不发付费请求

## 交付阶段

### Phase 0：Baseline 与协议决定

- 加入 deterministic tool-contract fixture。
- 加入 opt-in tool-choice evaluator，但不声称结果。
- 获得明确授权后记录当前双工具 DeepSeek baseline。
- 用 trace/count 复现 listener growth。
- 冻结 semantic union 并选择 JSON Schema encoding。

Exit gate：baseline 明确区分 deterministic behavior、live model selection 与 lifecycle evidence。

### Phase 1：`edit_file` executor

- 增加 read digest/version metadata。
- 复用现有 primitive 实现 create/replace/rewrite prepare 与 execute。
- 增加 focused test、failure code 与 preview。
- 此阶段不改变 model registry。

Exit gate：executor contract 通过，模型行为尚未变化。

### Phase 2：Model registry 与 CLI migration

- 广告 `edit_file`，从当前 model definition 移除 legacy name。
- 更新 prompt-schema version/cache diagnostic。
- 更新 approval preview、activity、reserved name、runtime/history fixture 与 adapter projection。
- 获得授权后运行 DeepSeek 对比。

Exit gate：offline cross-provider contract 通过；删除 transition code 前，复核后的 live evidence
不得劣于 baseline。

### Phase 3：保持行为的 UI extraction

- 提取 pure panel、formatter、type。
- 把 domain state/top-level app 移到 facade 后。
- 每个 commit 保持 snapshot 与 keyboard semantics。

Exit gate：facade 兼容，focused/full UI test 通过，且没有预期产品输出变化。

### Phase 4：Context mode selector

- 增加对称 session/persisted method。
- 增加 selector、confirmation 与 provenance。
- 增加 transition、resume 与 config-preservation test。

Exit gate：每个 auto state 都有可见回 warn 路径，且两种 default 都在磁盘验证。

### Phase 5：Lifecycle 修复

- 只实施 listener stack 支持的最小修复。
- 集中 render/unmount ownership。
- 增加 repeated lifecycle regression 与 Ghostty smoke。

Exit gate：listener count 回到 baseline，且没有提高 max listener。

### Phase 6：Compaction quality 决定

- 在最终代码上运行 deterministic warn/compact matrix。
- 运行经明确授权的 DeepSeek live trial。
- 发布有界脱敏 report。
- 全部 gate 通过才改默认，否则记录为何保留 `warn`。

### Phase 7：Release hardening

- 按真实行为更新 current-product 中英文文档。
- 实现状态最终确定后才把本文移到 `docs/history/v0.3.4/`，并在同一变更更新 catalog。
- 只为 exact candidate HEAD 创建 release evidence。
- Tag/push/npm/GitHub Release 前运行下述全部 gate。

## 验证命令

Focused checks：

```bash
CI=true pnpm exec vitest run packages/tools/src/tools.test.ts
CI=true pnpm exec vitest run packages/tools/src/recovery.test.ts
CI=true pnpm exec vitest run apps/cli/src/run.test.ts
CI=true pnpm exec vitest run apps/cli/src/persistent-session.test.ts
CI=true pnpm exec vitest run apps/cli/src/interactive-ui.test.tsx
```

Candidate gates：

```bash
CI=true pnpm check
CI=true pnpm test
CI=true pnpm eval:deterministic
node scripts/build-doc-index.mjs
CI=true pnpm check:docs
CI=true pnpm package:verify
git diff --check
```

Live evaluation 始终显式 opt-in，不加入默认 test。Loopback route test 可能需要绑定
`127.0.0.1` 的权限；sandbox `EPERM` 要报告为环境限制，不能静默判定产品 regression。

## Release 验收标准

### v0.3.4 必须满足

- 新 model request 只广告一个 `edit_file`，不再提供 create/update 双工具名。
- Create、exact replace 与 guarded rewrite 保留 workspace/concurrency safety。
- v0.3.3 session 原样 resume，不恢复 authority。
- 若 release 声称 DeepSeek live selection quality，则证据必须当前、有界且与 baseline 对比；
  否则明确只通过 offline validation。
- `interactive-ui.tsx` 成为兼容 facade，interactive domain 有明确边界。
- 用户完全通过 `/context` 选择 session warn/auto，并保存 user default warn/auto。
- Saved preference 与 effective project/CLI precedence 不混淆。
- Repeated lifecycle test 与 Ghostty resume smoke 无 listener warning/count growth。
- Exact candidate HEAD 通过 full offline、deterministic、docs、package 与 installed CLI gate。

### 条件性默认变化

- 只有 Phase 6 全部门槛通过且 report 在代码默认变化前完成复核，auto 才成为产品默认。
- 若继续 `warn`，release note 明确说明，并记录完整可逆 `/context` control。

## 回滚策略

### File editor

- 旧执行 primitive 保留一个 release，model registry 可回退且不恢复用户数据。
- 没有 session schema migration，rollback 不重写 snapshot。
- Live selection regression 时重新广告 legacy definition，把 `edit_file` 留在 disabled experiment；
  不能用 unsafe overwrite alias。

### Interactive 拆分

- Facade/public export 保留，各 extraction commit 可独立回退。
- Module move 与行为变化分开，便于 bisect/rollback。

### Context

- `warn` 与 `compact` 本来都属于 config schema v1，rollback 无需 migration。
- 回退 mode 时不删除其他用户配置。
- 若新 default 回退，只改 code/config default；不能覆盖用户显式保存的 `compact`。

### Listener

- Terminal compatibility regression 时只回退 lifecycle change。
- 即使首个 fix 撤回，也保留 reproduction test 与 trace evidence。
- 不能用更高 listener ceiling 代替修复。

## 文档范围

本文属于 `current-development`，不打包进 product help。实现过程中，只有对应行为已存在并
验证后才更新 current-product：

- `ARCHITECTURE.md`：built-in tool 表与 interactive module boundary
- `CLI_UI.md`：edit activity、`/context` selector 与 mode label
- `CONFIGURATION.md`：可逆 user default 与 effective precedence
- `CONTEXT_MANAGEMENT.md`：selected/default/paused 区别与最终 rollout
- `SESSIONS.md`：legacy tool-history compatibility（若用户可见）
- `SECURITY_MODEL.md`：rewrite precondition 与未变化的 authority boundary
- `TROUBLESHOOTING.md`：stale-file recovery 与 terminal listener diagnosis
- `PRODUCT.md`：仅当默认 compaction policy 改变

每项英文变更都有互链的简体中文等价文档。任何 add/delete/move/role change 都更新
`docs/catalog.json`；product-help 仍只由 `currentProduct` 生成。Release report 位于
`evals/reports/v0.3.4/`，不写入本文。
