# Forge v0.3.4 发布说明

[English](RELEASE_NOTES.md) · [Milestone 15 release gates](M15_RELEASE_GATES.zh-CN.md)

Forge v0.3.4 统一模型侧文件编辑、明确 context mode 的控制权，并修复 interactive
terminal lifecycle cleanup。

## 用户可见变化

- 新请求只提供一个 `edit_file` 工具，覆盖 create、patch 与 rewrite；content hash
  防止基于过期读取的编辑覆盖用户并发修改。
- 旧 v0.3.3 session 仍可读取，包括历史 `create_file` 和 `apply_patch` exchange，
  但新任务不会再向模型广告这些 legacy tool。
- Context mode 统一命名为 Manual 和 Automatic。Manual 是永久默认值，会在压缩前
  询问；Automatic 只能由用户为当前 session 显式选择或保存为 user default。
- 旧 `warn`/`compact` 配置在加载时规范化为 `manual`/`automatic`；下次保存只写
  canonical name，且不会覆盖无关设置。
- Interactive CLI 保持原 facade 和控制方式，内部按 ownership 拆分；反复 render、
  exit 与 resume 不再增长 terminal listener。

## 兼容与安全

Create 不覆盖，rewrite 不创建，所有 write 继续经过正常 policy 与 approval。
Resume 只恢复已完成历史对话，不恢复 approval、待执行 action、provider continuation
或 trust authority。

升级不会自动启用 Automatic compaction。需要该行为的用户可为当前 session 选择
Automatic，或显式保存为 user default。

## 验证边界

经过审查的 [Milestone 15 gate 报告](M15_RELEASE_GATES.zh-CN.md)记录 clean
implementation candidate、deterministic matrix、package install check 与用户执行的
真实 Ghostty smoke。另行授权的 DeepSeek trial 仍是开发证据，不能证明
exact-release-commit 模型质量。发布状态由 immutable tag workflow 与公网 npm
安装另行验证。
