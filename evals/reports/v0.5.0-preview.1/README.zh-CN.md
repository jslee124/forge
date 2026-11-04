# CLI/npm 0.5.0-preview.1 发布证据

[English](README.md) · [报告索引](../README.md)

2026-11-04 从功能提交 21babed 准备。不可变标签 CI 及公开文件独立验证已完成，具体检查、真实模型范围、保留的失败尝试与限制见[英文完整记录](README.md)。

功能源码本地检查：899 项测试通过、6 项显式 live 测试跳过；223 项确定性检查通过；类型/文档/打包安装检查通过。这不是标签发布或安装版验收结果。

macOS 开发 Electron 的真实 DeepSeek 和 Luna 流程已验证会话隔离、排队取消和历史恢复，Codex 仅使用 gpt-6-luna / low；有明确 interrupted 通知和另一任务独立完成。Codex TUI 与多轮恢复未做真实模型验证。安装包未签名、macOS 未公证，跨平台实机和长期负载验收仍有缺口。

## 公开发布验证（2026-11-04）

npm 可信发布流程、CLI 标签 CI 与准确源码的 main CI 均通过。npm next 指向 0.5.0-preview.1，latest 保留 0.4.0；GitHub 稳定 Latest 保留 v0.4.0。从公开仓库干净安装后，版本、帮助和配置校验通过，安装完整性与 registry 一致。provenance 内容与源码及包摘要匹配，未独立验证其签名。首次查询因 registry 处理延迟短暂返回 404，后续安装验证通过。

完整元数据和已验证边界见 [PUBLICATION.json](PUBLICATION.json) 与[英文记录](README.md#published-artifact-verification-2026-11-04)。
