# Desktop 0.3.4 Preview 4 发布证据

已于 2026-09-27 作为公开 GitHub 预览版发布：[Preview 4](https://github.com/jslee124/forge/releases/tag/desktop-0.3.4-preview.4)。另见[机器可读记录](release.json)和 [English](README.md)。

- 注释标签解析到 `34e6d60a9038ca5a539dd3581358b445548acf53`，即 [Preview 4 PR](https://github.com/jslee124/forge/pull/7) 在 `dev` 上的合并提交。发布触发提交为 `e01b362391da780845fdd28751b4f6c778ed8d71`；Windows 与 macOS 打包均检出该标签。
- [候选 PR CI](https://github.com/jslee124/forge/actions/runs/36298516298) 使用 CI 构建身份，通过 Ubuntu 验证、Windows x64 打包、打包应用启动和 NSIS 安装／启动／卸载。[发布 CI](https://github.com/jslee124/forge/actions/runs/36298823728) 四个任务全部通过：从标签重新构建 Windows x64 安装包与 macOS arm64/x64 DMG，执行双平台打包应用启动检查和 Windows NSIS 安装／启动／卸载，按平台清单核对 SHA-256，按大小与摘要核对 GitHub 上的五个产物，然后公开预览版。
- 公开下载 `SHA256SUMS` 与 `desktop-build.json` 成功；本地计算的摘要与 GitHub 产物摘要相同，三个安装包条目也与两个清单及 GitHub 摘要一致。三个公开安装包地址的 HEAD 请求均返回 HTTP 200。发布后未重新下载完整安装包。
- 打标签前，本地 `CI=true pnpm check`、`CI=true pnpm check:docs`、`CI=true pnpm package:verify` 和 `CI=true pnpm eval:deterministic` 通过；确定性评估为 13 个测试文件、71 个测试。未签名 macOS arm64/x64 本机构建的四个产物通过本地摘要检查。候选版 arm64 打包应用启动及 DMG 临时安装验收通过；[安装验收结果](local-macos-arm64/installed.json)和 [PDF 截图](local-macos-arm64/installed-pdf.png)独立保留，没有覆盖旧版 D13 证据。该本地安装验收早于最终仅改文档的标签提交，不代表对公开下载包的安装验收。
- 本次为公开预览版，不是草稿。最新稳定版仍为 `v0.3.4`；`desktop-*` 标签没有发布新的 npm CLI 版本。

安装包未签名，macOS DMG 未公证。现有检查不能证明真实模型登录或调用、全部网络路径、Windows ARM64、SmartScreen 放行、Intel 实机、macOS 13、下载文件的隔离标记与 Gatekeeper 表现、macOS 原生红绿灯点击区域、系统全屏或所有目标设备上的安装验收。参见 [Windows](../../../apps/desktop/INSTALL-WINDOWS.zh-CN.md)和 [macOS](../../../apps/desktop/INSTALL.zh-CN.md) 安装指南。
