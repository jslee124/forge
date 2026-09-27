# Desktop 0.3.4 Preview 4 发布候选记录

截至 2026-09-27，状态为**本地已准备，尚未发布**。本记录针对 `dev` 提交 `6371281` 加上 Preview 4 准备改动的候选源码，不代表公开发布或跨平台验收。[English](README.md)。

## 本地验证

- 准备改动及安装验收脚本修复后，`CI=true pnpm check` 通过；Biome 保留已有的 4 条警告和 18 条提示。
- `CI=true pnpm check:docs` 通过，检查了 212 个 Markdown 文件和 830 个本地引用。
- 独立的 CLI npm 包验证 `CI=true pnpm package:verify` 通过；`CI=true pnpm eval:deterministic` 的 13 个测试文件、71 个测试通过。
- `CI=true FORGE_DESKTOP_BUILD_TAG=desktop-0.3.4-preview.4 pnpm desktop:package` 在本机生成未签名的 arm64/x64 DMG 和 ZIP。`release-contract.mjs` 记录完整预览版身份及四个产物摘要；`shasum -a 256 -c SHA256SUMS` 核对四个文件通过。
- 本机 arm64 打包应用启动测试通过。首次安装验收发现新版工作台面板默认关闭；验收脚本现通过界面选择已恢复任务，再打开文件。重新打包后，arm64 DMG 通过临时安装、LaunchServices 启动、Agent 退出、PDF 预览和隔离配置目录检查。候选版的[安装验收结果](local-macos-arm64/installed.json)与 [PDF 截图](local-macos-arm64/installed-pdf.png)独立保存，未覆盖旧版 D13 证据。
- 候选分支的 [CI](https://github.com/jslee124/forge/actions/runs/36297371802) 已通过 Ubuntu 验证及 Windows x64 打包、打包应用启动和 NSIS 安装／启动／卸载检查。该运行使用 CI 构建身份，macOS 预览版及发布任务按条件跳过。

## 公开发布前仍需完成

- 从 Preview 4 最终标签重新运行 Windows x64 检查，使安装包写入正式预览版身份，并与候选 CI 产物比较。
- 从最终标签在 CI 运行 macOS 打包与启动检查；汇总双平台产物，核对 SHA-256 及 GitHub 远端产物大小／摘要，再公开预览版。
- Preview 4 公开后，将当前中英文 Desktop 与安装指南中的当前版本更新为 Preview 4。在此之前，这些指南继续准确指向已发布的 Preview 3。

候选包未签名，macOS DMG 未公证。本机 arm64 验收不能证明 Intel 实机、macOS 13、下载文件的隔离标记与 Gatekeeper 表现、原生红绿灯点击区域、系统全屏或真实模型调用。Windows ARM64 与已签名 Windows 安装包不在本预览版范围内。
