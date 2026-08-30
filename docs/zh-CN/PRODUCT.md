# 产品定义

[English](../PRODUCT.md) · [中文目录](README.md) · [根 README](../../README.zh-CN.md)

## 摘要

Forge 是一个面向学习和作品集展示的 TypeScript coding agent。它不是一个“只要能调用工具就算完成”的 demo，而是一个可以检查、约束、测量和复盘的最小运行时。

Forge 负责模型循环、工具执行、审批策略、上下文、会话和 trace；provider adapter 负责协议转换；CLI 负责交互和展示。这样既能使用成熟 SDK，又能保留 agent 的关键工程边界。

## 目标用户

### 主要用户

- 正在学习 agent runtime、tool calling、安全边界和评测的开发者。
- 希望从小型、可运行系统理解 coding-agent 工程的面试官或导师。
- 需要在本地仓库中使用可检查、可审批工作流的个人开发者。

### 次要用户

- 想比较 provider、模型和 agent-loop 行为的实验者。
- 希望通过插件扩展工具但不绕过核心策略的项目作者。

## 核心用例

给 Forge 一个小型仓库任务，例如“修复失败测试并验证结果”。Forge 应当：

1. 读取当前配置和适用的项目指令。
2. 让模型选择下一步，并通过工具检查相关代码。
3. 在每个工具调用前执行 `allow`、`confirm` 或 `deny` 策略。
4. 在获批后修改代码并运行受限的验证命令。
5. 根据真实的命令结果继续修复，而不是相信模型的乐观总结。
6. 以真实状态、diff 和 trace 结束，或说明为什么无法完成。

## 产品原则

### 透明

终端应展示有意义的模型和工具活动。只有 provider 实际返回的 reasoning 才能展示或持久化；如果 provider 没有返回，Forge 不会伪造或暗示自己看到了隐藏思维过程。结构化 trace 保留可观察的执行轨迹。

### 默认安全

文件工具默认限制在选定 workspace 内，命令和执行时间有边界，高风险操作需要审批。非交互模式没有匹配的预先审批时必须拒绝需要审批的操作。

### 可验证

合理的最终文字不是完成证明。任务可以由测试、类型检查、lint 或其他确定性检查验证时，Forge 应执行检查并报告真实结果。

### 理解框架，但不被框架拥有

Forge 可以使用成熟库消除偶然复杂度，但核心运行时概念必须保持可见、可独立测试。

### 扩展不能削弱保护

插件可以添加工具、命令、prompt 贡献和受控生命周期 hook，但不能把核心 `deny` 变为 `allow`，绕过审批或替换策略内核。进程内插件仍是本地代码，需要明确的信任决定。

### 先小后广

一个狭窄但可靠的工作流，比许多未完成的功能更有价值。

## 初始功能

- TypeScript CLI 和多行交互式终端。
- 斜杠命令发现、workspace 文件引用和可读的 diff 审查。
- 以 `DEEPSEEK_API_KEY` 认证的 DeepSeek provider。
- 通过 Vercel AI SDK 和 `@ai-sdk/deepseek` 流式输出。
- 有明确停止条件的多步骤 agent 循环。
- `~/.forge/config.json` 用户级配置和分层 `AGENTS.md` 指令。
- `forge config show` 可检查配置来源。
- 列出、读取、搜索、补丁和运行命令工具。
- workspace 路径校验、命令超时和取消。
- 敏感操作审批、provider reasoning 展示、结构化事件和 JSONL trace。
- 可在重启后恢复的本地会话。
- runtime/tool 自动化测试、规范 fixture、确定性恢复场景和可复现发布评测。

## v0.1 成功标准

详细 gate 见[历史 v0.1 验收与评测](history/v0.1/ACCEPTANCE.md)。一次完整仓库任务至少要：读取多个相关文件、进行定向修改、运行自动验证、证明失败恢复、在成功或限制后停止、拒绝 workspace 外文件操作、生成与真实行为一致的 trace 和总结。

## v0.1 不在范围内

多 Agent 协作、图形或 IDE 界面、远程执行、持久语义记忆、RAG、MCP server 发现、第三方插件安装、自动 commit/push/PR，以及生产级 OS sandbox 都不属于 v0.1。

## 后续作品集方向

Native runtime 稳定后，可考虑更大的评测套件、OpenAI API key、在适当公开集成支持下的 ChatGPT 登录、LangChain/LangGraph adapter、带 SSE 和人工审批的 HTTP API，以及 SQLite 索引和会话分支。这些是后续扩展，不是开始实现的前置条件。
