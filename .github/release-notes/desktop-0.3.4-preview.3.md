# Forge Desktop 0.3.4 Preview 3

Windows x64 preview with an NSIS installer. This release also includes macOS arm64/x64 DMG builds so existing Mac preview users can continue to receive compatible update checks. Desktop builds are separate from the Forge npm CLI.

## Install / 安装

- Windows: download `forge-desktop-0.3.4-x64.exe` and `SHA256SUMS` from this release. In PowerShell, run `Get-FileHash .\forge-desktop-0.3.4-x64.exe -Algorithm SHA256` and compare the result with the installer line in `SHA256SUMS` before running it.
- macOS: choose the arm64 or x64 DMG for your machine and compare it with `SHA256SUMS`.
- Windows 安装包未签名，Windows 可能显示安全提示。请核对发布来源与 SHA-256 后再决定是否安装。更新前先保存工作并退出旧版应用。macOS 安装包同样未签名、未公证。

## Validation / 验证

The release tag passed Ubuntu repository checks and Windows CI. Windows CI built the NSIS x64 installer, ran targeted offline tests, started the packaged application, then silently installed, started, and uninstalled it. macOS arm64/x64 DMGs were built locally and in CI; the arm64 unpacked application passed smoke. Release assets and checksums were verified before publication.

This preview does not establish real provider login or calls on Windows, Windows ARM64 support, code signing or SmartScreen acceptance, or installed-app acceptance on every supported machine. The app checks for updates and opens a verified installer; it does not automatically replace a running installation.
