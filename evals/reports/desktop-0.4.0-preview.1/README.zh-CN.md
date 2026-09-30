# Desktop 0.4.0 Preview 1 发布证据

[English](README.md) · [发布说明](../../../.github/release-notes/desktop-0.4.0-preview.1.md)

## 范围与状态

维护者于 2026-09-30 授权发布 `desktop-0.4.0-preview.1`，提供未签名的
Windows x64 和 macOS arm64/x64 安装包。候选版将桌面包更新到 0.4.0，内置
Forge 0.4.0 共享运行层与当前中英文产品帮助。Telegram 仍为实验性 CLI 前台网关；
Desktop 没有新增网关设置页或后台服务。

已于 2026-09-30 公开发布 GitHub 预览版：
[0.4.0 Preview 1](https://github.com/jslee124/forge/releases/tag/desktop-0.4.0-preview.1)。
注释标签与发布触发提交均解析到 `cf9ebf26b07795d13458fec92698e64bcf8395ff`。
[发布 CI](https://github.com/jslee124/forge/actions/runs/36669286127) 验证并打包了
同一源码。另见[机器可读记录](release.json)。源码与证据位于 `dev`；本次未要求合并 main。

## 发布与公开核验

- 发布 CI 五个任务全部通过：Ubuntu 源码／完整测试／确定性评估／npm 安装验证、
  Windows 网关合约、Windows x64 打包与打包应用启动及 NSIS 安装／启动／卸载、
  macOS arm64/x64 打包与打包应用启动、发布组装／上传核验／公开。
- 组装过程按平台清单核对三个安装包的 SHA-256；公开前核对五个上传文件的名称、
  大小和摘要。
- 公开下载 `SHA256SUMS` 和 `desktop-build.json` 成功，计算出的摘要与 GitHub
  元数据一致；三个安装包摘要与两个公开清单及 GitHub 元数据一致。三个安装包的
  公开 HEAD 请求均返回 HTTP 200，内容长度符合预期。发布后未重新下载完整安装包，
  本项不代表公开下载包的安装验收。
- 发布说明与标签源码一致。当前版本选择器用公开元数据执行，确认 Preview 4 可选中
  macOS arm64/x64、Windows x64 的新版安装包；稳定通道排除预览版，当前版本不会
  重复推荐自己。这是选择器验证，不代表更新界面的端到端验收。
- GitHub Latest 稳定版仍为 `v0.4.0`；桌面预览发布没有发布新的 npm 版本。
  本次 Release 已公开，标记为 prerelease，非草稿。

## 必需检查

- 本地源码／文档检查、完整测试、确定性评估、打包产品资源与 npm 安装检查、空白检查。
- Native 与 Codex 桌面入口测试：共享工作区被占用时拒绝执行，释放后可运行，任务结束后释放占用。
- 准确源码 CI：Ubuntu 验证、Windows 网关合约、Windows 打包应用启动与
  NSIS 安装／启动／卸载、macOS arm64/x64 打包与打包应用启动。
- 按平台 SHA-256 清单核对安装包；公开草稿前核对上传文件名称、大小和摘要。
- 发布后独立验证公开清单和安装包 URL。

## 本地候选检查 — 2026-09-30

- `CI=true pnpm check` 通过，保留 4 项既有警告和 19 项信息提示。
- `CI=true pnpm check:docs` 与 `git diff --check` 通过。
- 完整测试：81 个文件通过、4 个跳过；545 项测试通过、6 项跳过。
- 确定性发布评估：13 个文件、71 项测试通过。
- `CI=true pnpm package:verify` 通过临时目录内 0.4.0 npm 全新安装验证。
- 桌面生产构建通过，身份为 `FORGE_DESKTOP_BUILD_TAG=desktop-0.4.0-preview.1`。
- 本地未签名 macOS arm64 目录打包与打包应用启动检查通过，使用隔离 `FORGE_HOME` 在执行沙箱外运行。第一次沙箱内启动被信号终止，未输出应用诊断，不计为通过；本项不代表公开下载 DMG 的安装验收。
- 以上为本地候选检查，不代表远程 CI、公开下载或真实模型证据。

## 限制

安装包未签名，macOS DMG 未公证。离线 mock provider 测试和 CI smoke 不能证明
真实模型登录／调用、全部网络路径、Windows ARM64、SmartScreen、下载文件的
Gatekeeper／quarantine 验收、Intel 实机、macOS 13、原生窗口控制或所有设备的
安装验收。[v0.4.0](../v0.4.0/RELEASE_VERIFICATION.md) 保留的 Telegram 实测是独立
CLI 证据，不能证明 Desktop 支持网关。工作区租约只协调配合的任务，不阻止手工
编辑或其他应用修改文件。
