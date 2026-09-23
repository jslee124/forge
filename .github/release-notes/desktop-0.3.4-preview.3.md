## 简体中文

Forge Desktop 0.3.4 Preview 3 首次提供 **Windows x64 安装包**，同时提供适用于 Apple Silicon 和 Intel Mac 的 DMG。桌面版与 Forge CLI 分开发行。

### 下载与安装

- **Windows x64：**下载 `forge-desktop-0.3.4-x64.exe`。
- **macOS：**Apple Silicon 下载 `forge-desktop-0.3.4-arm64.dmg`；Intel Mac 下载 `forge-desktop-0.3.4-x64.dmg`。
- 下载同一发布页的 `SHA256SUMS` 核对文件摘要。配置、认证和更新步骤见 [Windows 安装指南](https://github.com/jslee124/forge/blob/dev/apps/desktop/INSTALL-WINDOWS.zh-CN.md)或 [macOS 安装指南](https://github.com/jslee124/forge/blob/dev/apps/desktop/INSTALL.zh-CN.md)。

### 使用前请注意

这是未签名的预览版；macOS DMG 也未公证。系统可能显示安全提示。请确认下载来源并核对摘要。更新旧版时先保存工作、退出应用，再手动安装新版本。Windows ARM64 暂无安装包。

Windows CI 已验证打包、安装后启动和卸载；macOS CI 已验证打包应用启动。这些检查尚未覆盖 Windows 上的真实模型登录或调用。详细结果见 [发布验证记录](https://github.com/jslee124/forge/blob/dev/evals/reports/desktop-0.3.4-preview.3/README.zh-CN.md)。

## English

Forge Desktop 0.3.4 Preview 3 introduces a **Windows x64 installer** and includes DMGs for Apple Silicon and Intel Macs. Desktop releases are separate from the Forge CLI.

### Download and install

- **Windows x64:** download `forge-desktop-0.3.4-x64.exe`.
- **macOS:** download `forge-desktop-0.3.4-arm64.dmg` for Apple Silicon or `forge-desktop-0.3.4-x64.dmg` for Intel.
- Use `SHA256SUMS` from this release to verify the download. See the [Windows installation guide](https://github.com/jslee124/forge/blob/dev/apps/desktop/INSTALL-WINDOWS.md) or [macOS installation guide](https://github.com/jslee124/forge/blob/dev/apps/desktop/INSTALL.md) for setup, authentication, and updates.

### Before you install

This preview is unsigned, and the macOS DMGs are not notarized. Your system may show a security warning. Check the download source and checksum. To update, save your work, quit the existing app, and install the new version manually. A Windows ARM64 installer is not available.

Windows CI verified packaging, installed-app startup, and uninstall; macOS CI verified packaged-app startup. Real model sign-in and calls on Windows remain untested. See the [release validation record](https://github.com/jslee124/forge/blob/dev/evals/reports/desktop-0.3.4-preview.3/README.md) for details.
