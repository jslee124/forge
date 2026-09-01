# 快速上手

[English](../GETTING_STARTED.md) · [中文文档目录](README.md)

这篇指南会带你从全新 checkout 走到一次可验证的 Forge 会话。在真正提交 prompt 之前，所有检查都只在本地执行，不会产生付费模型请求。

## 你将完成什么

1. 安装并构建开发 checkout。
2. 选择一种模型访问方式。
3. 在不调用 provider 的前提下验证有效配置。
4. 先执行只读任务，再执行带明确审批的 coding task。
5. 找到保存的 session 和 run trace。

## 前置条件

- Node.js 24 或更高版本
- pnpm 11.18.0，版本由根目录 `packageManager` 固定
- Git
- 以下任意一种模型访问方式：DeepSeek API key、OpenAI API key、已配置的 OpenAI-compatible endpoint，或通过 Codex CLI 使用 ChatGPT 账号

Forge 的开发 workspace 继续保持 private。release 自动化会生成唯一的公共 CLI package `@jslee124/forge`，内部 packages 和插件 SDK 仍保持私有。普通用户应安装已发布的 CLI；参与 Forge 开发时再从源码运行或全局链接当前 checkout。

安装当前稳定版本：

```bash
npm install --global @jslee124/forge
forge --version
```

## 1. 安装 checkout

```bash
git clone https://github.com/jslee124/forge.git
cd forge
pnpm install --frozen-lockfile
pnpm build
pnpm forge --version
```

最后一条命令会构建 workspace；当前源码 release 应输出 `0.3.4`。它不会联系模型 provider。

开发期间可以一直使用 `pnpm forge`。如果希望直接输入 `forge`：

```bash
pnpm link:global
forge --version
```

该链接指向构建后的 CLI，因此 TypeScript 源码变动后要再次运行 `pnpm build`。不再需要时执行 `pnpm unlink:global`。

## 2. 选择访问方式

Forge 有两个执行 Engine。认证方式和 runtime 所有权不同，不要把它们混为一谈。

| 访问方式 | Engine | Credential 所有者 | 从哪里开始 |
| --- | --- | --- | --- |
| DeepSeek API | Forge Engine | Forge 保存的 key 或 `DEEPSEEK_API_KEY` | `pnpm forge` 后输入 `/login` |
| OpenAI API | Forge Engine | Forge 保存的 key 或 `OPENAI_API_KEY` | `pnpm forge` 后输入 `/login` |
| OpenAI-compatible endpoint | Forge Engine | 配置的环境变量或 Forge 保存的 route key | 通过 `/login` 或用户配置添加 route |
| ChatGPT 订阅 | Codex Engine | Codex App Server | `pnpm forge auth login openai` |

OpenAI API 按用量计费，ChatGPT subscription 是另一条访问路径。ChatGPT 订阅不会提供 `OPENAI_API_KEY`，API key 也不会自动变成 Codex 订阅会话。

### 方案 A：交互式保存 API key

```bash
pnpm forge
```

输入 `/login`，选择 DeepSeek、OpenAI API 或已经配置的 route，再把 key 粘贴到带掩码的输入框。Forge 会把它保存到 `$FORGE_HOME/auth.json`，默认是 `~/.forge/auth.json`，并使用仅 owner 可读的文件权限。环境变量优先于保存的 key。

使用 `/model` 选择 engine、provider 和 model；使用 `/effort` 或 Shift+Tab 独立选择该模型公开支持的 reasoning level。

### 方案 B：环境变量

环境变量适合自动化或临时 shell：

```bash
export DEEPSEEK_API_KEY="your-api-key"
# 或
export OPENAI_API_KEY="your-api-key"
```

不要把 key 写入 `.forge/config.json`、prompt、提交到 Git 的 shell 文件、issue 或 trace 示例。用户和项目配置 schema 都不接受 secret 字段。

### 方案 C：通过 Codex 使用 ChatGPT 订阅

先安装 Codex CLI，再让官方 App Server 负责 browser 或 device-code 登录：

```bash
pnpm forge auth login openai
pnpm forge auth status openai
pnpm forge models list --provider openai
```

无头环境使用：

```bash
pnpm forge auth login openai --method device-code
```

Codex Engine 自己拥有 agent runtime、sandbox、tools、审批和 conversation state。Native Forge plugin 与 JSONL run trace 不会包裹这条路径。完整边界见[认证模型](AUTHENTICATION.md)。

## 3. 在本地验证配置

以下命令只解析和合并配置，不发起模型请求：

```bash
pnpm forge config validate
pnpm forge config show
pnpm forge plugins list
```

`config show` 会展示每个有效值及其来源。全新配置默认使用 `safe` permission profile、12 个 model steps、40 个 tool calls、60 秒 command timeout、开启 trace，并使用 `manual` context mode。

如果结果与预期不同，先阅读[配置参考](CONFIGURATION.md)。特别注意：项目 `.forge/config.json` 只能收紧 limits 和 context，不能选择模型、启用 plugin 或扩大权限。

## 4. 完成第一次任务

### 先从只读任务开始

在一个你熟悉的小仓库里启动：

```bash
pnpm forge
```

先问一个边界明确的问题：

```text
检查这个仓库，总结 package 结构，并告诉我修改后应该运行哪些验证命令。不要修改文件。
```

默认 `safe` profile 会自动允许 workspace 内的 list、read 和 search。Native Forge Engine 会分别流式展示模型回答与 provider 实际暴露的 reasoning，并记录结构化事件。

### 再尝试 coding task

```text
修复一个失败测试。先展示 proposed diff，再运行最小且相关的验证命令，最后报告真实结果。
```

在 `safe` 下，每次 run 的首次 workspace 写入和每一条进程命令都要确认。批准前应检查完整 diff、程序与参数、工作目录和 timeout。审批不是隔离：获批程序会以当前用户权限运行。

拒绝操作时，Forge 会记录 denial，不会自动放宽策略，也不会把没有输入解释成同意。

### One-shot 命令

不进入交互 UI，直接使用 native Forge Engine：

```bash
pnpm forge run "检查仓库并总结其架构"
```

使用独立 Codex Engine：

```bash
pnpm forge codex "检查仓库并总结其架构"
# 等价的 engine 选择：
pnpm forge run --engine codex "检查仓库"
```

在 TTY 中，one-shot native run 可以展示审批问题；如果 stdin/stderr 被重定向，就没有审批通道，所有仍需确认的操作都会 fail closed。

## 5. 继续会话与检查证据

交互 UI 中常用：

```text
/context    展示当前 context budget 与 checkpoint 状态
/compact    显式创建 conversation checkpoint
/resume     选择当前 workspace 的已保存 session
/help       展示全部交互命令
```

Shell 中可用：

```bash
pnpm forge resume --last
pnpm forge inspect <run-id>
```

Session 保存规范 conversation context；run 是一次带独立 ID 和 JSONL event trace 的有界 agent-loop 执行。交互式 Resume 会重放可用的历史模型与工具事件，但不会重新激活旧审批、待执行 tool call、子进程或 provider continuation state。详见[会话与 trace](SESSIONS.md)。

## 下一步

- 在 [CLI UI](CLI_UI.md) 中学习全部快捷键和斜杠命令。
- 通过[配置参考](CONFIGURATION.md)定制模型、limits 与 context。
- 在打开不受信任仓库或信任 plugin 前阅读[安全模型](SECURITY_MODEL.md)。
- 通过[项目上下文](PROJECT_CONTEXT.md)添加 `AGENTS.md` 或 Skill。
- 通过[插件开发](PLUGINS.md)扩展 Forge。
- 运行 `pnpm eval:deterministic` 并阅读[评测指南](EVALUATION.md)，复现不产生付费调用的证据。
- 如果行为与文档不符，使用[故障排查](TROUBLESHOOTING.md)。
