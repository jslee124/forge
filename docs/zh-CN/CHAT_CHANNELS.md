# 聊天渠道（实验性）

[English](../CHAT_CHANNELS.md) · [中文目录](README.md)

开发 checkout 已提供前台 Telegram 网关，限定一个所有者、一个私聊和一个工作区。
它复用 Forge 原生引擎、模型配置、工具及持久化会话。这是目标为 0.4.0 的未发布源码功能，
真实 Telegram 验收与发布仍待完成。不支持 Codex 引擎、群聊、语音、附件、后台服务安装
或 Desktop 网关设置。

## 本地配置

先按[快速上手](GETTING_STARTED.md)配置可工作的原生模型。
通过 [BotFather](https://t.me/BotFather) 创建 Telegram bot，通过可信方式取得自己的
数字用户 ID，并将 bot token 放入 `FORGE_TELEGRAM_BOT_TOKEN` 环境变量。
不要把值写进 shell 历史、仓库文件、聊天消息或诊断报告。

在开发 checkout 中执行，替换所有者和工作区占位符：

```bash
pnpm forge gateway setup telegram --owner <numeric-user-id> --workspace <absolute-workspace-path> --alias forge --permission-profile safe --accept-remote-disclosure
pnpm forge gateway run
```

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

## 私聊使用

| 输入 | 结果 |
| --- | --- |
| 文本 | 网关和工作区空闲时启动任务 |
| `/help` | 支持的命令 |
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
pnpm forge gateway status
```

显示的是最近一次持久化观察，不保证进程此刻存活。Ctrl+C 或 SIGTERM 请求关闭，
CLI 最多等待十秒后强制退出。重启后未完成任务变为 interrupted，绝不自动重跑。
工具可能在崩溃前已执行，发送新任务前应先检查现有副作用。
已完成对话历史可以继续使用，待处理审批和进程不会恢复。

暂时传输失败会退避；一次发送失败后最多重试五次。outbox 满或投递耗尽重试次数时暂停新任务。
修复网络/凭据后，停止网关，再显式重新排队待投递回复：

```bash
pnpm forge gateway retry-delivery
pnpm forge gateway run
```

它只重试回复，不重跑任务。如果此前发送结果不确定，可能收到相同任务 ID 的重复回复。
旧审批会被丢弃。无效凭据会停止连接，轮换环境变量中的 token 后重启。
同一宿主上的一个 bot 只能有一个 poller，即使使用不同 Forge home。
另一台机器上的 poller 仍可能造成 Telegram 冲突，每个 bot 应只运行在一个宿主上。

工作区/poller 租约位于 OS 临时目录下的用户专属 `forge-execution-*` 目录。
死亡进程的租约可恢复；损坏租约或中断的恢复 guard 会关闭执行。
手工本地清理前先检查归属进程，不得删除仍存活进程的租约来绕过 busy 检测。

## 验证边界

确定性测试使用 fake provider/transport，包括不支持按钮的第二个适配器，
不能证明 Telegram 网络可达或真实 provider 行为。
[Spec](CHAT_CHANNELS_SPEC.md) 保留真实验收和发布 gates。
本文不表示包版本已升级、npm 已发布或 Desktop 已发布新版本。
