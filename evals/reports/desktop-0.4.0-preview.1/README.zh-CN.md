# Desktop 0.4.0 Preview 1 发布证据

[English](README.md) · [发布说明](../../../.github/release-notes/desktop-0.4.0-preview.1.md)

## 范围与状态

维护者于 2026-09-30 授权发布 `desktop-0.4.0-preview.1`，提供未签名的
Windows x64 和 macOS arm64/x64 安装包。候选版将桌面包更新到 0.4.0，内置
Forge 0.4.0 共享运行层与当前中英文产品帮助。Telegram 仍为实验性 CLI 前台网关；
Desktop 没有新增网关设置页或后台服务。

公开发布和准确源码 CI 尚待完成。本候选记录本身不能证明已发布或检查通过。
各阶段完成后补充结果。不可变发布标签必须指向发布 CI 验证的同一源码提交。
本次未要求合并 main。

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
