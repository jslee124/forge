<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="docs/assets/forge-logo-dark.svg">
    <source media="(prefers-color-scheme: light)" srcset="docs/assets/forge-logo-light.svg">
    <img src="docs/assets/forge-logo-light.svg" alt="Forge" width="760">
  </picture>
</p>

<p align="center">
  <strong>一个可检查、可约束、可评估的编码 Agent。</strong><br>
  <sub>Forge 自己控制 Agent 循环，把工具调用放在明确的策略之后，并为每次运行记录证据。</sub>
</p>

<p align="center">
  <a href="https://github.com/jslee124/forge/actions/workflows/ci.yml"><img src="https://img.shields.io/github/actions/workflow/status/jslee124/forge/ci.yml?branch=main&amp;style=flat-square&amp;label=CI" alt="CI 状态"></a>
  <img src="https://img.shields.io/badge/source-v0.3.0-0e7490?style=flat-square" alt="源码版本 0.3.0">
  <img src="https://img.shields.io/badge/Node.js-%3E%3D24-3c873a?style=flat-square&amp;logo=nodedotjs&amp;logoColor=white" alt="Node.js 24 或更高版本">
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-7c3aed?style=flat-square" alt="MIT 许可证"></a>
</p>

<p align="center">
  <a href="docs/zh-CN/GETTING_STARTED.md">快速上手</a> ·
  <a href="#为什么是-forge">为什么是 Forge？</a> ·
  <a href="#安全模型">安全</a> ·
  <a href="#评测">评测</a> ·
  <a href="docs/zh-CN/README.md">文档</a> ·
  <a href="CONTRIBUTING.zh-CN.md">贡献</a>
</p>

<p align="center">
  <a href="README.md">English</a> ·
  <a href="README.zh-CN.md">简体中文</a>
</p>

Forge 是一个开源 TypeScript 项目，用于学习和展示编码 Agent 背后的工程：模型交互、工具执行、审批边界、上下文管理、持久化、插件，以及可复现评测。

它最适合希望从头读懂一个小型 runtime、亲自实验并测量结果的开发者。Forge 现在具备单 package 的 npm 发布路径，同时保留面向贡献者的源码 checkout；它仍不是 hardened coding environment 的开箱即用替代品。

## 为什么是 Forge？

许多 coding-agent 演示在模型发出工具调用时就结束了。Forge 关注的是工具调用周围必须存在的完整流程，让系统能够被理解、测试和复盘。

| 能力 | Forge 证明了什么 |
| --- | --- |
| **Forge 自有循环** | 运行时控制模型步骤、工具执行、继续运行、恢复、取消和停止限制。 |
| **明确策略** | 每个工具提议在执行前都会得到 `allow`、`confirm` 或 `deny` 决策。 |
| **可观察运行** | 结构化终端事件和版本化 JSONL trace 展示模型提出了什么以及实际发生了什么。 |
| **持久化会话** | 已完成的对话可以跨进程恢复，但不会恢复旧审批或待执行工具调用。 |
| **有预算的上下文** | `/context` 展示当前预算；可选 checkpoint 压缩已完成历史，但不删除规范 transcript。 |
| **可复现评测** | 确定性测试验证运行时行为，真实模型试验同时保留成功和失败。 |
| **受控扩展** | 受信任插件和可移植项目 Skills 可以扩展 Forge，但不能绕过核心策略流水线。 |

## 快速开始

已发布版本可以作为全局 CLI 安装：

```bash
npm install --global @jslee124/forge
forge config validate
```

贡献者可以使用下面的源码 checkout。源码开发需要 Node.js 24 或更高版本、pnpm 11.18.0、Git，以及一种受支持的模型访问方式：

```bash
git clone https://github.com/jslee124/forge.git
cd forge
pnpm install --frozen-lockfile
pnpm build
pnpm forge config validate
```

选择模型访问方式：

| 访问方式 | Engine | 设置入口 |
| --- | --- | --- |
| DeepSeek API | Native Forge Engine | 启动 `pnpm forge`，再使用 `/login` |
| OpenAI API | Native Forge Engine | 启动 `pnpm forge`，再使用 `/login` |
| OpenAI-compatible endpoint | Native Forge Engine | 通过 `/login` 或用户配置添加 route |
| ChatGPT 订阅 | 独立 Codex Engine | 安装 Codex CLI，再运行 `pnpm forge auth login openai` |

OpenAI API 按用量计费，与 ChatGPT subscription 分开。API key 可以通过带掩码的 `/login` 输入，也可以通过环境变量提供；环境 credential 优先。

启动交互终端，先做只读检查：

```bash
pnpm forge
```

```text
检查这个仓库，总结 package 结构和验证命令。不要修改文件。
```

然后尝试一个有边界的 coding task：

```text
修复失败的测试。先检查相关文件，然后验证结果。
```

默认 `safe` profile 会在一次 run 的首次 workspace 写入和每一条进程命令前询问。批准前请检查完整 diff、command、working directory 与 timeout。

常用交互命令：

```text
/login      配置或管理 provider
/model      选择当前模型
/effort     选择支持的推理强度
/context    查看当前上下文预算
/plugins    查看项目插件信任状态
/resume     继续已持久化的会话
/help       显示完整命令列表
```

要把开发 checkout 全局使用：

```bash
pnpm link:global
forge
```

该链接指向当前 checkout。修改源码后运行 `pnpm build`，不再需要时运行 `pnpm unlink:global`。

[完整快速上手指南](docs/zh-CN/GETTING_STARTED.md)进一步解释每种认证方式、本地验证、首次审批、session 与 run inspection。

## Forge 能做什么

- 使用有边界的文件列表、读取和搜索工具检查 workspace。
- 在展示精确 diff 后创建文件并应用定向补丁。
- 使用明确的参数、超时、输出限制和审批执行结构化进程命令。
- 对失败的验证作出反应，继续修复结果。
- 将模型文本和 provider 提供的 reasoning 作为独立事件流式输出。
- 持久化会话，并按 ID 或最近使用顺序恢复已完成的对话轮次。
- 检查上下文用量，并创建明确、可展示的对话 checkpoint。
- 加载分层的 `AGENTS.md` 指令和可移植项目 Skills。
- 加载能够贡献工具、命令、observer、prompt、更严格策略 hook 或有界宿主管理 subagent 角色的受信任插件。
- 为支持的 vision 模型附加 JPEG、PNG、GIF 或 WebP 输入。
- 将 native-engine 运行记录为可检查的版本化 JSONL trace。

运行一次性 native-engine 任务：

```bash
pnpm forge run "检查仓库并总结其架构"
```

使用 ChatGPT 订阅访问时，通过独立的 Codex Engine 运行：

```bash
pnpm forge auth login openai
pnpm forge codex "检查这个仓库并总结它"
```

键盘快捷键、图片粘贴与拖放、斜杠命令、文件引用、diff 审查和交互式 provider 管理，请看 [CLI UI 指南](docs/zh-CN/CLI_UI.md)。

## 安全模型

Forge 的“默认安全”是具体且可检查的：

| 操作 | 默认 `safe` 决策 |
| --- | --- |
| 在 workspace 内读取、列出或搜索 | Allow（允许） |
| 一次运行中的首次 workspace 写入 | Confirm（确认） |
| 被该次运行审批覆盖的后续写入 | Allow（允许） |
| 任意进程命令 | Confirm（确认） |
| 任意已注册网络工具 | Confirm（确认） |
| 任意委派 subagent 模型运行 | Confirm（确认） |
| 内置文件工具访问 workspace 外部 | Deny（拒绝） |
| 需要审批但没有审批通道的操作 | Deny（拒绝） |

内置文件工具会在执行 workspace 边界检查前解析规范路径和符号链接。进程命令使用结构化的 `program + args[]` 输入，`shell: false`，默认超时 60 秒，并限制输出。

> **安全边界：** 审批不是隔离。Forge **不是操作系统 sandbox**。获批的子进程拥有启动 Forge 的用户权限，受信任插件则是进程内代码。在不受信任的仓库上使用 Forge 前，请阅读[安全模型](docs/zh-CN/SECURITY.md)。

## Provider 与 Engine

Forge 将认证方式、provider 协议和运行时所有权分开处理。

| 访问方式 | Runtime | 说明 |
| --- | --- | --- |
| DeepSeek API key | Native Forge Engine | 对话、工具调用和支持的实验性 vision 输入 |
| OpenAI API key | Native Forge Engine | API 用量与 ChatGPT 订阅分开计费 |
| OpenAI-compatible 路由 | Native Forge Engine | 用户配置的 HTTPS endpoint 或无认证 loopback server |
| ChatGPT 订阅 | Codex Engine | 使用官方 Codex App Server 及其账号边界 |

API key 可以通过带掩码的 `/login` 输入，也可以通过环境变量提供。环境凭据优先。Forge 将保存的 API key 存在本地仅 owner 可读的文件中；Codex 继续负责 ChatGPT 凭据和刷新。完整边界及第三方路由配置见[认证模型](docs/zh-CN/AUTHENTICATION.md)。

## 架构

```text
Interactive CLI
 |
 |-- Forge Engine
 |   `-- Native runtime
 |       |-- Models: DeepSeek / OpenAI / compatible APIs
 |       |-- Context: ~/.forge / AGENTS.md / .agents
 |       |-- Extensions: plugins / Skills
 |       |-- Policy: allow / confirm / deny
 |       |-- Tools: files / search / patch / process
 |       `-- Output: terminal events / JSONL traces
 |
 `-- Codex Engine
     `-- Official Codex App Server
```

Native runtime 与 provider 无关。适配器转换 provider 请求和 continuation metadata；核心负责生命周期状态、策略、限制、工具和 trace 事件。Codex Engine 刻意独立，使用 Codex 自己的 conversation、sandbox、审批和认证行为。包边界及完整调用路径请看[架构指南](docs/zh-CN/ARCHITECTURE.md)。

## 评测

Forge 将确定性的运行时正确性与非确定性的模型质量分开。默认测试使用脚本化模型和 mock transport，不会产生付费模型调用。

运行确定性恢复与 grader 套件：

```bash
pnpm eval:deterministic
```

已发布的 v0.1 DeepSeek 评测对 3 个小型 TypeScript 修复任务各运行 3 次，9 次中端到端通过 7 次：

| 任务 | 通过 | 通过率 |
| --- | ---: | ---: |
| `config-merge` | 3/3 | 100.0% |
| `retry-cache` | 2/3 | 66.7% |
| `validation-bug` | 2/3 | 66.7% |

两次失败仍保留在仓库中。只有 Forge 成功完成，且 fixture 自有测试和外部 grader 都通过时，运行才计为通过。请阅读[评测指南](docs/zh-CN/EVALUATION.md)、[已发布报告](evals/reports/v0.1/report.md)、[v0.2.0 发布说明](evals/reports/v0.2/RELEASE_NOTES.md)以及 [v0.2 上下文 gate](evals/reports/v0.2/CONTEXT_MANAGEMENT.md)。

真实试验是显式 opt-in，因为会产生付费 provider 请求：

```bash
export DEEPSEEK_API_KEY="your-api-key"
FORGE_EVAL_LIVE=1 pnpm eval:live
```

## 开发

```bash
pnpm build               # 编译 TypeScript project references
pnpm check               # 运行 Biome 和严格 TypeScript 检查
pnpm test                # 构建并运行完整 Vitest 套件
pnpm eval:deterministic  # 运行不产生付费调用的 release 证据
pnpm forge --help        # 构建并查看 CLI 帮助
```

根目录继续作为私有 pnpm workspace。release 自动化会把私有 `@forge/*` 实现 bundle 到唯一的公共 `@jslee124/forge` CLI；插件 SDK 暂不独立发布。开发 workspace 中的主要 package 仍分别负责 CLI、runtime、工具、配置、持久化、认证、插件 API 和 provider adapter。

## 文档

请从按读者任务组织的[中文文档目录](docs/zh-CN/README.md)开始。English 页面是规范详细版本；中文页面保持相同命令、配置名、limits 与安全边界，部分历史设计记录会有意压缩。

| 主题 | 指南 |
| --- | --- |
| 安装与第一次任务 | [快速上手](docs/zh-CN/GETTING_STARTED.md) · [故障排查](docs/zh-CN/TROUBLESHOOTING.md) |
| 日常使用 | [CLI UI](docs/zh-CN/CLI_UI.md) · [配置](docs/zh-CN/CONFIGURATION.md) · [认证](docs/zh-CN/AUTHENTICATION.md) · [会话](docs/zh-CN/SESSIONS.md) |
| 边界与内部原理 | [架构](docs/zh-CN/ARCHITECTURE.md) · [安全](docs/zh-CN/SECURITY.md) · [上下文管理](docs/zh-CN/CONTEXT_MANAGEMENT.md) |
| 定制与扩展 | [项目上下文](docs/zh-CN/PROJECT_CONTEXT.md) · [插件](docs/zh-CN/PLUGINS.md) · [示例](examples/plugins/) |
| 证据与方向 | [评测](docs/zh-CN/EVALUATION.md) · [已发布报告](evals/reports/README.md) · [路线图](docs/zh-CN/ROADMAP.md) |
| 贡献 | [贡献指南](CONTRIBUTING.zh-CN.md) |

## 当前状态与限制

Forge 仍在积极开发中。当前稳定源码与 npm release 是 `0.3.0`，详见 [v0.3.0 发布说明](docs/zh-CN/releases/v0.3.0.md)。自动上下文 checkpoint 仍默认 opt-in，同时还在收集 provider 质量证据。

- Native runtime 支持 DeepSeek、OpenAI API 和已配置的 OpenAI-compatible 路由；原生 Anthropic 与 Gemini 协议尚未实现。
- 模型行为具有非确定性；运行时正确不保证真实任务成功。
- Resume 恢复已完成的对话文本，不恢复待执行工具调用或旧审批。
- 插件是受信任的本地代码，不是隔离扩展。
- 除了有界的 plugin-declared subagent 之外，更通用的多 Agent 编排、RAG、IDE 集成、云端执行、自治 Git push 和跨机器会话同步不在范围内。

已完成的验收标准和后续工作见[路线图](docs/zh-CN/ROADMAP.md)。

## 许可证

Forge 使用 [MIT License](LICENSE)。
