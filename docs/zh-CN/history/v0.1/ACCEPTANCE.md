# v0.1 验收与评测

[English](../../../history/v0.1/ACCEPTANCE.md) · [中文目录](../../README.md)

> **文档角色：历史记录。** 这是不可变的 v0.1 验收合约，不是当前产品或
> release contract。

## 状态

这是 Forge v0.1 的具体 release contract。产品和架构文档描述方向；本文定义声明“第一个版本可用”所需的证据。

## 范围

v0.1 证明一个狭窄能力：给定一个小型 TypeScript 仓库任务，检查相关代码，完成定向 workspace 修改，运行获批的验证命令，根据实际结果作出反应，并以真实状态和 trace 停止。默认测试使用脚本化 fake model，不需要 API key 或付费请求。

## 两条证据轨道

确定性 runtime 证据使用脚本化 `ModelAdapter`，验证状态转换、策略、工具执行、失败恢复、取消、限制和 trace 一致性。Live provider 证据是 opt-in 的，使用 `deepseek-v4-flash` 测量完整系统解决仓库任务的能力；失败必须作为数据保留，不能改写为成功。

## 规范 fixture：`validation-bug`

```text
fixtures/validation-bug/
|-- package.json
|-- src/
|   |-- parse-port.ts
|   `-- server-config.ts
`-- test/
    `-- parse-port.test.ts
```

缺陷是 `parsePort` 使用宽松解析，接受类似 `"3000abc"` 的非法值。任务要求只接受 1 到 65535 的十进制整数字符串，拒绝空值、空白、符号、小数、指数、尾随字符、0 和超上限值，同时保持 public API、必要时更新测试，并在结束前运行仓库测试。

有效示例包括 `"1"`、`"3000"`、`"65535"`；无效示例包括 `""`、`"  "`、`"+80"`、`"-1"`、`"1.5"`、`"1e3"`、`"3000abc"`、`"0"` 和 `"65536"`。Agent 至少读取实现、调用方和相关测试；写入必须留在临时 fixture workspace；获批验证命令是从 fixture 根目录运行 `pnpm test`；最终总结必须匹配真实 diff 和结果。

## 确定性恢复场景

脚本化 adapter 必须依次：读取实现和测试；应用不完整补丁；运行验证并观察非零退出；根据输出应用修复补丁；再次验证成功；给出与两次尝试一致的总结。若 Forge 在第一次失败后停止、隐藏失败、跳过策略或提前报告成功，测试失败。

## 初始限制

| 限制 | 默认值 |
| --- | --- |
| 模型步骤 | `12` |
| 工具调用 | `40` |
| 进程超时 | `60000` ms |
| 每个工具结果保留的输出 | `65536` bytes |
| 内置文件访问 | 仅选定 workspace |

达到限制会产生 `limit_reached` 和退出码 `3`，不算成功。

## 评测审批

交互运行使用正常审批 UI。非交互 fixture 试验可以注入只匹配以下内容的测试审批：`program: pnpm`、`arguments: ["test"]`、规范 fixture root、超时 `60000` ms。其他命令必须有单独声明的审批；该审批不能授权 fixture 外文件或更宽 permission profile。

## 记录指标

每次 live trial 记录 Forge commit、fixture/task 版本、provider 和精确 model ID、thinking 设置、终止状态和退出码、grader 结果、耗时、按工具名称统计的步骤和调用、provider 返回的 token 用量、失败验证次数、被拒操作和触达限制。只有同时记录价格快照和获取日期时才能推导成本；运行时不应内置会变化的价格。

## v0.1 release gate

- [x] 单元、集成、策略和确定性恢复测试通过。
- [x] 规范 fixture 通过公开及隐藏 grader。
- [x] 至少记录三次新的 live 规范试验，且至少两次端到端通过。
- [x] 另外两个 fixture 任务也完成测量和报告，即使通过率更低。
- [x] 每个报告运行都有与工具和命令结果一致的可解析 trace。
- [x] 完成的交互 session 可跨重启按 ID 和 `--last` 继续，且不恢复旧审批。
- [x] trace、终端输出、fixture diff 和报告都不包含 API key。
- [x] workspace 外文件尝试和未审批进程命令会被拒绝。
- [x] 交互 CLI 对多行输入、斜杠命令、文件引用和精确 diff 审查有确定性测试。
- [x] README 的安装、演示、结果、限制和许可证与 tag 一致。

报告必须包含失败。低分是需要改进的工程结果，不是删除失败试验的理由。

## 明确的非目标

本文不声称 Forge 具备通用 coding-task 能力、等同 OS sandbox 的保护、任意 shell 语法的安全执行、workspace 外文件访问、多 provider、多 Agent、插件、RAG、持久记忆，或 live model 的确定性行为。
