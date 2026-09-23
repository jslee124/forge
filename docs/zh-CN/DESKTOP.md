# Forge Desktop 预览版

[English](../DESKTOP.md) · [中文目录](README.md)

截至 2026-09-23，[Desktop 0.3.4 Preview 3](https://github.com/jslee124/forge/releases/tag/desktop-0.3.4-preview.3)
提供 Windows x64 安装包和 macOS arm64/x64 DMG。桌面版与 `@jslee124/forge`
npm CLI 分开发行。Preview 3 安装包均未签名，macOS DMG 也未公证；安装和替换需手动完成。
配置、认证与更新步骤见 [Windows 安装指南](https://github.com/jslee124/forge/blob/dev/apps/desktop/INSTALL-WINDOWS.zh-CN.md)
或 [macOS 安装指南](https://github.com/jslee124/forge/blob/dev/apps/desktop/INSTALL.zh-CN.md)。
较早的 [Preview 2](https://github.com/jslee124/forge/releases/tag/desktop-0.3.4-preview.2)
仍提供 macOS ZIP。

## 预览版支持的能力

- 在同一个工作台完成代码任务、工作区内文件与文档预览，以及附来源的研究报告；
  文件访问受所选工作区约束。
- Native Forge 与 Codex 是独立的执行引擎，各自认证、各自报告可用状态，
  应用不会静默切换引擎。
- 保存与恢复任务、检查文件变更、审批、取消，以及中英文深浅色界面。
  部分管理命令的桌面行为比 CLI 窄，应用内会显示可用状态。
- 后台检查更新；用户主动下载并经 SHA-256 校验后打开安装包。
  打开 DMG 或 EXE 不会自动替换正在运行的应用。

## 验证边界

[Preview 3 CI](https://github.com/jslee124/forge/actions/runs/35825140016)
在 Windows runner 上构建安装包，并执行打包应用与安装后 smoke。这些离线检查
不能证明 Windows 真实模型登录、所有网络路径、Windows ARM64 或已签名安装的验收。
[Preview 3 发布记录](../../evals/reports/desktop-0.3.4-preview.3/README.zh-CN.md)
分别记录源代码 CI、发布 CI、公开下载检查和剩余限制。
[Preview 2 发布记录](https://github.com/jslee124/forge/blob/main/evals/reports/desktop-0.3.4-preview.2/README.zh-CN.md)
保留此前的 macOS 验证边界，包括真实未认证 GitHub 更新 API、Intel 硬件、
macOS 13、VoiceOver 和签名/公证安装。
命令和无障碍限制见[桌面 QA 记录](https://github.com/jslee124/forge/blob/main/apps/desktop/design-qa.md)。

原[桌面实施合同](history/desktop-0.3.4-preview.2/DESKTOP_APP_PLAN.md)、
[D01—D13 清单](history/desktop-0.3.4-preview.2/DESKTOP_APP_TASKS.md)与
[D01 基线](history/desktop-0.3.4-preview.2/DESKTOP_BASELINE.md)为历史记录。
当前行为以源码、测试及上述验收证据为准。
