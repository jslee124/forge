## 简体中文

Forge Desktop 0.3.4 Preview 4 更新了桌面工作台的布局与操作。它提供 Windows x64 安装包，以及 Apple Silicon 和 Intel Mac 的 DMG；桌面版与 Forge CLI 分开发行。

### 本次变化

- macOS 收起任务侧栏后，主内容区使用腾出的宽度；顶部仍可直接打开工作空间、新任务、工作台和设置。展开态保留侧栏字标，Windows 继续使用原生标题栏。
- 模型选择器可在选择模型或点击外部后关闭，弹层在工作台面板打开时保持在主内容区内。
- 设置页改为四个分区；任务侧栏支持鼠标拖动与键盘调宽，并记住展开宽度。
- 更新 DeepSeek 模型默认值与旧模型 ID 的兼容处理，并为 macOS 和 Windows 包加入新的铁砧图标。

### 下载与安装

- **Windows x64：**下载 `forge-desktop-0.3.4-x64.exe`。
- **macOS：**Apple Silicon 下载 `forge-desktop-0.3.4-arm64.dmg`；Intel Mac 下载 `forge-desktop-0.3.4-x64.dmg`。
- 下载同一发布页的 `SHA256SUMS` 核对文件摘要。配置、认证和更新步骤见 [Windows 安装指南](https://github.com/jslee124/forge/blob/dev/apps/desktop/INSTALL-WINDOWS.zh-CN.md)或 [macOS 安装指南](https://github.com/jslee124/forge/blob/dev/apps/desktop/INSTALL.zh-CN.md)。

### 使用前请注意

这是未签名的预览版；macOS DMG 也未公证。系统可能显示安全提示。请确认下载来源并核对摘要。更新旧版时先保存工作、退出应用，再手动安装新版本。Windows ARM64 暂无安装包。真实模型登录、所有网络路径、macOS 原生窗口按钮与全屏操作，以及所有目标硬件上的已安装应用行为，尚未完成全面验收。

验证范围与剩余限制见 [Preview 4 发布记录](https://github.com/jslee124/forge/blob/dev/evals/reports/desktop-0.3.4-preview.4/README.zh-CN.md)。

## English

Forge Desktop 0.3.4 Preview 4 updates the workbench layout and controls. It includes a Windows x64 installer and DMGs for Apple Silicon and Intel Macs. Desktop releases are separate from the Forge CLI.

### What's changed

- On macOS, collapsing the task sidebar gives its width to the main content while workspace, New Task, Workbench, and Settings remain accessible from the top row. The expanded sidebar retains its wordmark. Windows keeps its native title bar.
- The model picker closes after selection or an outside click, and its popover stays within the main content when the Workbench panel is open.
- Settings has four sections. The task sidebar supports pointer and keyboard resizing and remembers its expanded width.
- DeepSeek defaults and legacy model ID handling are updated, and macOS and Windows packages use a new anvil icon.

### Download and install

- **Windows x64:** download `forge-desktop-0.3.4-x64.exe`.
- **macOS:** download `forge-desktop-0.3.4-arm64.dmg` for Apple Silicon or `forge-desktop-0.3.4-x64.dmg` for Intel.
- Use `SHA256SUMS` from this release to verify the download. See the [Windows installation guide](https://github.com/jslee124/forge/blob/dev/apps/desktop/INSTALL-WINDOWS.md) or [macOS installation guide](https://github.com/jslee124/forge/blob/dev/apps/desktop/INSTALL.md) for setup, authentication, and updates.

### Before you install

This preview is unsigned, and the macOS DMGs are not notarized. Your system may show a security warning. Check the download source and checksum. To update, save your work, quit the existing app, and install the new version manually. A Windows ARM64 installer is not available. Real model sign-in, every network route, native macOS window controls and full-screen interaction, and installed-app behavior on every target machine have not received complete acceptance testing.

See the [Preview 4 release record](https://github.com/jslee124/forge/blob/dev/evals/reports/desktop-0.3.4-preview.4/README.md) for validation scope and remaining limits.
