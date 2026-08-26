# Forge 中文文档

[English documentation](../README.md) · [简体中文 README](../../README.zh-CN.md)

Forge 文档按“读者想完成什么”组织。第一次接触项目时无需从头读完所有页面，选择最接近当前任务的入口即可。

## 选择你的阅读路径

| 我想要…… | 从这里开始 | 然后阅读 |
| --- | --- | --- |
| 第一次运行 Forge | [快速上手](GETTING_STARTED.md) | [CLI UI](CLI_UI.md) · [认证模型](AUTHENTICATION.md) |
| 配置模型、limits 或 context | [配置参考](CONFIGURATION.md) | [认证模型](AUTHENTICATION.md) · [上下文管理](CONTEXT_MANAGEMENT.md) |
| 理解 Forge 能保护什么、不能保护什么 | [安全模型](SECURITY.md) | [架构](ARCHITECTURE.md) |
| 恢复 conversation 或检查 run | [会话与 trace](SESSIONS.md) | [CLI UI](CLI_UI.md) |
| 添加项目指令或 portable Skill | [项目上下文](PROJECT_CONTEXT.md) | [安全模型](SECURITY.md) |
| 编写 plugin 或学习扩展示例 | [插件开发](PLUGINS.md) | [架构](ARCHITECTURE.md) |
| 复现发布证据 | [评测指南](EVALUATION.md) | [v0.1 合约](V0.1_SPEC.md) |
| 为 Forge 贡献代码或文档 | [贡献指南](../../CONTRIBUTING.zh-CN.md) | [架构](ARCHITECTURE.md) · [路线图](ROADMAP.md) |
| 发布 npm release | [npm 发布指南](RELEASING.md) | [评测指南](EVALUATION.md) · [安全模型](SECURITY.md) |
| 排查错误 | [故障排查](TROUBLESHOOTING.md) | 再阅读对应症状链接的专题页 |

## 使用 Forge

| 指南 | 回答的问题 |
| --- | --- |
| [快速上手](GETTING_STARTED.md) | 如何从源码安装、选择访问方式、验证配置并完成第一次任务？ |
| [CLI UI](CLI_UI.md) | 有哪些斜杠命令和快捷键？审批、文件引用和图片如何工作？ |
| [配置参考](CONFIGURATION.md) | 设置从哪里加载、谁覆盖谁、仓库能控制哪些字段？ |
| [认证模型](AUTHENTICATION.md) | API key、compatible endpoint 与 ChatGPT subscription 有什么区别？ |
| [会话与 trace](SESSIONS.md) | 保存什么、resume 恢复什么、如何检查 run？ |
| [故障排查](TROUBLESHOOTING.md) | 启动、credential、审批、plugin、图片或终端出问题时先检查什么？ |
| [npm 发布指南](RELEASING.md) | 如何构建、验证、发布、更新和回滚单一公共 CLI package？ |

## 理解 Forge

| 指南 | 文档类型 | 内容 |
| --- | --- | --- |
| [架构](ARCHITECTURE.md) | 当前架构概览 | Package 边界、两个 Engine、runtime loop、policy、events 和依赖方向 |
| [安全模型](SECURITY.md) | 已实现安全合约 | Workspace、进程、网络、plugin、credential、session 与委派运行边界 |
| [上下文管理](CONTEXT_MANAGEMENT.md) | 已实现设计记录 | Budget、checkpoint、overflow recovery、不变量和评测 gate |
| [产品定义](PRODUCT.md) | 产品依据 | 目标用户、原则、范围和明确非目标 |

## 扩展 Forge

| 指南 | 内容 |
| --- | --- |
| [项目上下文](PROJECT_CONTEXT.md) | `AGENTS.md`、`.agents/skills`、`.forge/`、`~/.forge/` 和指令优先级 |
| [插件开发](PLUGINS.md) | Manifest v1、activation API、tools、commands、policy restriction、observer 和宿主管理 subagent |
| [示例 plugins](../../examples/plugins/) | Custom tool、stricter policy、web tools、MCP stdio、to-dos 和只读 code-review subagent |

`web_search` 与 `web_fetch` 是可选示例 plugin 工具，不是 Forge 内置默认能力。项目 plugin 是受信任的进程内代码；manifest capability 与逐次工具审批都不是操作系统 sandbox。

## 证据与项目历史

| 文档 | 用途 |
| --- | --- |
| [评测指南](EVALUATION.md) | 运行确定性证据与显式 opt-in live trials |
| [已发布报告](../../evals/reports/README.md) | 经过检查的 release 证据，包括保留的失败 |
| [路线图](ROADMAP.md) | 已完成 milestone 的验收标准与后续方向 |
| [v0.1 验收合约](V0.1_SPEC.md) | 历史首发范围、limits 与 release gates |

Roadmap 与 acceptance 页面会保留历史决策。当前 CLI 行为、配置默认值和 public TypeScript shape 以 checkout 中的源码与测试为准。

## 文档约定

- 除非页面另有说明，命令都从仓库根目录执行。
- `pnpm forge ...` 运行开发 checkout；`forge ...` 使用已安装的 npm package，
  或使用通过 `pnpm link:global` 链接的 checkout。
- 默认 tests 和 deterministic evaluation 不产生付费模型请求；live provider 命令一定标为 opt-in。
- English 页面是规范详细版本；中文页面保持相同命令、配置名、limits 和安全边界，部分历史设计记录会有意压缩。
- 不要把 API key、token、完整本地 trace 或仓库敏感输出粘贴到文档与 issue。

提交文档改动前运行：

```bash
pnpm check:docs
```
