# Telegram 真实冒烟测试 — 2026-09-29

[English](CHAT_CHANNELS_LIVE_2026-09-29.md) · [使用指南](../../../docs/zh-CN/product/operations/CHAT_CHANNELS.md)

macOS、`dev` 分支、包版本 0.3.4 的开发证据，不是发布或完整验收声明。
用户授权创建专用测试 bot，并使用已登录的 Telegram Web 账号进行测试。
网关使用真实 Telegram Bot API 和已配置的 DeepSeek 原生模型路由
（`deepseek-v4-flash-vision-exp`）。Forge home 和工作区放在仓库外的私有临时目录。
本文不包含 bot token 或模型凭据。

## 观察结果

| 检查 | 证据 |
| --- | --- |
| 连接和帮助 | 网关记录 connected，Telegram 中 `/help` 返回命令列表 |
| 远程状态 | `/status` 在 Telegram 中返回 completed，待投递数量为 0 |
| 真实模型回复 | 请求 `TEST_OK`，实际收到对应回复 |
| 多轮上下文 | 后续消息正确回忆合成测试口令 `TG-929-ALPHA` |
| 批准写入 | 批准前 `hello.txt` 不存在；Allow once 后内容为 `hello telegram` 加换行，共 15 字节 |
| 拒绝 | Telegram 返回 Denied；任务结束后 `denied.txt` 不存在 |
| 取消 | 等待审批时 `/cancel` 使任务进入 cancelled；`cancelled.txt` 不存在 |
| 旧审批 | 取消后点击旧 Allow once 返回 invalid or expired，未生成文件 |
| 进程重启 | SIGTERM 停止网关后重新启动，会话仍保留，正确回忆最初口令 |
| 开始命令回归 | 最初 `/start` 被当作未知命令；修复为帮助入口，重启后真实验证通过 |

模型后来错误声称自己没有写入过 `hello.txt`。直接文件检查和持久化会话中的工具记录
证明该陈述不正确，因此本次冒烟测试不代表模型对历史动作的叙述始终可靠。

## 边界

仅测试 macOS 上的一个所有者账号。未真实验证第二个未授权账号、群聊、附件、模型故障、
限流、副作用执行中进程突然死亡、投递重试耗尽、Windows 或 Linux。
确定性测试属于另一类证据。临时配置可丢弃，bot 保留注册；停止网关后不能继续执行任务。
没有升级版本、发布、签名或安装包验收。

## 本地检查与最终状态

- 网关及运行时专项测试：2 个文件，38 项通过。
- `CI=true pnpm check`：通过；保留 4 个已有警告和 19 条提示。
- `CI=true pnpm check:docs`：226 个 Markdown 文件、912 个本地引用通过。
- `CI=true pnpm package:verify`：0.3.4 版本打包安装验证通过。
- `git diff --check`：通过。
- 中断恢复后，网关租约 PID 检查返回 `ESRCH`，测试网关已不在运行。
  持久化的 connected 状态是历史观察，不代表当前连接。
