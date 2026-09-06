# 路线图

[English](../ROADMAP.md) · [中文目录](README.md)

## 当前 milestone

**作为 v0.3.4 release 目标的 Milestone 15 已完成。** 它统一模型侧文件编辑、拆分 interactive CLI、让 context mode 可逆，并修复 terminal listener lifecycle。自动 compact 始终是用户显式 opt-in。详见 [v0.3.4 详细实现方案](history/v0.3.4/IMPLEMENTATION_PLAN.md)。

## 工作规则

- 完成一个 milestone 后再扩展下一个。
- 每个 milestone 都必须产生可运行行为。
- 是否完成由验收标准决定，而不是写了多少文件。
- 默认测试套件不依赖付费模型调用。
- 只有 milestone 需要时才新增 workspace package。
- 实现证明计划错误时更新本文。
- 以[历史 v0.1 验收与评测](history/v0.1/ACCEPTANCE.md)作为 v0.1 release contract。

## 当前开发

- [桌面端设计与实施合同](DESKTOP_APP_PLAN.md)：当前桌面端开发范围与架构约束。
- [桌面端开发任务清单](DESKTOP_APP_TASKS.md)：依赖顺序、交付物和验收标准。
- 计划文档不代表功能已经实现；任务状态以源码、测试和清单中的实际记录为准。

## 已完成里程碑

| 阶段 | 范围 |
| --- | --- |
| 0–7 | 工程基础、模型对话、工具与 agent loop、TUI、策略、持久化与首发评测 |
| 8–12 | 插件、认证、上下文预算、compatible provider、Skills 与产品帮助 |
| 13–14 | 长会话、审批体验、结构化历史与恢复 |
| 15 | v0.3.4 文件编辑、CLI 拆分、context 控制与生命周期修复 |

详细条目保存在 [Milestone 0–15 历史验收记录](history/v0.3.4/MILESTONES.md)。
版本验证证据见 [release reports](../../evals/reports/README.md)。

## 后续扩展

后续方向包括更多评测和 grader、Anthropic Messages/Gemini 等 native protocol、窄的 workspace 外审批、明确警告的 `full-access`、可选 shell language、LangChain/LangGraph 对比、HTTP/SSE、SQLite session/run index、session branch/跨机同步、经 context evaluation 证明有价值的 semantic retrieval、MCP 和更强的进程隔离。它们是探索方向，不是交付承诺或已实现能力清单。
