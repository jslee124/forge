# 聊天渠道（实验性）

[English](../../../product/operations/CHAT_CHANNELS.md) · [中文目录](../../README.md)

Forge 0.4.0 提供实验性前台 Telegram 网关，限定一个所有者、一个私聊和一个工作区。
它复用 Forge 原生引擎、模型配置、工具及持久化会话。macOS 核心真实测试和
Linux/Windows 自动化测试已通过；完整真实验收仍未完成。
不支持 Codex 引擎、群聊、语音、附件、后台服务安装或 Desktop 网关设置。

## 安装 0.4.0

需要 Node.js 24 或更高版本：

```bash
npm install --global @jslee124/forge@0.4.0
forge --version
```

安装包用户可以按下文创建配置和工作区，直接运行 `forge` 配置模型，
并将所有 `node "$FORGE_CHECKOUT/apps/cli/dist/index.js"` 替换为 `forge`。
无需设置 `FORGE_CHECKOUT` 或执行源码构建。开发者继续使用下方 checkout 流程。

## 1. 准备源码、模型和工作区

以下命令适用于 macOS 的 zsh 或 Linux 的 Bash；不是 PowerShell 教程。
需要 Node.js 24+、pnpm 11.18.0、已登录的 Telegram 账号和可用的原生模型凭据。
源码方式需要包含 gateway 命令的 0.4.0 checkout。
在 Forge checkout 根目录执行：

```bash
pnpm install --frozen-lockfile
pnpm build
export FORGE_CHECKOUT="$PWD"
export FORGE_HOME="$HOME/.forge-telegram"
export FORGE_TEST_WORKSPACE="$HOME/forge-telegram-workspace"
mkdir -p "$FORGE_HOME" "$FORGE_TEST_WORKSPACE"
cd "$FORGE_TEST_WORKSPACE"
node "$FORGE_CHECKOUT/apps/cli/dist/index.js"
```

这里创建独立且持久的配置目录，不会自动继承 `~/.forge` 中的模型配置和登录信息。
在交互界面输入 `/login` 配置模型凭据，再用 `/model` 选择 **Forge 原生引擎**和可用模型。
发送“只回复 TEST_OK，不调用工具”，收到回复后输入 `/exit`。
具体认证方法见[快速上手](../start/GETTING_STARTED.md)。真实模型请求可能产生费用。
工作区应在源码仓库之外；如果它位于另一个 Git 仓库内，绑定范围会提升到发现的项目根目录。

后面的步骤使用同一个终端，保留上述环境变量。已有可用配置也可复用，但所有步骤必须使用
相同的 `FORGE_HOME`。以下示例先绑定测试目录，确认工作正常后再配置实际项目。

## 2. 创建 Telegram bot

1. 在 Telegram 打开官方 [@BotFather](https://t.me/BotFather)，核对用户名。
2. 点击 Start，发送 `/newbot`。
3. 输入显示名称，例如 `Forge Assistant`。
4. 按提示设置未被占用、以 `bot` 结尾的用户名。
5. 保存 BotFather 返回的 Token，并打开它提供的 bot 私聊链接。

这是 bot 的凭据，不是个人账号的登录码，也不是模型 API key。
仅登录 Telegram 网页不会自动连接 Forge。操作依据见 [Telegram 官方教程](https://core.telegram.org/bots/tutorial)。

## 3. 安全设置 Token

macOS 默认 zsh：

```zsh
read -rs 'FORGE_TELEGRAM_BOT_TOKEN?粘贴 Bot Token，然后回车：'
echo
export FORGE_TELEGRAM_BOT_TOKEN
```

Bash：

```bash
read -rsp 'Paste Bot Token, then press Enter: ' FORGE_TELEGRAM_BOT_TOKEN
echo
export FORGE_TELEGRAM_BOT_TOKEN
```

输入不回显，Token 不直接写入命令历史。不要把它放进浏览器 URL、仓库、截图或诊断报告。
环境变量只对当前终端及其子进程有效；新开终端时需要重新设置。
不要通过 `echo` 或完整环境变量输出检查秘密。

## 4. 获取自己的数字用户 ID

此时不要启动网关，也不要让其他程序轮询这个 bot。在刚创建的 **bot 私聊**中点击 Start，
再发送 `/forge_setup_id`。网关未运行时没有回复是正常的；这条消息只用于识别自己的 ID。

在同一个终端执行下面的脚本。它只向 Telegram 官方 API 请求消息，输出匹配的数字 ID，
不会输出 Token 或完整消息记录；不要把其他人的 ID 用作所有者。

```bash
node --input-type=module <<'NODE'
const token = process.env.FORGE_TELEGRAM_BOT_TOKEN;
if (!token) throw new Error("Set FORGE_TELEGRAM_BOT_TOKEN first");
try {
  const response = await fetch(`https://api.telegram.org/bot${token}/getUpdates`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ timeout: 0, allowed_updates: ["message"] }),
    signal: AbortSignal.timeout(15000),
    redirect: "error",
  });
  const data = await response.json();
  if (!data.ok) {
    console.error("Telegram API error:", data.error_code ?? response.status);
    process.exitCode = 1;
  } else {
    const ids = [...new Set(data.result
      .map(update => update.message)
      .filter(message => message?.chat?.type === "private"
        && !message.from?.is_bot && message.text === "/forge_setup_id"
        && message.chat.id === message.from?.id)
      .map(message => String(message.from.id)))];
    console.log(ids.length === 1 ? `Owner ID: ${ids[0]}`
      : "No unique owner found. Send /forge_setup_id from your own account and retry.");
  }
} catch {
  console.error("Request failed. Check network, proxy and token; do not print the token.");
  process.exitCode = 1;
}
NODE
```

记录 `Owner ID:` 后面的数字。它不是 `@用户名`，也不是 Token 冒号前的 bot ID。
未找到时，确认发给了正确的 bot，重新发送该命令再执行脚本。
如果出现多个候选，停止配置并核实身份，不要自动选择第一个发送者。
此方法适合新建专用 bot；已有 webhook 或其他 poller 的 bot 需要先处理冲突。
接口说明见 [getUpdates](https://core.telegram.org/bots/api#getupdates)。

## 5. 配置并启动网关

把下面的 `123456789` 替换为刚确认的所有者数字 ID：

```bash
node "$FORGE_CHECKOUT/apps/cli/dist/index.js" gateway setup telegram \
  --owner 123456789 \
  --workspace "$FORGE_TEST_WORKSPACE" \
  --alias sandbox \
  --permission-profile safe \
  --accept-remote-disclosure
node "$FORGE_CHECKOUT/apps/cli/dist/index.js" gateway run
```

setup 成功会显示配置完成；run 是前台长时间运行的进程，不返回 shell 提示符是正常的。
启动提示本身不证明连接成功：继续做下一节的 Telegram 验证。

`--accept-remote-disclosure` 表示知晓任务文本和选定结果将经过 Telegram。
绑定目录是从给定路径发现的规范化项目根目录。只有指定数字 ID 的所有者可以在私聊调用。
不采用首个发送者配对，也不开放公共访问。如果已有 webhook，网关会拒绝启动；
选择 long polling 前需要先在本地处理已有 webhook 配置。

配置位于 `FORGE_HOME/gateway/config.json`，状态和待发送回复位于
`FORGE_HOME/gateway/state.json`。未指定 `FORGE_HOME` 时使用 `~/.forge`。
token 保留在环境变量中，会话位于同一 Forge home 的 `sessions/` 目录。
长期对话应使用持久目录；临时目录仅适合可丢弃的测试，可能被系统清理。
setup 拒绝覆盖已有配置，修改本地配置前先停止网关。
改变所有者、工作区、profile 或 bot 后，原状态绑定会失效：使用新绑定前先在本地归档
旧 gateway state；旧 session 仍保留，但不会自动分配给新所有者。

网关运行在包含仓库的机器上，需要访问 Telegram 和模型服务；沿用现有 HTTP(S) proxy
环境设置。Long polling 不需要公网入站端口。进程必须持续运行、主机保持唤醒；
关闭 Desktop 不会停止这个独立前台进程。

## 6. 验证连接与审批

在 bot 私聊发送 `/start` 或 `/help`，应收到命令列表和 `sandbox` 工作区别名。
再发送 `/status`，确认能收到状态回复；这些命令不调用模型。
然后逐项测试，每项等待前一任务结束：

| 操作 | 预期结果 |
| --- | --- |
| “只回复 TEST_OK，不调用工具” | 收到接受通知和模型最终回复 |
| “记住口令 TG-TEST-123”，再询问口令 | 同一会话能回忆口令 |
| “创建 hello.txt，内容为 hello telegram” | 收到动作描述及 Allow once / Deny 按钮；批准后文件才写入 |
| “创建 denied.txt；被拒绝后停止，不要重试” | 点击 Deny 后不生成文件 |
| 请求创建 cancelled.txt，审批时发送 `/cancel` | 任务取消，旧审批不能继续执行 |

只在测试目录里执行写入验证；直接检查本地文件，不要仅凭模型文字判断执行成功。
完成任务后在终端按 Ctrl+C，再用相同环境执行 `gateway run`；重新询问口令可验证会话恢复。
本轮实测发现过模型误述之前写入行为的情况，文件和执行记录才是验证依据。

## 私聊命令与边界

| 输入 | 结果 |
| --- | --- |
| 文本 | 网关和工作区空闲时启动任务 |
| `/help` 或 `/start` | 支持的命令 |
| `/status` | 不调用模型，返回任务状态与待发送数量 |
| `/new` | 空闲时开始新对话，保留历史记录 |
| `/cancel` | 请求取消，使待处理审批失效 |

忙碌消息直接拒绝，不排队。转发、编辑、bot 发起、非私聊及附件不能启动任务。
拒绝超过五分钟的任务文本和超过 16 KiB 的输入。回复包含任务 ID；最终文本可能分段、
截断，并提供本地 session 引用供检查。该引用不是远程文件链接。
不发送隐藏推理和原始工具 trace。脱敏覆盖已配置秘密和已知模式，不能识别仓库中的所有私密事实。

远程非只读动作都需要逐次批准，包括 `workspace-write` profile。
按钮只允许当前一次动作或拒绝。审批五分钟后过期，取消或 30 分钟任务总时限到达时提前失效。
动作描述无法在审批消息预算内完整呈现，或需要秘密脱敏时，直接拒绝。
core/plugin 的拒绝不能被覆盖。取消不撤销已有副作用，runner 结束前保持 cancelling。

CLI、Desktop、Gateway 的原生和 Codex 执行路径使用宿主上的共享工作区租约，
竞争执行会返回 busy，包括只读任务。不会锁住其他程序和编辑器。
Gateway 对话与现有 Desktop/CLI 会话隔离，该锁不是 OS sandbox。

## 重启、投递失败与诊断

```bash
node "$FORGE_CHECKOUT/apps/cli/dist/index.js" gateway status
```

显示的是最近一次持久化观察，不保证进程此刻存活。Ctrl+C 或 SIGTERM 请求关闭，
CLI 最多等待十秒后强制退出。重启后未完成任务变为 interrupted，绝不自动重跑。
工具可能在崩溃前已执行，发送新任务前应先检查现有副作用。
已完成对话历史可以继续使用，待处理审批和进程不会恢复。

暂时传输失败会退避；一次发送失败后最多重试五次。outbox 满或投递耗尽重试次数时暂停新任务。
修复网络/凭据后，停止网关，再显式重新排队待投递回复：

```bash
node "$FORGE_CHECKOUT/apps/cli/dist/index.js" gateway retry-delivery
node "$FORGE_CHECKOUT/apps/cli/dist/index.js" gateway run
```

它只重试回复，不重跑任务。如果此前发送结果不确定，可能收到相同任务 ID 的重复回复。
旧审批会被丢弃。无效凭据会停止连接，轮换环境变量中的 token 后重启。
同一宿主上的一个 bot 只能有一个 poller，即使使用不同 Forge home。
另一台机器上的 poller 仍可能造成 Telegram 冲突，每个 bot 应只运行在一个宿主上。

工作区/poller 租约位于 OS 临时目录下的用户专属 `forge-execution-*` 目录。
死亡进程的租约可恢复；损坏租约或中断的恢复 guard 会关闭执行。
手工本地清理前先检查归属进程，不得删除仍存活进程的租约来绕过 busy 检测。

## 常见问题

| 现象 | 排查方式 |
| --- | --- |
| 提示设置 Token | 在启动网关的同一终端重新执行隐藏输入步骤 |
| setup 提示已配置 | 不要反复 setup；使用原来的 FORGE_HOME 执行 run。修改绑定前停止网关并归档旧状态 |
| 要求 Forge native engine | 在同一 FORGE_HOME、同一工作区通过 `/model` 选择原生引擎 |
| bot 没有回复 | 确认进程在线、主机未休眠、发给正确 bot、owner 是自己的数字 ID，并检查 Telegram 网络连接 |
| 帮助正常，任务失败 | 用同一配置在本地交互界面重试简单任务，检查模型认证和额度 |
| webhook 或轮询冲突 | 使用专用 bot，停止其他 poller；确认旧集成不再需要后再处理 webhook，不要直接覆盖正在使用的 bot |
| workspace-busy | 等待或停止同工作区的其他 Forge 任务；不要删除活跃租约 |
| status 显示 connected 但不回复 | 本地 status 是历史状态；不能证明进程仍在运行 |

再次打开终端时，重新设置 `FORGE_CHECKOUT`、`FORGE_HOME` 和 Token，执行 `gateway run` 即可；
无需再次 setup。Token 丢失或泄漏时在 BotFather 管理凭据，更新本地环境后再启动。
本教程的 shell 示例不代表 Windows 已完成真实验收。

## 验证边界

2026-09-29 已在 macOS 上用真实 Telegram 和 DeepSeek 验证对话、审批、拒绝、取消、旧审批失效及重启记忆。
第二账号越权、网络故障和跨平台等完整验收仍未完成。

确定性测试使用 fake provider/transport，包括不支持按钮的第二个适配器，
不能证明 Telegram 网络可达或真实 provider 行为。
[Spec](../../development/CHAT_CHANNELS_SPEC.md) 保留真实验收和发布 gates。
0.4.0 是 CLI/npm 版本；Desktop 使用独立版本和发布流程。
