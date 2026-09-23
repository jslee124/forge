# Desktop 0.3.4 Preview 3 发布证据

2026-09-23（Asia/Shanghai）作为公开 GitHub 预览版发布：
[Preview 3](https://github.com/jslee124/forge/releases/tag/desktop-0.3.4-preview.3)。
另见[机器可读记录](release.json)和 [English](README.md)。

- 标签指向 `dev` 上的 `612da758562e37d5907ed2913ae86fbf9392c86e`。[标签 CI](https://github.com/jslee124/forge/actions/runs/35825140016)通过 Ubuntu 检查及 Windows 打包、安装后启动和卸载检查。
- [发布 CI](https://github.com/jslee124/forge/actions/runs/35830601966)的四个任务全部通过：从该标签重建 Windows x64 NSIS 安装包和 macOS arm64/x64 DMG，按各平台清单核对 SHA-256，上传五个发布文件，核对 GitHub 文件大小与摘要后公开预览版。
- 本地 `CI=true pnpm check` 和完整测试通过（492 通过、6 跳过）。本机 macOS arm64 解包应用的 smoke 也通过；这与 Windows runner 的安装验收分别记录。
- 五个公开下载地址的 HEAD 请求均返回 HTTP 200。下载的 `SHA256SUMS` 和 `desktop-build.json` 与 GitHub 记录的 SHA-256 相符；两份文件中的三个安装包摘要与 GitHub 安装包摘要相符。发布后未重新下载完整安装包。
- 发布版不是草稿，属于预览版。稳定版 latest 仍为 `v0.3.4`；此桌面标签未触发 npm 发布工作流。

安装包未签名，macOS DMG 未公证。Windows CI 尚未验证真实提供商登录或调用、Windows ARM64、SmartScreen 接受情况及所有目标机器。macOS CI 和本机 arm64 smoke 也不等于所有 Mac 硬件的安装验收。Preview 2 仍提供 macOS ZIP。参见 [Windows 安装说明](../../../apps/desktop/INSTALL-WINDOWS.zh-CN.md)与 [macOS 安装说明](../../../apps/desktop/INSTALL.zh-CN.md)。
