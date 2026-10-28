# 评测指南

[English](../../development/EVALUATION.md) · [中文目录](../README.md)

## 目的

Forge 将 runtime 正确性与 live model 质量分开测量。默认套件不发起付费模型请求；脚本化模型和 fake transport 验证循环、审批、工具、恢复、限制、trace 和上下文行为。显式 opt-in 的 live trial 才测量 provider 是否能完成真实仓库任务。

## 任务

规范 fixture 是 `fixtures/validation-bug`。它要求 Agent 阅读实现、调用方和测试，修复 `parsePort` 对输入校验过于宽松的问题，运行 `pnpm test`，并以与实际 diff/测试结果一致的总结结束。每次 trial 都从全新的临时 workspace 开始；grader 在 Agent 停止后于外部运行，模型不能修改 grader 或隐藏测试。

额外任务可以复用同一 runner、approval channel、trace schema 和 grader contract。任务 manifest 必须定义初始文件、prompt、验证命令、允许的审批范围和成功条件。

## 确定性证据

```bash
pnpm eval:deterministic
```

确定性套件使用 fake `ModelAdapter`，测试正常完成、工具失败后恢复、取消、限制、拒绝 workspace 外路径，以及完整事件序列。测试不需要 API key，也不会调用 provider。

## Live DeepSeek 试验

live trial 显式 opt-in，因为会产生付费请求：

```bash
FORGE_EVAL_LIVE=1 pnpm eval:live
```

Evaluator 使用与 Forge 相同的 DeepSeek 凭据解析：优先使用
`DEEPSEEK_API_KEY`，其次使用 `/login` 保存的 owner-readable credential。
解析出的 key 只传给隔离的运行进程，不写入报告或 trace。

Milestone 15 的文件编辑选择比较沿用同一显式 opt-in guard 和 task/trial 设置。分别使用 `--edit-contract legacy`、`union`、`flat` 并写入清楚标记的独立输出目录；legacy contract 只存在于 evaluator，正常 CLI 绝不广告它。选定 schema 前应比较 task success、首次 write-call 准确率、无效/失败 write、approval、step、token 与最终 filesystem grader。

产品最终选择 `flat` encoding：单个 `edit_file` object 使用 `operation` enum 与 optional
branch field，并在 runtime 严格执行 cross-field validation。Evaluator 只为对比保留
`legacy` 与 `union`；省略 `--edit-contract` 时使用 `flat`。

runner 使用 `deepseek-v4-flash`，每次复制 fixture 到新临时目录，使用窄审批通道，只允许 fixture 根目录的 `pnpm test`（超时 60 秒）。不匹配的命令或 workspace 外动作会被拒绝。Live 失败必须保留在报告中，不能为了提高通过率删除或重写。

正式 release run 必须使用 clean Git checkout。开发阶段可传
`--allow-dirty`，报告会记录 base commit 与 SHA-256 worktree fingerprint；
这类输出不能复制到 `evals/reports/`，也不能作为 exact-HEAD release evidence。

## 报告与 trace

```text
evals/
|-- tasks/
|-- src/
|-- reports/
|   |-- README.md
|   |-- v0.1/
|   |   |-- report.json
|   |   |-- report.md
|   |   `-- traces/
|   `-- v0.2/
`-- dist/
```

JSON 报告记录 Forge commit、任务、trial、model、thinking、status、grader、耗时、步骤、工具调用、token、失败验证、拒绝动作、限制和 trace path。Markdown 报告聚合通过率和平均值，但不删除失败。发布前复制脱敏报告到 `evals/reports/v0.1/`，并用 `forge inspect <run-id>` 校验引用的 trace。原始 trace 可能含仓库数据，发布前必须审查。

## 当前 provider 模型

默认 `deepseek-flash` 依据当前[官方模型表](https://api-docs.deepseek.com/quick_start/pricing/)和[图像指南](https://api-docs.deepseek.com/guides/vision/)配置，支持 Chat Completions 图片输入。旧 ID `deepseek-v4-flash` 和 `deepseek-v4-flash-vision-exp` 作为已有配置与任务的兼容别名保留。`deepseek-v4-pro` 仍可选择，但拒绝图片。Forge 显式选择 thinking 模式。离线 transport 测试不等于付费 live provider 验证。下方 v0.1 证据属于历史记录。

## v0.1 证据

2026-08-19（北京时间）的 release evaluation 在 commit `65c0a51` 上使用开启 thinking 的 `deepseek-v4-flash`，对 3 个小型 TypeScript 修复任务各运行 3 次，共 9 次，端到端通过 7 次：`config-merge` 为 3/3，`retry-cache` 为 2/3，`validation-bug` 为 2/3。只有运行状态为 `completed`，且 fixture 自有测试与外部隐藏 grader 均通过，才计为端到端通过。这是历史小样本基线，使用当时的 `apply_patch` 工具契约，不能代表当前版本的通用编码能力。

两次未通过运行均保留在[原始 JSON 报告](../../../evals/reports/v0.1/report.json)中，需要区分运行终止原因与事后评分：

| 任务与 trial | 运行状态 | 事后公开测试 | 事后隐藏测试 | Trace |
| --- | --- | --- | --- | --- |
| `retry-cache` trial 1 | `denied` | 通过 | 通过 | [16c7e4a1](../../../evals/reports/v0.1/traces/16c7e4a1-02cf-45f3-bf9c-f97a7e9020d1.jsonl) |
| `validation-bug` trial 2 | `denied` | 通过 | 失败 | [d7547e89](../../../evals/reports/v0.1/traces/d7547e89-f74c-4392-b502-ef75018ee462.jsonl) |

两份 trace 都记录了命令请求 `timeoutMs: 120000`；窄评测审批只允许 60000ms，因此命令未获批准，运行以 `denied` 结束。这不是命令执行 60 秒后超时。`retry-cache` 的修复通过了事后测试，但运行未完成，仍计为未通过；`validation-bug` 同时还未通过隐藏测试。不能将两个样本简单划分为互斥的“审批失败”和“修复失败”，也不能把前者称为评分器误判。

[Markdown 汇总](../../../evals/reports/v0.1/report.md)与 9 个 JSONL trace 已检入仓库。发布时已检查 schema、序号、run ID、终止状态及 API key 泄漏；这些是历史发布检查记录，不等于本次重跑 live 评测。

## Milestone 10 context gate

默认套件在同一份合成长 session transcript 上比较 `off`、`manual` 和 `automatic`，不调用 provider。它记录任务成功、估算与 fake provider input、估算误差、本地延迟、压缩次数、保留轮次和 summary 重生成；另有 fixture 覆盖 mandatory overflow、一次性恢复、部分输出不重试、tool-result projection、恶意 history 和 resume 完整性。`manual` 永久保持产品默认。

Milestone 13 增加了已检入的 [v0.3.2 对比基线](../../../evals/reports/v0.3.2/M13_BASELINE.md)、stable prefix/失效 fixture、unavailable 与零值 cache accounting、压力触发压缩、低回收暂停，以及 session/default mode 测试；它们都保持离线。自动压缩可在 TUI 中发现并显式启用，但该基线不会把 extractive oracle 提升为默认行为。

[v0.3.3 Milestone 13 release gate](../../../evals/reports/v0.3.3/M13_RELEASE_GATES.md) 进一步覆盖 exact/near-match permission scope、deny feedback、canonical workspace 与高风险拒绝、异步更新与 dismiss、安装来源、受保护的 `FORGE_HOME` 和窄/宽 Ink 渲染。报告明确记录 live trial 需要 `eval:live` 显式 opt-in，本次离线 gate 没有付费调用。该报告早于 Milestone 14 structured history，只是历史 M13 证据。当前 deterministic release matrix 还会运行[跨层 session contract](../../../evals/src/session-contract.test.ts)，覆盖 runtime canonical delta 到 save/load、resume projection、checkpoint validation、取消结果恢复、重复 provider call ID、不恢复 approval state，以及 durable-size 拒绝。

资源评测默认同样确定性、离线运行。脚本化 fixtures 覆盖匹配、不匹配、歧义、显式调用、用户关闭自动调用、冲突、重复加载、超预算、对抗性 Skill、产品问题和未知问题。指标包括选择精确率/召回率、不必要加载、目录与已加载 token、引用准确率、延迟和任务完成率；真实供应商资源试验仍需显式启用。

## 固定观察记录的负面证据对照

[对照脚本](../../../evals/scripts/compare-negative-evidence.mjs)固定原始 Q06
题目、depth=1 文件清单和 analytics 字面搜索，复用现有原生调查指令，比较
请求模型名（deepseek-flash / deepseek-v4-pro）与上下文组织（成对工具历史 /
同一观察集中放入不可信证据包）。四种组合各两个样本，预定顺序交错。
这是合成历史投影，不是原始提供商请求重放或桌面验收。

```bash
CI=true pnpm eval:negative-evidence --prepare --output /tmp/forge-negative-compare-new
CI=true pnpm eval:negative-evidence --check --output /tmp/forge-negative-compare-new
CI=true pnpm eval:negative-evidence --fixture --output /tmp/forge-negative-compare-new
# 明确选择的付费诊断，不更改产品模型配置或安装版：
CI=true pnpm eval:negative-evidence --live --output /tmp/forge-negative-compare-new
```

prepare/check/fixture 不读取凭据、不访问提供商。live 总计最多八次请求，
每样本一次、每次最多 4096 输出 token、90 秒，无工具执行器、不跟随重定向，
拒绝额外 HTTP 重试；服务/认证/中断错误停止整批。无效协议或不完整输出记为该组
结果，其余预定独立组继续，不重试失败组、不覆盖旧尝试。输入、脚本、策略、schema
或源码版本改变时需要新目录重新准备。保留实际请求正文、提供商 usage 和
回答，不保存认证头或生成的推理正文。语义复核与正常结束/输出文字分开。
请求/返回的模型标签不能证明底层权重不同，每组两个样本也不能证明通用
可靠性或用户成功率。

## 实验证据收尾与审核后总结

真实桌面试跑支持 --finalization-input continuation|evidence，默认仍为
continuation，只有隔离试跑的显式宿主覆盖才能选 evidence。为不同模式/轮次
准备新目录，然后执行：

```bash
node apps/desktop/scripts/product-live.mjs --check --task E01 --task F03 --finalization-input evidence --recover-summary --round /tmp/fresh-evidence-round
```

相同选择的 live 为明确付费操作，按既有脚本要求从 apps/desktop 目录运行。
--recover-summary 在所选 E01/F03 原运行后增加独立的审核/确认总结（一步、
零工具），不改变原预算、不自动恢复产品。原 pilot-result/events 不覆盖，
另存 recovery-result 及审核/总结截图；projection-observation 记录模式请求
和对应模型步骤是否开始。原运行提前结束不算测到预留投影。分别核对命令
退出/验证、修改范围、独立端口断言、来源关联、未知结果及草稿保留。

### 产品默认配置修复试跑

桌面 opt-in 启动器 `apps/desktop/scripts/product-live.mjs` 对 E01/E02/E04/E05/D05
支持 `--product-defaults`，`--check` 和 `--live` 必须使用同一标志。隔离配置
不写入总次数限额，使用当前产品默认值，替代场景原有六步限制。计划和结果记录
可空限额及执行配置；有界协议和 F03 不变。faults-v3 E04 仅替换六步预算文案，
先写回归测试的流程、准确命令和文件审批范围保持不变。

单次实验有 600 秒宿主截止及 630 秒启动器 watchdog，属于测试保护，不是产品
总次数限制或金额预算。超时应记为失败而非完成。仍要求全新种子、不自动重试
整个任务、独立行为检查及源码审查。外部调用须事先获得用户授权；`--check`
不读取凭据、不调用 provider。三个抽样任务不能替代 24 项两轮和独立用户验收。

### 新任务回归契约诊断

opt-in `desktop-product-faults-v4` 允许 E02/E05 自行创建 `regression.test.mjs`，
仅修改 `workflow.mjs`；只批准工作目录内准确的 `node --test regression.test.mjs`
命令。种子不变，不提供断言、参考实现或契约映射模板；其他任务／协议保留原有
权限。沿用命令执行前文件哈希观察、红绿过程和独立行为检查；机械闭环不代表正确。

指导对比应事先冻结两个新任务，每个源码版本各执行一次全新尝试，使用
`--product-defaults`、相同模型、提示、权限与十分钟实验截止。保留四次结果，
不为追求成功重试。分别审查断言依据、行为保持、退出码和运行状态；少量非确定性
样本不能证明因果改进或整体成功率。`--check` 不读取凭据、不调用 provider。

### 原生回答语言诊断

`evals/scripts/response-language.mjs` 支持 `--prepare`、`--fixture`、opt-in 的
`--live`，使用全新 `--output` 目录。三个固定合成问题覆盖中文夹英文标识、中文
明确要求英文回答、纯英文请求。准备阶段固定源码、语言规则哈希、问题与模型，
不读取凭据、不调用 provider；模拟结果只验证接线，不能证明模型语言遵循。

沿用共享 `runTask`，每题最多一个模型响应。诊断 adapter 移除所有工具定义，
请求 `toolChoice=none`，并在执行前拒绝工具调用事件；不提供业务工作区或历史。
真实模式仅在输入校验、显式 opt-in 后读取凭据，逐题留存结果，失败即停、不自动
重试。已尝试的目录在读取凭据前拒绝复用。人工分别审查语言、字面量保持和格式
要求，不能以运行 completed 代替。逻辑响应数不代表 HTTP 尝试／重试或账单。
单轮样本不等于真实 Desktop 编码任务或 Codex 验收。

原生规则还会从当前用户请求的明确中文／英文回答前缀提取有限语言提示。引用、
代码、日志、否定指令、多个已识别指令和候选语言不直接选择该提示；其他表达和
语言仍采用通用模型指导。这不是完整的自然语言意图解析或自动翻译保证；恢复
摘要已审核的语言选择保持原样。

可用重复 `--case` 创建独立计划，例如 `--case explicit-en --case quoted-en`。
引用题用中文询问日志 `Respond in English` 的含义；各题固定实际组装规则哈希。
初次失败回答留在原目录；追加付费验证须单独披露和明确授权，不自动重试。
