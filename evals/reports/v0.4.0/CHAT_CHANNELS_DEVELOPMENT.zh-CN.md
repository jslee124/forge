# 聊天渠道开发证据 — 2026-09-28

[English](CHAT_CHANNELS_DEVELOPMENT.md) · [Spec](../../../docs/zh-CN/development/CHAT_CHANNELS_SPEC.md) · [源码指南](../../../docs/zh-CN/product/operations/CHAT_CHANNELS.md)

本文为开发快照，不是发布声明。目标版本为 0.4.0，workspace/package 仍为 0.3.4，
未创建发布标签或执行发布。开发位于 `dev`，文档基线提交为 `8149271`。
当前源码和最新测试优先于本文。

## 已实现源码范围

- Telegram 私聊文本网关：本地显式配置所有者、工作区、profile；前台运行、状态与仅重试投递命令。
- 共享 application/native runtime、规范化会话持久化、取消、独立 gateway 会话、逐次远程审批。
  普通 CLI/Desktop 的 permission profile 保持现有行为。
- 持久化 inbox/checkpoint 和有界 outbox；中断任务不自动重放，重试回复不重新执行任务，审批不恢复。
- 原生及 Codex application 入口共用宿主级工作区租约，支持死亡进程恢复；
  Codex 的工作区解析不读取 provider 配置。
- 与传输无关的服务测试，包括无按钮的第二个适配器；Telegram 纯文本展示，
  有界响应/输入/输出、退避和启动时关闭不安全执行。
- 双语源码指南、intent/spec 实现说明及打包后的产品帮助。

网关仍只支持 Forge 原生引擎；Codex 路径的改动仅用于协调工作区执行，
不表示 Telegram 已支持 Codex。

## 已记录验证

| 检查 | 结果 |
| --- | --- |
| `CI=true pnpm check` | 类型检查和发布路由通过；Biome 有 4 项 warning、19 项 info，无 error |
| `CI=true pnpm test` | 81 个文件通过、4 个跳过；538 项测试通过、6 项跳过 |
| 聚焦 gateway/runtime/lease/policy 测试 | 5 个文件、44 项通过 |
| `CI=true pnpm eval:deterministic` | 13 个文件、71 项通过 |
| `CI=true pnpm package:verify` | 本地构建并安装 `@jslee124/forge@0.3.4`；gateway 帮助、离线 setup、status 和投递恢复通过 |
| `CI=true pnpm check:docs`、`git diff --check` | 通过 |

临时安装测试使用占位 bot token，不发送 Telegram 请求。
集成测试使用 fake fetch transport 和 fake model，覆盖真实网关轮询循环、原生 application、
工具审批/文件写入、会话持久化、回复投递及关闭。npm 安装依赖不属于 agent/provider 真实验收。

已覆盖未授权/非私聊/不支持的消息、旧消息、重放、工作区忙碌、错误/过期/重复/动作变化审批、
取消、截止时间、执行前和模拟副作用后的持久化失败、重启中断、最终发送尝试不确定时的恢复、
投递重试耗尽、journal 满时取消、持久化收件人不匹配、bot/webhook 校验、限流和凭据失败。
恢复测试使用受控持久化快照和故障注入，不代表断电或跨平台长期运行测试。

## 剩余验收与发布工作

- C10：真实 Telegram 所有者及第二个未授权账号、真实 provider 执行、允许/拒绝/取消、
  重启和断网试验。本任务未运行。
- 扩展运行证据：真实长期网络条件、主机睡眠、OS 强制终止；未运行 Windows/Linux 验收。
- 未重新进行 Desktop 安装版验收。全量套件中的现有 Desktop 自动化测试已通过，证据边界不同。
- 版本准备、预发布分发、发布说明及不可变标签、npm 发布、Desktop 发布仍是独立工作。

不能只凭离线结果就标记功能发布验收完成，完整合同仍是
[Spec 验收矩阵](../../../docs/zh-CN/development/CHAT_CHANNELS_SPEC.md#7-验收矩阵)。
