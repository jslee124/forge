# Forge v0.3.3 发布说明

[English](RELEASE_NOTES.md)

发布状态：已发布到 npm 和 GitHub
发布日期：2026-08-30

Forge v0.3.3 是一个以长会话可靠性、忠实恢复、更安全的审批和更清晰的终端反馈为
重点的功能版本。本版本也收紧了公开包所使用的发布验证和文档边界。

## 主要变化

- 增加 context pressure 报告、显式 session compaction 控制、prompt cache 可观测性，
  以及只保存在内存中的 scoped session approval。
- 用 provider-neutral canonical conversation history 替换纯文本 resume 重建。
  已完成的 tool call 与 result 会在 OpenAI、DeepSeek、compatible provider 和
  Codex App Server 投影中保持严格配对。
- 增加 session schema v3、checkpoint v2 验证、保守迁移、有界的
  failed/cancelled outcome，以及跨层 resume contract tests。
- 将 provider protocol SDK 固定为 Forge test matrix 实际验证的版本，避免公开安装
  静默选择未经验证或上游暂时损坏的 patch release。
- 阻止超大 session snapshot 替换先前有效的持久化快照；如果模型收到工具结果前
  运行被取消，恢复上下文仍会保留已经发生过工具副作用的安全提示。
- 加固绝对 executable path 和常见 shell/interpreter wrapper 的进程风险分类。
  destructive 或 broad-effect command 不能获得可复用的 session scope。
- 改进交互审批体验：语义化文件 diff 行、command/network/subagent 预览、可见的编辑
  活动，以及与后端 approval descriptor 一致的不可用选项处理。
- 增加文档 catalog，区分 current product、current development、historical evidence
  与 compatibility redirect。打包文档和内置 Skills 会通过干净安装后的 CLI 验证。
- stable npm 版本路由到 `latest`，prerelease 路由到 `next`；发布前检查 tag、所有
  workspace version、runtime version 与生成 package 的一致性。

## 兼容性与迁移

- 公开 package 仍要求 Node.js 24 或更高版本。
- 现有纯文本 session snapshot 会保守迁移。历史 tool output 永远不能恢复 approval、
  policy、trust、process 或 continuation authority。
- Context compaction 仍为 opt-in；默认模式继续是 `warn`。
- 私有 `@forge/*` 实现包继续保持 private；公开 npm artifact 是
  `@jslee124/forge`。

## 验证边界

确定性 post-fix matrix、依赖审计和干净 package 安装记录在
[修复后发布门禁](POST_FIX_RELEASE_GATES.zh-CN.md)。更早的
[codebase review](CODEBASE_REVIEW.zh-CN.md) 是修复前历史快照。

离线测试不能证明真实 provider 行为。经过脱敏且有界的
[真实 resume smoke](LIVE_PROVIDER_RESUME_SMOKE.zh-CN.md) 已覆盖 native DeepSeek 和
通过 ChatGPT subscription 的 Luna Codex Engine，全程没有调用 OpenAI API。Native
OpenAI API 保持明确未测试；如果 stable release 声明包含 compatible route 的真实
行为，应另外取得授权后运行对应 smoke。

## 明确限制

Forge 仍在积极开发中。不能从确定性 fixture 推断自动语义 compaction 质量、provider
cache hit rate 或真实模型任务质量。Native Anthropic/Gemini protocol、更强的进程
隔离、cloud execution 与跨机器 session synchronization 不属于本版本范围。
