# Forge Desktop 0.4.0 Preview 2

## 简体中文

本预览版重点完善任务过程、审批、停止、结果与恢复界面，以及带行号的局部读取和搜索。
运行记录保留已执行操作、失败验证与影响未知状态；重新打开任务不会自动重放旧操作或批准。
修复实验性证据总结模式的日志兼容问题，避免写入的总结事件无法重新读取；同时修复 Windows
缺少 O_NOFOLLOW 时的记录文件校验，拒绝符号链接记录，并在存储故障时停止后续审批和工具操作。

默认不设置固定的模型步骤／工具总调用次数上限；需要控制调用规模时，请在配置中设置
`limits.maxSteps` 与 `limits.maxToolCalls`。审批和路径限制仍然有效，但不是操作系统沙箱，
次数限制也不等于 API 金额上限。

这是预览版：完整两轮产品验收、独立用户测试、部分 IME／VoiceOver、真实 Codex 和目标硬件
验证尚未完成。旧验收失败记录保留，新路径契约已有一次通过，不代表整体稳定或所有输入正确。
Telegram 工作暂缓；本次不新增网关或手机控制能力。桌面版与 CLI/npm 分开发行。

本发布页提供 Windows x64 EXE、Apple Silicon arm64 DMG、Intel x64 DMG，以及对应的
`SHA256SUMS` 和 `desktop-build.json`。安装包未签名，macOS 未公证。保存工作并退出旧应用后，
按 [Windows 指南](https://github.com/jslee124/forge/blob/desktop-0.4.0-preview.2/apps/desktop/INSTALL-WINDOWS.zh-CN.md)
或 [macOS 指南](https://github.com/jslee124/forge/blob/desktop-0.4.0-preview.2/apps/desktop/INSTALL.zh-CN.md)手动安装。

发布流程要求准确标签源码的完整测试、确定性检查、打包安装验证、双平台打包启动检查，
以及 Windows NSIS 安装／启动／卸载检查；上传后核对文件大小和 SHA-256 才公开发布。
实际发布状态和验证边界见[发布记录](https://github.com/jslee124/forge/blob/main/evals/reports/desktop-0.4.0-preview.2/README.zh-CN.md)。

## English

This preview improves task progress, approvals, cancellation, outcomes and reviewed recovery,
with numbered partial file reads and scoped search. Run records distinguish executed effects,
failed verification and unknown effects; reopening a task does not replay old actions or approvals.
It also fixes reading trace events from experimental evidence-summary finalization and rejects symlinked
record files on Windows without O_NOFOLLOW, stopping approvals and tool effects on storage failure.

Model-step and total tool-call counts have no fixed default cap. Configure `limits.maxSteps` and
`limits.maxToolCalls` when you need finite allowances. Approval and path controls remain effective,
but are application controls rather than an OS sandbox; step quotas are not monetary caps.

Full two-round product acceptance, independent user trials, some IME/VoiceOver checks, real Codex
and target-hardware coverage remain incomplete. Old failures are retained; one clarified path-contract
sample passed and is not a general stability claim. Telegram work is deferred. No new gateway or
mobile-control capability is added. Desktop and CLI/npm releases are separate.

Assets: Windows x64 EXE, Apple Silicon arm64 DMG, Intel x64 DMG, `SHA256SUMS`, and
`desktop-build.json`. Installers are unsigned and macOS is not notarized. Save work and quit the
old application before manual installation; see the [Windows guide](https://github.com/jslee124/forge/blob/desktop-0.4.0-preview.2/apps/desktop/INSTALL-WINDOWS.md)
or [macOS guide](https://github.com/jslee124/forge/blob/desktop-0.4.0-preview.2/apps/desktop/INSTALL.md).

Publication requires full tests, deterministic checks, packed-install verification, packaged smoke
on both platforms and Windows NSIS install/start/uninstall on the exact tagged source, followed by
uploaded size and SHA-256 verification. Actual publication state and limits are retained in the
[release record](https://github.com/jslee124/forge/blob/main/evals/reports/desktop-0.4.0-preview.2/README.md).
