# Forge Desktop 预览版

English · 中文目录

截至 2026-09-23，公开桌面版本为
[Desktop 0.3.4 Preview 2](https://github.com/jslee124/forge/releases/tag/desktop-0.3.4-preview.2)。
它是独立于 `@jslee124/forge` npm CLI 的 macOS 预览版。请按机器选择 arm64 或 x64
的 DMG/ZIP。应用未签名、未公证，安装和后续替换均需手动完成。配置、认证与更新步骤见
[桌面安装指南](https://github.com/jslee124/forge/blob/main/apps/desktop/INSTALL.zh-CN.md)。

## 预览版支持的能力

- 在同一个工作台完成代码任务、工作区内文件与文档预览，以及附来源的研究报告；
  文件访问受所选工作区约束。
- Native Forge 与 Codex 是独立的执行引擎，各自认证、各自报告可用状态，
  应用不会静默切换引擎。
- 保存与恢复任务、检查文件变更、审批、取消，以及中英文深浅色界面。
  部分管理命令的桌面行为比 CLI 窄，应用内会显示可用状态。
- 后台检查更新；用户主动下载并经 SHA-256 校验后打开安装包。
  打开 DMG 不会自动替换正在运行的应用。

## 验证边界

[Preview 2 发布记录](https://github.com/jslee124/forge/blob/main/evals/reports/desktop-0.3.4-preview.2/README.zh-CN.md)
记录发布、资产、校验和与测试范围。本地 Electron 和受控更新验收不能证明所有外部
provider 或网络路径。真实未认证 GitHub 更新 API 全流程、手动替换 Applications 中
的应用、Intel/Rosetta 运行、macOS 13 硬件、VoiceOver 与签名/公证安装仍未验证。
命令和无障碍限制见[桌面 QA 记录](https://github.com/jslee124/forge/blob/main/apps/desktop/design-qa.md)。

原桌面实施合同、
D01—D13 清单与
D01 基线为历史记录。
当前行为以源码、测试及上述验收证据为准。
