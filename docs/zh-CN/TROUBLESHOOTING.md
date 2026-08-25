# 故障排查

[English](../TROUBLESHOOTING.md) · [中文文档目录](README.md)

先运行下面这些只读检查。它们不会联系模型，也不会修改仓库，却能定位大多数安装和配置问题：

```bash
node --version
pnpm --version
pnpm forge --version
pnpm forge config validate
pnpm forge config show
pnpm forge plugins list
```

Forge 要求 Node.js 24 或更高版本，仓库固定 pnpm 11.18.0。命令失败时优先保留第一条可操作错误；后续 provider 或 session 错误可能只是同一个配置问题的连锁结果。

## 安装或构建失败

### 非交互环境中 pnpm 等待替换 `node_modules`

使用 CI mode：

```bash
CI=true pnpm install --frozen-lockfile
pnpm build
pnpm check
pnpm test
```

### 全局 `forge` 没有反映源码变动

`pnpm link:global` 链接的是构建后 CLI，不会运行时解释 TypeScript：

```bash
pnpm build
forge --version
command -v forge
```

不再需要时运行 `pnpm unlink:global`。

## 配置无效或结果出乎预期

```bash
pnpm forge config validate
pnpm forge config show
```

常见原因包括 JSON 格式错误、未知字段、缺少 `"schemaVersion": 1`，或把 user-only 字段写进项目 `.forge/config.json`。项目配置只能设置更严格的 `limits` 与 `context`；`show` 输出会显示环境变量或 CLI override 的来源。

如果设置了 `FORGE_HOME`，该进程不会使用 `~/.forge`。编辑前先看 `Forge home:` 行。

## API 认证失败

### `Missing DEEPSEEK_API_KEY` 或 `Missing OPENAI_API_KEY`

在交互式 Forge 中使用 `/login` 保存 key，或导出对应变量：

```bash
export DEEPSEEK_API_KEY="your-api-key"
# 或
export OPENAI_API_KEY="your-api-key"
```

环境变量优先于 `$FORGE_HOME/auth.json`。以下命令只报告来源，不打印 key：

```bash
pnpm forge auth status deepseek
pnpm forge auth status openai-api
```

如果 `/logout` 提示环境变量仍然存在，需要你在父 shell 中自行 `unset`；子进程不能修改父进程环境。

### 混淆 ChatGPT subscription 与 OpenAI API

- `OPENAI_API_KEY` 通过 native Forge Engine 使用按量计费 OpenAI API。
- `forge auth login openai` 和 `forge codex ...` 通过 Codex App Server 使用 ChatGPT subscription。

Forge 不会在两者之间自动转换。完整说明见[认证模型](AUTHENTICATION.md)。

### 修改 endpoint 后，保存的 route key 不再工作

保存的 route credential 与规范 `baseUrl` 绑定。Forge 不会把旧 key 发往新 endpoint。打开 `/login`，检查完整 URL 后为该 route 重新保存 credential。

### 请求在认证前失败

DNS、connection refused、TLS 或 timeout 都发生在 provider 验证 key 之前。先检查网络、route `baseUrl`、proxy 变量和本地 server 是否运行，不要在传输层尚不可达时轮换或到处粘贴 credential。

## ChatGPT / Codex Engine 登录失败

确认 Codex CLI 可用，再检查共享账号和 model catalog：

```bash
pnpm forge auth status openai
pnpm forge models list --provider openai
```

浏览器 callback 不可用时：

```bash
pnpm forge auth login openai --method device-code
```

`forge auth logout openai` 操作共享 Codex 账号，可能让其他本地 Codex client 一并退出。Forge 不会直接读取或修复 Codex credential 文件。

## 写入、命令、网络请求或 subagent 被拒绝

`safe` 下每次 native run 的首次写入需要确认；每一条进程命令、注册网络工具调用和委派模型运行也要确认。`workspace-write` 只会自动允许 workspace 文件写入，后三类仍需确认。

当 stdin/stderr 不是 TTY 时，one-shot native run 没有审批通道，需要确认的操作会 fail closed。这是预期行为。请改在终端运行、把任务缩小为只读，或使用专门的自动化/评测审批通道。不要把切换 profile 当成 OS isolation；两种 profile 都不会 sandbox 获批进程。

## 项目 plugin 被发现但显示 skipped

Forge 会从规范 workspace root 的 `.forge/plugins/` 发现项目 plugin，但在信任前不会 import。检查代码后使用 `/plugins` 面板，或：

```bash
pnpm forge plugins list
pnpm forge plugins trust
```

显式非交互信任：

```bash
pnpm forge plugins trust --yes
```

Trust 按规范 workspace path 保存到仓库外；复制或移动 checkout 后需要重新决定。用户 plugin 位于 `$FORGE_HOME/plugins`，并且必须出现在 `plugins.enabled`。

Codex Engine 有自己的 tool runtime，不加载 Forge plugin。

## 找不到 `web_search` 或 `web_fetch`

它们不是内置工具，而是 `examples/plugins/web-tools` 中的可选示例。需要显式安装、启用并重启 Forge，再确认启动资源面板列出了它。

代理环境下，该示例支持 `HTTP_PROXY`、`HTTPS_PROXY` 与 `NO_PROXY`，也支持小写别名。应配置 HTTP 或 mixed proxy endpoint，而不是 SOCKS-only port。直接和 `NO_PROXY` 路径仍保留私有/保留地址检查。详见[示例 README](../../examples/plugins/web-tools/README.md)。

## Reasoning 缺失或显示 unavailable

Forge 只渲染和持久化 provider 实际公开的 reasoning 文本。Reasoning token 用量为正，并不保证 API 返回了可展示 summary/delta；Forge 不会编造隐藏 chain of thought。

```bash
pnpm forge config show
```

检查 provider、model 与 effort，再通过 `/model` 和 `/effort` 选择 provider 明确公开的能力。如果回答正常流式输出，但 reasoning 明确 unavailable，限制可能来自上游而不是终端 renderer。

## 图片附件失败

Forge 支持 JPEG、PNG、GIF、WebP，最多 8 张、单张 20 MiB、总计 40 MiB，并检查真实 magic bytes。选中的 native model 必须声明 image support。

用户粘贴路径或 `--image` 是显式附件授权，因此可以位于 workspace 外；model 调用的文件工具仍被限制在 workspace。检查文件是否可读且为普通文件、格式和大小是否合规、model 是否兼容。Session 不会持久化 base64 图片数据。

## Resume 找不到或无法打开 session

Session 与 workspace 绑定。请在同一个规范仓库中启动：

```bash
pnpm forge resume --last
```

Snapshot 位于 `$FORGE_HOME/sessions`。修改 `FORGE_HOME`、移动 checkout、删除或损坏 JSON 都会影响结果。Resume 只恢复 completed turns，不能继续中断的 stream 或待处理 tool call。

## 终端输入或渲染异常

- Enter 提交。
- 支持的终端中 Shift+Enter 插入换行。
- Ctrl+J 是通用多行 fallback。
- Ctrl+C 先关闭 menu，再取消 run，仅在 idle 时退出。
- `NO_COLOR` 禁用颜色；重定向输出使用纯文本安全格式。

Forge 对 VS Code 与 Ghostty 有专门键盘处理。如果终端无法区分 Shift+Enter，请使用 Ctrl+J。报告问题时记录终端名称、`TERM` 和准确按键行为，不要附带 credential 或私有 trace 内容。

## 收集安全的诊断信息

```bash
node --version
pnpm --version
pnpm forge --version
pnpm forge config validate
pnpm forge plugins list
git rev-parse --short HEAD
```

同时说明运行的命令、预期行为、第一条可操作错误、操作系统、终端，以及使用 Forge Engine 还是 Codex Engine。`forge inspect <run-id>` 可以总结 native trace，但分享前必须检查：trace 可能包含仓库文本、diff、命令、模型输出和 provider 暴露的 reasoning。
