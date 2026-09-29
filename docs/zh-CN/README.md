# Forge 中文文档

[English documentation](../README.md) · [简体中文 README](../../README.zh-CN.md)

Forge 文档按“读者想完成什么”组织。第一次接触项目时无需从头读完所有页面，选择最接近当前任务的入口即可。

## 选择你的阅读路径

| 我想要…… | 从这里开始 | 然后阅读 |
| --- | --- | --- |
| 第一次运行 Forge | [快速上手](product/start/GETTING_STARTED.md) | [CLI UI](product/reference/CLI_UI.md) · [认证模型](product/start/AUTHENTICATION.md) |
| 试用桌面预览版 | [桌面预览版](product/operations/DESKTOP.md) | [Windows 安装](../../apps/desktop/INSTALL-WINDOWS.zh-CN.md) · [macOS 安装](../../apps/desktop/INSTALL.zh-CN.md) · [Preview 4 证据](../../evals/reports/desktop-0.3.4-preview.4/README.zh-CN.md) |
| 配置模型、limits 或 context | [配置参考](product/start/CONFIGURATION.md) | [认证模型](product/start/AUTHENTICATION.md) · [上下文管理](product/concepts/CONTEXT_MANAGEMENT.md) |
| 理解 Forge 能保护什么、不能保护什么 | [安全模型](product/concepts/SECURITY_MODEL.md) | [架构](product/concepts/ARCHITECTURE.md) |
| 恢复 conversation 或检查 run | [会话与 trace](product/reference/SESSIONS.md) | [CLI UI](product/reference/CLI_UI.md) |
| 添加项目指令或 portable Skill | [项目上下文](product/reference/PROJECT_CONTEXT.md) | [安全模型](product/concepts/SECURITY_MODEL.md) |
| 从开发 checkout 试用 Telegram | [聊天渠道（实验性）](product/operations/CHAT_CHANNELS.md) | [安全模型](product/concepts/SECURITY_MODEL.md) |
| 编写 plugin 或学习扩展示例 | [插件开发](product/reference/PLUGINS.md) | [架构](product/concepts/ARCHITECTURE.md) |
| 复现发布证据 | [评测指南](development/EVALUATION.md) | [版本报告](../../evals/reports/README.md) |
| 为 Forge 贡献代码或文档 | [贡献指南](../../CONTRIBUTING.zh-CN.md) | [架构](product/concepts/ARCHITECTURE.md) · [路线图](development/ROADMAP.md) |
| 发布 npm release | [npm 发布指南](product/operations/RELEASING.md) | [评测指南](development/EVALUATION.md) · [安全模型](product/concepts/SECURITY_MODEL.md) |
| 查看当前版本 | [最新发布证据](../../evals/reports/README.md#latest) | [已发布报告](../../evals/reports/README.md) · [npm 发布指南](product/operations/RELEASING.md) |
| 查看首个公开版本 | [v0.3.0 发布说明](history/v0.3.0/RELEASE_NOTES.md) | [npm 发布指南](product/operations/RELEASING.md) |
| 排查错误 | [故障排查](product/start/TROUBLESHOOTING.md) | 再阅读对应症状链接的专题页 |

## 使用 Forge

| 指南 | 回答的问题 |
| --- | --- |
| [快速上手](product/start/GETTING_STARTED.md) | 如何从源码安装、选择访问方式、验证配置并完成第一次任务？ |
| [桌面预览版](product/operations/DESKTOP.md) | 当前 macOS 预览版支持什么，哪些环节尚未验证？ |
| [CLI UI](product/reference/CLI_UI.md) | 有哪些斜杠命令和快捷键？审批、文件引用和图片如何工作？ |
| [配置参考](product/start/CONFIGURATION.md) | 设置从哪里加载、谁覆盖谁、仓库能控制哪些字段？ |
| [认证模型](product/start/AUTHENTICATION.md) | API key、compatible endpoint 与 ChatGPT subscription 有什么区别？ |
| [会话与 trace](product/reference/SESSIONS.md) | 保存什么、resume 恢复什么、如何检查 run？ |
| [故障排查](product/start/TROUBLESHOOTING.md) | 启动、credential、审批、plugin、图片或终端出问题时先检查什么？ |
| [npm 发布指南](product/operations/RELEASING.md) | 如何构建、验证、发布、更新和回滚单一公共 CLI package？ |

## 理解 Forge

| 指南 | 文档类型 | 内容 |
| --- | --- | --- |
| [架构](product/concepts/ARCHITECTURE.md) | 当前架构概览 | Package 边界、两个 Engine、runtime loop、policy、events 和依赖方向 |
| [安全模型](product/concepts/SECURITY_MODEL.md) | 已实现安全合约 | Workspace、进程、网络、plugin、credential、session 与委派运行边界 |
| [上下文管理](product/concepts/CONTEXT_MANAGEMENT.md) | 已实现设计记录 | Budget、checkpoint、overflow recovery、不变量和评测 gate |
| [产品定义](product/concepts/PRODUCT.md) | 产品依据 | 目标用户、原则、范围和明确非目标 |

## 决策记录

已接受的[决策记录](../decisions/)解释系统为什么是现在这个形态。它们只追加：决策变更时
新写一条取代旧记录，而不是修改原文。记录只提供英文版，不打包为产品帮助。

| 记录 | 决策 |
| --- | --- |
| [ADR-0001](../decisions/0001-gateway-single-owner-workspace.md) | 聊天网关只服务一个 owner 和一个 workspace（英文） |

## 扩展 Forge

| 指南 | 内容 |
| --- | --- |
| [项目上下文](product/reference/PROJECT_CONTEXT.md) | `AGENTS.md`、`.agents/skills`、`.forge/`、`~/.forge/` 和指令优先级 |
| [插件开发](product/reference/PLUGINS.md) | Manifest v1、activation API、tools、commands、policy restriction、observer 和宿主管理 subagent |
| [示例 plugins](../../examples/plugins/) | Custom tool、stricter policy、web tools、MCP stdio、to-dos 和只读 code-review subagent |

`web_search` 与 `web_fetch` 是可选示例 plugin 工具，不是 Forge 内置默认能力。项目 plugin 是受信任的进程内代码；manifest capability 与逐次工具审批都不是操作系统 sandbox。

## 当前开发

计划与任务清单描述开发合同，不代表功能已实现；完成状态以源码、测试和实际验收记录为准。

| 文档 | 用途 |
| --- | --- |
| [评测指南](development/EVALUATION.md) | 运行确定性证据与显式 opt-in live trials |
| [路线图](development/ROADMAP.md) | 当前开发、已完成 milestone 摘要与后续方向 |
| [聊天渠道 Intent](development/CHAT_CHANNELS_INTENT.md) | 拟定 0.4.0 目标、范围与产品决策 |
| [聊天渠道 Spec](development/CHAT_CHANNELS_SPEC.md) | 拟定 Telegram 网关契约、安全、恢复与验收 |

## 历史与发布证据

| 文档 | 用途 |
| --- | --- |
| [已发布报告](../../evals/reports/README.md) | 经过检查的 release 证据，包括保留的失败 |
| [v0.4.0 发布验证](../../evals/reports/v0.4.0/RELEASE_VERIFICATION.md) | 当前稳定版范围、证据与剩余限制（仅英文） |
| [v0.3.4 发布说明](../../evals/reports/v0.3.4/RELEASE_NOTES.zh-CN.md) | v0.3.4 用户可见变更、迁移与验证边界 |
| [v0.3.4 详细实现方案](history/v0.3.4/IMPLEMENTATION_PLAN.md) | 统一文件编辑、CLI 拆分、可逆 context 控制与 terminal lifecycle 修复的已完成开发合同 |
| [v0.3.0 发布说明](history/v0.3.0/RELEASE_NOTES.md) | 首个公共 npm 分发、显式更新和发布边界 |
| [结构化 Session History 实现方案](history/v0.3.3/STRUCTURED_SESSION_HISTORY.md) | 历史 Milestone 14 设计记录；当前行为仍以源码、测试、Sessions 与 Architecture 为准 |
| [v0.3.3 详细实现记录](history/v0.3.3/LONG_SESSION_IMPLEMENTATION.md) | Milestone 13.0-13.5 的历史设计、架构、测试与离线 gate；不是发布声明 |
| [v0.1 验收合约](history/v0.1/ACCEPTANCE.md) | 历史首发范围、limits 与 release gates |
| [Milestone 0–15 验收记录](history/v0.3.4/MILESTONES.md) | 截至 v0.3.4 的历史目标、验收条目与验证边界 |
| [桌面实施合同](history/desktop-0.3.4-preview.2/DESKTOP_APP_PLAN.md) | 历史桌面范围与 coding agent 交接依据 |
| [桌面 D01—D13 清单](history/desktop-0.3.4-preview.2/DESKTOP_APP_TASKS.md) | 历史任务完成与验收记录 |
| [桌面 D01 基线](history/desktop-0.3.4-preview.2/DESKTOP_BASELINE.md) | 历史工具链与架构快照 |

## 目录结构

| 目录 | 角色 | 含义 |
| --- | --- | --- |
| `product/start/` | current-product | 安装、配置、认证与故障排查 |
| `product/reference/` | current-product | 命令、manifest、指令优先级与持久化契约 |
| `product/concepts/` | current-product | 为什么这么设计、边界在哪里 |
| `product/operations/` | current-product | 发布、分发与运行形态 |
| `development/` | current-development | 路线图、评测与尚未成为已发布行为的提案 |
| `decisions/` | decision | 只追加的、难以逆转的设计决策记录 |
| `history/` | historical | 版本化设计与验收快照；仅在需要时查阅 |
| `zh-CN/` | 镜像 | 与上述结构完全对应的中文版本 |

`product/` 与 `development/` 各自带有 `AGENTS.md`，声明该目录专属规则。中文镜像重复
相同子路径，因此 `product/start/GETTING_STARTED.md` 与
`zh-CN/product/start/GETTING_STARTED.md` 成对。

当前使用指南位于 `docs/`，中文镜像位于 `docs/zh-CN/`。已完成的版本计划与验收记录归档到各语言的 `history/<version>/`；桌面预览版实施记录使用 `history/desktop-<version>/`。发布证据与代码审查快照位于 `evals/reports/<version>/`。

[文档 catalog](../catalog.json) 管理角色与 product-help 打包范围。只打包当前产品指南；开发计划、历史记录和决策记录不进入产品帮助。当前行为以源码、测试和当前产品指南为准。`pnpm check:docs` 还会校验每个页面都能从入口文档到达，以及 `evals/reports/` 下每个报告目录都在 `evals/reports/README.md` 中登记。

## 文档约定

- 除非页面另有说明，命令都从仓库根目录执行。
- `pnpm forge ...` 运行开发 checkout；`forge ...` 使用已安装的 npm package，
  或使用通过 `pnpm link:global` 链接的 checkout。
- 默认 tests 和 deterministic evaluation 不产生付费模型请求；live provider 命令一定标为 opt-in。
- English 页面是规范详细版本；中文页面保持相同命令、配置名、limits 和安全边界，部分历史设计记录会有意压缩。
- 不要把 API key、token、完整本地 trace 或仓库敏感输出粘贴到文档与 issue。
- 版本计划完成后，中英文一起归档到 `history/<version>/`，添加历史角色说明，保留当时的设计正文。
- 当设计决策难以逆转时，新增 `decisions/<NNNN>-<slug>.md`，包含 Context、Decision、Alternatives、Consequences 四节；在 `## Status` 标题下与 catalog 中同时声明状态，之后只通过取代记录来改变状态。
- 每个页面都必须能从某个文档入口沿链接到达。`README.md`、`AGENTS.md`、`SKILL.md` 与 skill reference 文件本身即入口；其他文件需要在索引页中被引用。
- 产品页打包时相对链接会被改写成纯文本，因此需要在打包后的产品帮助里保持可点击的链接使用绝对地址 `https://github.com/jslee124/forge/blob/<branch>/...`。这类链接不受 `pnpm check:docs` 校验，目标移动时需要手工更新。
- 被已发布 release notes 或已打包产品帮助以上述绝对地址引用的文件是**钉住的**。`pnpm check:docs` 会解析仓库内以及 `.github/releases` 里每个 `blob/<branch>/<path>` URL：分支引用按工作区校验，tag/commit 引用按对应的 git 对象校验，目标被移动或删除就会让构建失败。正确做法是恢复路径、留跳转页或改正链接，而不是移动文件。
- `docs/` 之外的 Markdown 由所属组件目录负责：`apps/` 下每个文件都必须登记在该目录的 `AGENTS.md` 或 `README.md` 索引里。
- 新增、移动或删除文档时，同步更新 catalog、双语导航和所有仓库内链接；不为已无引用的旧路径保留空跳转页。

提交文档改动前运行：

```bash
pnpm check:docs
```
