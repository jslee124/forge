# 评测指南

[English](../EVALUATION.md) · [中文目录](README.md)

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
export DEEPSEEK_API_KEY="your-api-key"
FORGE_EVAL_LIVE=1 pnpm eval:live
```

runner 使用 `deepseek-v4-flash`，每次复制 fixture 到新临时目录，使用窄审批通道，只允许 fixture 根目录的 `pnpm test`（超时 60 秒）。不匹配的命令或 workspace 外动作会被拒绝。Live 失败必须保留在报告中，不能为了提高通过率删除或重写。

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

默认 `deepseek-v4-flash` 在 2026-08-19 根据[官方 DeepSeek API 文档](https://api-docs.deepseek.com/api/create-chat-completion)重新校验。当前代码也支持 `deepseek-v4-pro` 和仅 Responses 的实验性 `deepseek-v4-flash-vision-exp`。Thinking 由 Forge 显式选择。Vision transport 和本地图片校验有确定性测试，但 v0.1 报告不声称有付费 live vision 评测。

## v0.1 证据

2026-08-19 的 release evaluation 在 commit `65c0a51` 上使用开启 thinking 的 `deepseek-v4-flash`，记录 9 次试验并通过 7 次：`config-merge` 为 3/3，`retry-cache` 为 2/3，`validation-bug` 为 2/3。失败运行刻意保留；其中命令请求 120000ms，但窄审批只允许 60000ms，Forge 因此拒绝。发布 JSON、Markdown 和 9 个 JSONL trace 已检查 schema、序号、run ID、终止状态及 API key 泄漏。

## Milestone 10 context gate

默认套件在同一份合成长 session transcript 上比较 `off`、`warn` 和 `compact`，不调用 provider。它记录任务成功、估算与 fake provider input、估算误差、本地延迟、压缩次数、保留轮次和 summary 重生成；另有 fixture 覆盖 mandatory overflow、一次性恢复、部分输出不重试、tool-result projection、恶意 history 和 resume 完整性。`warn` 在 paid-provider estimator 和任务质量 gate 发布前保持默认。

Milestone 13 增加了已检入的 [v0.3.2 对比基线](../../evals/reports/v0.3.2/M13_BASELINE.md)、stable prefix/失效 fixture、unavailable 与零值 cache accounting、压力触发压缩、低回收暂停，以及 session/default mode 测试；它们都保持离线。自动压缩可在 TUI 中发现并显式启用，但该基线不会把 extractive oracle 提升为默认行为。

资源评测默认同样确定性、离线运行。脚本化 fixtures 覆盖匹配、不匹配、歧义、显式调用、用户关闭自动调用、冲突、重复加载、超预算、对抗性 Skill、产品问题和未知问题。指标包括选择精确率/召回率、不必要加载、目录与已加载 token、引用准确率、延迟和任务完成率；真实供应商资源试验仍需显式启用。
