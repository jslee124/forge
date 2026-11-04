# Forge Desktop 0.5.0 Preview 1

## 简体中文

新增独立会话并行执行、FIFO 排队、会话草稿/输出/模型选择/审批/取消隔离，以及已保存聊天删除。默认同时执行两个任务，最多另排队 32 个；可通过 FORGE_MAX_CONCURRENT_RUNS 设置 1–16。审批等待占用并发名额，关闭应用会请求取消当前任务，队列不在重启后重放。

Git 新任务从 HEAD 创建独立 worktree 和分支；未提交/忽略文件和依赖不复制。worktree 不隔离端口、数据库或凭据，删除聊天保留工作文件和分支。

macOS 开发版已使用真实 DeepSeek 与 Codex gpt-6-luna / low 验证多会话、排队取消、审批/取消隔离及历史恢复。Codex 返回了真实 interrupted，另一个会话正常完成。完整产品验收、独立用户、IME/VoiceOver、Windows 实机真实模型和长期负载仍未完成。Codex TUI 与多轮恢复不在本次真实模型验收范围。

本发布提供 Windows x64 EXE、macOS arm64/x64 DMG、SHA256SUMS 和 desktop-build.json。安装包未签名，macOS 未公证。保存工作并退出旧应用后手动安装；见 [Windows 安装](https://github.com/jslee124/forge/blob/desktop-0.5.0-preview.1/apps/desktop/INSTALL-WINDOWS.zh-CN.md) 与 [macOS 安装](https://github.com/jslee124/forge/blob/desktop-0.5.0-preview.1/apps/desktop/INSTALL.zh-CN.md)。npm CLI 独立发布至 next，不更新桌面安装包。

## English

Independent sessions now run concurrently with FIFO waiting, per-session drafts/model selections/output/approvals/cancellation, and saved-chat deletion. Two tasks run by default with up to 32 queued; FORGE_MAX_CONCURRENT_RUNS accepts 1–16. Approvals occupy a slot. Shutdown requests cancellation; queued work is not replayed after restart.

New Git tasks receive separate worktrees/branches from HEAD; uncommitted/ignored files and dependencies are not copied. Ports, databases and credentials remain shared. Chat deletion retains workspace files and branches.

Real DeepSeek and Codex gpt-6-luna / low were tested in macOS development Electron, including queue cancellation, isolation, persisted history and a confirmed Codex interrupted turn while another completed. Full product acceptance, independent users, IME/VoiceOver, real Windows providers and sustained load remain open. Live Codex TUI and multi-turn recovery were not tested in this round.

Assets are Windows x64 EXE, macOS arm64/x64 DMGs, SHA256SUMS and desktop-build.json. Installers are unsigned and macOS is not notarized. Save work and quit the old app before manual installation; see [Windows](https://github.com/jslee124/forge/blob/desktop-0.5.0-preview.1/apps/desktop/INSTALL-WINDOWS.md) and [macOS](https://github.com/jslee124/forge/blob/desktop-0.5.0-preview.1/apps/desktop/INSTALL.md). CLI/npm next publication is separate.

Both-platform packaging/smoke, Windows install/start/uninstall, exact-tag checks and remote asset size/digest validation gate publication. See [release evidence](https://github.com/jslee124/forge/blob/main/evals/reports/desktop-0.5.0-preview.1/README.md) for actual publication status and checks.
