# 快速上手

English · 中文目录

本指南带你从零完成 Forge 的安装、认证、离线校验与首次任务试跑。前三步完全在本地离线运行，只有你主动提交任务时才会请求模型。

## 环境要求

- **Node.js** 24.22.1 或更高版本
- **pnpm** 11.18.0（已在根目录 `packageManager` 字段锁定）
- **Git**
- 任选一种模型接入方式：
  - DeepSeek API 密钥（`DEEPSEEK_API_KEY`）
  - OpenAI API 密钥（`OPENAI_API_KEY`）
  - 任意兼容 OpenAI 协议的 HTTP 端点
  - 已购买有效套餐且登录官方 Codex CLI 的 ChatGPT 账号（用于 Codex 引擎）

如果只是日常使用命令行，直接安装公开发布的 `@jslee124/forge` 即可（内部 `@forge/*` 包保持私有，不单独发布）：

```bash
npm install --global @jslee124/forge
forge --version
```

## 1. 构建源码开发版（可选，贡献者路径）

如果你准备修改或调试 Forge 源码：

```bash
git clone https://github.com/jslee124/forge.git
cd forge
pnpm install --frozen-lockfile
pnpm build
pnpm forge --version
```

执行完后应本地打印 `0.5.0-preview.1`，不会访问网络。开发期建议直接使用 `pnpm forge ...`；如果想让系统全局的 `forge` 命令指向当前源码构建产物（`apps/cli/dist`），可执行 `pnpm link:global`（之后改完 TS 代码记得重新 `pnpm build`，不再需要时用 `pnpm unlink:global` 取消）。

## 2. 选择模型接入方式

| 接入方式 | 驱动引擎 | 凭据归属 | 推荐配置入口 |
| --- | --- | --- | --- |
| DeepSeek API | Forge 引擎 | Forge 本地凭据或 `DEEPSEEK_API_KEY` | 启动 `pnpm forge` 后输入 `/login` |
| OpenAI API | Forge 引擎 | Forge 本地凭据或 `OPENAI_API_KEY` | 启动 `pnpm forge` 后输入 `/login` |
| 兼容 OpenAI 端点 | Forge 引擎 | 路由凭据或环境变量 | 通过 `/login` 或用户配置添加路由 |
| ChatGPT 订阅 | Codex 引擎 | Codex App Server | `pnpm forge auth login openai` |

> **注意：** OpenAI API 按量计费与 ChatGPT 订阅权限相互独立，订阅账号不能替代 `OPENAI_API_KEY`，API 密钥也不能登录 Codex 引擎。

### 方式 A：在终端界面内通过 `/login` 配置（推荐）

运行 `pnpm forge` 进入交互界面后输入 `/login`，选择 DeepSeek、OpenAI API 或新增第三方兼容端点并输入密钥。Forge 会将其写入仅当前系统用户可读的 `$FORGE_HOME/auth.json`（默认 `~/.forge/auth.json`）。随后可用 `/model` 切换模型，用 `/effort` 或 `Shift+Tab` 调整推理深度。

### 方式 B：使用环境变量

适合脚本调用或临时会话（同名环境变量优先级始终高于本地保存的密钥）：

```bash
export DEEPSEEK_API_KEY="your-api-key"
# 或
export OPENAI_API_KEY="your-api-key"
```

切勿把密钥写进项目 `.forge/config.json`、提交记录或反馈贴中——项目配置 schema 也会主动拒绝密钥字段，保护工作区安全。

### 方式 C：通过 Codex App Server 使用 ChatGPT 订阅

先安装官方 Codex CLI，再让 Forge 触发标准 OAuth 或设备码登录：

```bash
pnpm forge auth login openai
pnpm forge auth status openai
pnpm forge models list --provider openai
```

无浏览器环境（如远程服务器）请使用设备码流程：

```bash
pnpm forge auth login openai --method device-code
```

Codex 引擎完全运行在官方 Codex App Server 内，自行负责工具、沙箱、审批和会话状态；原生 Forge 插件与 JSONL trace 不介入该引擎。详见认证说明。

## 3. 调用模型前先做本地校验

在真正消耗任何 token 前，建议先运行以下三条完全离线的命令核对配置与扩展状态：

```bash
pnpm forge config validate
pnpm forge config show
pnpm forge plugins list
```

默认初始配置会启用 `safe` 安全档位、60 秒单命令超时、开启运行 trace 以及 `manual` 上下文管理模式。需注意：仓库内的 `.forge/config.json` 只能收紧预算或安全阈值，无法篡改你的默认模型、偷偷启用插件或放宽审批规则。配置合并顺序详见配置说明。

## 4. 运行你的第一个任务

进入一个熟悉的小仓库，启动交互界面：

```bash
pnpm forge
```

先试一个纯只读任务（在 `safe` 档位下，工作区内列表、读取与搜索会自动放行）：

```text
Inspect this repository. Summarize the package structure and name the commands
that verify a change. Do not modify files.
```

接着试一个会触发人工审批的改代码任务：

```text
Fix one failing test. Show the proposed diff and run the narrowest relevant
verification command before reporting success.
```

进入首次文件修改或执行 `run_command` 外部程序前，Forge 会暂停并完整展示待改 diff 或命令的工作目录、参数与超时限制。请确认无误后再批准——被批准的命令会以你当前系统用户权限运行；如果选择拒绝，Forge 会如实记录并告知模型，绝不绕过策略重试。

### 单次命令行模式（非交互界面）

无需进入 TUI，可直接从终端发起单次运行：

```bash
pnpm forge run "Inspect the repository and summarize its architecture"
pnpm forge codex "Inspect the repository and summarize its architecture"
# 等价写法：
pnpm forge run --engine codex "Inspect the repository"
```

如果标准输入或错误输出被重定向（例如在管道或 CI 脚本里没有 TTY 交互通道），所有需要确认的操作都会自动拒绝，因此自动化脚本请保持只读任务或提前配置窄范围许可。

## 5. 会话恢复与事后审计

在交互界面中常用命令：

- `/context` — 查看当前上下文预算占用与检查点详情
- `/compact` — 立即生成一个对话检查点（完整历史原文仍保留在磁盘上）
- `/resume` — 选择并恢复当前工作区的历史会话
- `/help` — 查看完整斜杠命令列表

在 shell 中查看历史与轨迹：

```bash
pnpm forge resume --last
pnpm forge inspect <run-id>
```

恢复会话时会重新校验当前工作区并读取最新配置与 `AGENTS.md`，不会复活旧审批、遗留后台子进程或厂商续接令牌。详见持久化会话与 Trace。

## 下一步阅读

- CLI UI 使用参考 — 快捷键、`@` 文件引用、图片粘贴与多会话切换
- 配置说明 — 用户配置与项目配置的优先级及安全边界
- 安全模型 — 文件系统、插件信任与子进程执行边界详解
- 项目上下文 与 插件开发指南 — 编写 `AGENTS.md`、便携式 Skills 与本地插件
- 评测指南 — 如何本地运行零付费请求的 `pnpm eval:deterministic`
- 故障排查 — 认证、终端按键与插件问题的快速定位
