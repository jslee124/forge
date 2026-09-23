# Forge Desktop Windows 预览版安装说明

[English](INSTALL-WINDOWS.md) · [桌面版指南](../../docs/zh-CN/DESKTOP.md)

Windows 预览版面向 x64 电脑。从同一个 [Desktop Preview 3 发布页](https://github.com/jslee124/forge/releases/tag/desktop-0.3.4-preview.3)
下载 `forge-desktop-0.3.4-x64.exe` 和 `SHA256SUMS`。在 PowerShell 中运行
`Get-FileHash .\forge-desktop-0.3.4-x64.exe -Algorithm SHA256`，安装前将结果
与 `SHA256SUMS` 中该安装包对应的摘要比较。

NSIS 安装包未签名，Windows 可能显示安全提示。请先核对 GitHub 发布来源和摘要，
仅在信任此预览版时使用系统提供的明确继续入口。安装范围为当前用户；运行应用
不需要全局安装 Forge CLI。更新前请保存工作并退出旧版 Forge Desktop。

Forge 配置、凭据、会话和运行记录默认位于 `%USERPROFILE%\.forge`，可用
`FORGE_HOME` 覆盖。Native Forge 的提供商凭据与 Codex 认证分开管理。Codex CLI
不随应用提供：需要单独安装，并让应用继承的 `PATH` 能找到 `codex`，或在启动
应用前把 `FORGE_CODEX_PATH` 设为可执行文件的完整路径。Codex 不可用时，应用
会显示状态，不会静默切换执行引擎。

应用可检查官方 Desktop 发布、下载并以 SHA-256 校验更新的 Windows 安装包。
打开已校验的安装程序不会自动退出正在运行的应用，也不会自动安装；请退出
Forge Desktop 后继续安装。此预览版没有自动替换或签名更新机制。

Windows CI 会生成 x64 NSIS 安装包，运行针对性的离线测试、启动打包应用，并
检查静默安装、从安装目录启动及卸载。这些检查不代表真实模型登录、所有网络
路径、Windows ARM64 或已签名安装的 SmartScreen 体验得到验证。
