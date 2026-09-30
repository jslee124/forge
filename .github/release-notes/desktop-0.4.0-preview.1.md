## 简体中文

Forge Desktop 0.4.0 Preview 1 将桌面应用的共享运行层更新到 Forge 0.4.0。提供 Windows x64 安装包，以及 Apple Silicon 和 Intel Mac 的 DMG。桌面版与 CLI/npm 分开发行。

### 本次变化

- Native Forge 与 Codex 任务接入工作区执行互斥，与 Forge 0.4.0 CLI 和实验性 Telegram 网关协调。已有任务占用同一工作区时，新任务会被拒绝；任务结束或取消后释放占用。旧桌面版本需要更新才能参与协调。
- 同步 0.4.0 中英文产品帮助，包括 Telegram 教程。Telegram 配置和前台运行仍通过 CLI 完成，本次没有新增桌面网关设置或后台服务。
- 保留 0.3.4 Preview 4 的工作台、模型选择器、侧栏调宽和设置界面。

### 下载与安装

- **Windows x64：**下载 `forge-desktop-0.4.0-x64.exe`。
- **macOS：**Apple Silicon 下载 `forge-desktop-0.4.0-arm64.dmg`；Intel Mac 下载 `forge-desktop-0.4.0-x64.dmg`。
- 使用同一发布页的 `SHA256SUMS` 核对摘要。安装与更新步骤见 [Windows 指南](https://github.com/jslee124/forge/blob/desktop-0.4.0-preview.1/apps/desktop/INSTALL-WINDOWS.zh-CN.md)或 [macOS 指南](https://github.com/jslee124/forge/blob/desktop-0.4.0-preview.1/apps/desktop/INSTALL.zh-CN.md)。保存工作、退出旧应用，再手动安装。仅升级 npm 不会更新桌面应用。

### 验证范围

发布流程要求源码与文档检查、完整测试、确定性评估、npm 打包安装检查，以及双平台打包应用启动和 Windows NSIS 安装／启动／卸载检查。上传安装包后，按清单核对 SHA-256，并核对 GitHub 文件大小与摘要，才公开预览版。实际结果见 [发布记录](https://github.com/jslee124/forge/blob/dev/evals/reports/desktop-0.4.0-preview.1/README.zh-CN.md)。

安装包未签名，macOS DMG 未公证。Windows ARM64 暂无安装包。本次不宣称完成真实模型登录或调用、所有目标硬件、Gatekeeper／SmartScreen、macOS 原生窗口控制或完整 Telegram 实机验收。工作区互斥只协调配合的 Forge 任务，不阻止手工编辑或其他应用。

## English

Forge Desktop 0.4.0 Preview 1 updates the shared runtime to Forge 0.4.0. It includes a Windows x64 installer and DMGs for Apple Silicon and Intel Macs. Desktop and CLI/npm releases are separate.

### What's changed

- Native Forge and Codex tasks use the shared workspace execution lease, coordinating with Forge 0.4.0 CLI and the experimental Telegram gateway. A new task is rejected while another task owns the workspace; completion or cancellation releases it. Older desktop builds must be updated to participate.
- Bundled English and Simplified Chinese product help is updated, including Telegram onboarding. Telegram setup and foreground execution remain CLI commands; this release adds no desktop gateway settings or background service.
- The workbench, model picker, resizable sidebar, and Settings from 0.3.4 Preview 4 are retained.

### Download and install

- **Windows x64:** download `forge-desktop-0.4.0-x64.exe`.
- **macOS:** download `forge-desktop-0.4.0-arm64.dmg` for Apple Silicon or `forge-desktop-0.4.0-x64.dmg` for Intel.
- Verify downloads using `SHA256SUMS` from this release. Follow the [Windows guide](https://github.com/jslee124/forge/blob/desktop-0.4.0-preview.1/apps/desktop/INSTALL-WINDOWS.md) or [macOS guide](https://github.com/jslee124/forge/blob/desktop-0.4.0-preview.1/apps/desktop/INSTALL.md). Save work, quit the old app, and install manually. Updating npm alone does not update Desktop.

### Verification scope

Publication requires source/docs checks, the full test suite, deterministic evaluations, npm package installation checks, packaged-app smoke on both platforms, and Windows NSIS install/start/uninstall checks. Installer SHA-256 values are checked against build manifests, and uploaded file sizes and digests are verified before publishing. Actual results are retained in the [release record](https://github.com/jslee124/forge/blob/dev/evals/reports/desktop-0.4.0-preview.1/README.md).

Installers are unsigned; macOS DMGs are not notarized. Windows ARM64 is unavailable. This release does not claim complete real-provider authentication/calls, target-hardware, Gatekeeper/SmartScreen, native macOS window-control, or live Telegram acceptance. Workspace leases coordinate cooperating Forge tasks, not manual editing or other applications.
