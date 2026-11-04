# CLI/npm 0.5.0-preview.1 发布证据

[English](README.md) · [报告索引](../README.md)

2026-11-04 从功能提交 21babed 准备。发布仍等待不可变标签 CI 及公开文件独立验证，具体检查、真实模型范围、保留的失败尝试与限制见[英文完整记录](README.md)。

功能源码本地检查：899 项测试通过、6 项显式 live 测试跳过；223 项确定性检查通过；类型/文档/打包安装检查通过。这不是标签发布或安装版验收结果。

macOS 开发 Electron 的真实 DeepSeek 和 Luna 流程已验证会话隔离、排队取消和历史恢复，Codex 仅使用 gpt-6-luna / low；有明确 interrupted 通知和另一任务独立完成。Codex TUI 与多轮恢复未做真实模型验证。安装包未签名、macOS 未公证，跨平台实机和长期负载验收仍有缺口。
