# 持久化会话与运行 Trace

English · 中文目录

## 目标

Forge 持久化足够的可信 metadata 和已完成对话历史，使交互式聊天可以在进程退出后继续。它不会尝试重放进行中的工具调用。

```text
Session
|-- 已完成的 user/assistant 轮次
|-- 已完成 assistant 轮次的 provider reasoning summary
|-- 可选的派生 context checkpoint
|-- workspace 与 working-directory metadata
`-- Run 1 -> events.jsonl
    Run 2 -> events.jsonl
```

Session 是用户选择的对话；run 是一次有边界的 agent-loop 调用。恢复 session 会在该 session 内创建新的 run。

## 存储布局

```text
$FORGE_HOME/
|-- sessions/
|   `-- <session-id>.json
`-- runs/
    `-- <run-id>.jsonl
```

Session snapshot 使用 `schemaVersion: 2`，读取时迁移 v1；trace envelope 使用 `schemaVersion: 1`。文件只能写入解析后的 Forge home。snapshot 原子替换，活跃 run 的 trace 追加写入。

每个 session 保存 session ID、创建和更新时间、规范 workspace root、工作目录、已完成对话、provider 暴露的 reasoning 文本、run ID 顺序，以及可选的带来源和 hash 的 checkpoint。每行 trace 包含 run ID、可选 session ID、序号、时间戳和一个结构化 `RunEvent`。Subagent trace envelope 还包含 `parentRunId` 和 `subagentName`，parent trace 则通过完成的 delegation tool result 反向关联 child run。

## 恢复行为

```bash
forge resume <session-id>
forge resume --last
```

交互式 `/resume` 只展示当前规范 workspace 的有界 session 列表。恢复规则如下：

1. 只恢复已完成的 user/assistant 轮次和 provider 实际提供的 reasoning，且仅用于展示。
2. 新 prompt 总是以新的 run ID 开始新的有界运行。
3. 重新加载当前配置和 `AGENTS.md` 指令。
4. 每次恢复都创建新的审批状态，并在加载历史前清除内存 session grant。
5. 不恢复 provider continuation、部分完成的工具调用或子进程。
6. 其他 workspace 的 session 会被拒绝。
7. 缺失或无效 snapshot 在发起模型请求前以可操作的配置错误结束。
8. 有效 checkpoint 恢复同一个有界 active view；过期 checkpoint 被忽略，不改变规范 transcript。

因此，Forge 恢复的是 conversation context，而不是 authority 或 executable state。保存的 reasoning 仅用于展示，不会加入模型历史；Forge 只保存 provider 实际发出的 summary，不会声称拥有隐藏 chain of thought。

## Inspect 行为

`forge inspect <run-id>` 读取并校验对应 JSONL trace，然后展示事件时间线、耗时、模型步骤、工具调用、token 用量、上下文预算分类、保留/省略的消息、估算误差和终止状态。Inspect 不执行工具，也不联系 provider。

终端渲染和 trace 持久化消费同一组 `RunEvent`，所以 trace 是运行时路径的证据，而不是从终端字符串重新拼出的第二份日志。

## 脱敏与安全

持久化前会脱敏配置的 credential 值和已识别的 secret 字段；特别是 `DEEPSEEK_API_KEY` 绝不能出现在 snapshot 或 trace 中。Trace 仍可能包含仓库内容、diff、命令、模型文本和 provider reasoning，因此 `sessions/` 与 `runs/` 属于本地敏感数据，不应提交到仓库。

恢复不会削弱安全模型：旧审批不恢复；`/permissions` scope/use count 不写入 snapshot 或 checkpoint；旧 permission profile 不是授权；项目文件不能通过 workspace 工具修改 `FORGE_HOME` 下的 session metadata；列出或 inspect session 是只读操作且不会调用模型。

## 延后行为

当前不承诺恢复活跃模型流或工具调用、session 分支、跨机器同步、SQLite 索引、通过 retention 删除规范历史、跨 provider 复用 opaque checkpoint 或 trace 加密。
