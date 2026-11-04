# Desktop 0.5.0-preview.1 发布证据

[English](README.md) · [报告索引](../README.md)

2026-11-04 从功能提交 21babed 准备。不可变标签 CI 及公开文件独立验证已完成，具体检查、真实模型范围、保留的失败尝试与限制见[英文完整记录](README.md)。

功能源码本地检查：899 项测试通过、6 项显式 live 测试跳过；223 项确定性检查通过；类型/文档/打包安装检查通过。这不是标签发布或安装版验收结果。

macOS 开发 Electron 的真实 DeepSeek 和 Luna 流程已验证会话隔离、排队取消和历史恢复，Codex 仅使用 gpt-6-luna / low；有明确 interrupted 通知和另一任务独立完成。Codex TUI 与多轮恢复未做真实模型验证。安装包未签名、macOS 未公证，跨平台实机和长期负载验收仍有缺口。

## 公开发布验证（2026-11-04）

桌面标签 CI 的 5 个作业全部通过，包括 Windows x64 打包、启动及 NSIS 安装/启动/卸载，macOS arm64/x64 打包与 host smoke，以及上传校验后公开发布。5 个公开文件已重新下载，大小、SHA-256、GitHub digest、版本清单和发布说明一致。实际公开元数据能被更新候选解析器识别。arm64 DMG 已只读挂载、复制到隔离目录并成功启动（退出码 0），嵌入身份为 0.5.0-preview.1。没有替换本机安装，也没有模型请求；这不证明 Gatekeeper、公证或签名验收。

完整元数据和已验证边界见 [PUBLICATION.json](PUBLICATION.json) 与[英文记录](README.md#published-artifact-verification-2026-11-04)。
