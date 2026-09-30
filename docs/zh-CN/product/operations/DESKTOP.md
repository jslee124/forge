# Forge Desktop 预览版

[English](../../../product/operations/DESKTOP.md) · [中文目录](../../README.md)

[Desktop 0.4.0 Preview 1](https://github.com/jslee124/forge/releases/tag/desktop-0.4.0-preview.1)
内置 Forge 0.4.0 共享运行层。桌面版与 `@jslee124/forge` npm CLI 分开发行；
升级 npm 不会更新已安装的桌面应用。发布面向 Windows x64 和 macOS arm64/x64。
安装包未签名，macOS DMG 未公证；安装和替换需手动完成。
配置、认证与更新步骤见 [Windows 安装指南](https://github.com/jslee124/forge/blob/dev/apps/desktop/INSTALL-WINDOWS.zh-CN.md)
或 [macOS 安装指南](https://github.com/jslee124/forge/blob/dev/apps/desktop/INSTALL.zh-CN.md)。
发布状态和已完成检查见
[0.4.0 Preview 1 发布记录](../../../../evals/reports/desktop-0.4.0-preview.1/README.zh-CN.md)。
较早的 [0.3.4 Preview 2](https://github.com/jslee124/forge/releases/tag/desktop-0.3.4-preview.2)
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

## 工作区协调与 Telegram

Native Forge 与 Codex 任务执行共用宿主机上的工作区租约，并与 Forge 0.4.0 CLI
及实验性 Telegram 网关协调。工作区被占用时，另一任务会被拒绝，直到活跃任务完成或
取消。旧桌面版本不参与这套协调；依赖该能力前需先更新。租约只协调任务执行，
不阻止手工编辑或其他应用修改文件。

Telegram 配置与前台网关运行仍通过 CLI 完成；Desktop 没有网关设置页或后台网关服务。
独立入口的使用方法见 [Telegram 教程](CHAT_CHANNELS.md)。

## 验证边界

[0.4.0 Preview 1 发布记录](../../../../evals/reports/desktop-0.4.0-preview.1/README.zh-CN.md)
分别记录候选检查、准确源码 CI、发布和公开下载验证。下方旧记录是对应构建的历史证据，
不能当作 0.4.0 Preview 1 的验收结果。

[Preview 4 候选版 CI](https://github.com/jslee124/forge/actions/runs/36298064888)
在 Windows runner 上构建安装包，并执行打包应用与安装后 smoke。这些离线检查
不能证明 Windows 真实模型登录、所有网络路径、Windows ARM64 或已签名安装的验收。
[Preview 4 发布记录](../../../../evals/reports/desktop-0.3.4-preview.4/README.zh-CN.md)
随流程完成情况分别记录源代码 CI、发布 CI、公开下载检查和剩余限制。
[Preview 3 发布记录](../../../../evals/reports/desktop-0.3.4-preview.3/README.zh-CN.md)
保留上一版的发布证据。
[Preview 2 发布记录](https://github.com/jslee124/forge/blob/main/evals/reports/desktop-0.3.4-preview.2/README.zh-CN.md)
保留此前的 macOS 验证边界，包括真实未认证 GitHub 更新 API、Intel 硬件、
macOS 13、VoiceOver 和签名/公证安装。
命令和无障碍限制见[桌面 QA 记录](https://github.com/jslee124/forge/blob/main/apps/desktop/design-qa.md)。

原[桌面实施合同](../../history/desktop-0.3.4-preview.2/DESKTOP_APP_PLAN.md)、
[D01—D13 清单](../../history/desktop-0.3.4-preview.2/DESKTOP_APP_TASKS.md)与
[D01 基线](../../history/desktop-0.3.4-preview.2/DESKTOP_BASELINE.md)为历史记录。
当前行为以源码、测试及上述验收证据为准。

## 桌面开发记录

以下记录描述进行中的桌面工作，不是已发布行为声明；当前行为仍以源码、测试和上述
发布证据为准。

| 记录 | 状态 |
| --- | --- |
| [工作台设计](../../../../apps/desktop/STUDIO_DESIGN.zh-CN.md) | 当前工作台的布局、主题与交互行为 |
| [工作台后续开发计划](../../../../apps/desktop/WORKBENCH_DEVELOPMENT_PLAN.zh-CN.md) | 有序任务、验收 gate 与当前进度 |
| [工作台 UX 规范](../../../../apps/desktop/WORKBENCH_UX_PLAN.zh-CN.md) | 拟定的布局与斜杠命令对齐度；尚未完全对齐 |
| [模型与工作台细化方案](../../../../apps/desktop/DESKTOP_REFINEMENT_PLAN.zh-CN.md) | 细化设计与本地实现记录 |
| [未签名更新方案](../../../../apps/desktop/UPDATE_PLAN.zh-CN.md) | U01–U04 更新流程，随 Preview 2 发布 |
| [桌面 QA 记录](../../../../apps/desktop/design-qa.md) | 命令级与无障碍限制 |
