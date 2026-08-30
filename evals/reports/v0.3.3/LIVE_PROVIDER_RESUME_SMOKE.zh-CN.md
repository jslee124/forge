# Forge v0.3.3 真实 Provider Resume Smoke

[English](LIVE_PROVIDER_RESUME_SMOKE.md)

证据日期：2026-08-30
候选基础 commit：`782de378716961c34bce630a90038d8a383612a9`

## 范围与安全边界

本 smoke 使用隔离的临时 Forge home/workspace、合成 token 文件、严格只读 prompt 和
有界模型配置。临时 Forge home 只在试验期间保存一份 credential file 副本。没有使用
OpenAI API key，也没有调用 OpenAI API。

仓库只记录下方结构化摘要，不保留原始 session、trace、credential、terminal recording
或合成 token。对生成的 DeepSeek session/trace 执行 credential pattern scan，匹配文件
数量为 0。

## DeepSeek Forge Engine

配置：

- Provider/model：DeepSeek `deepseek-v4-flash`
- Thinking：disabled；effort label：low
- 限制：3 个模型 step、3 个 tool call、4 KiB tool output
- Persistence：session schema v3，`historyFidelity: structured`

实际结果：

1. 新 interactive process 对临时 workspace token 提出并完成一次 `read_file`。
2. 第一轮 answer 返回准确 token。
3. 新的 `forge resume --last` process 恢复同一 session。
4. Resume prompt 明确禁止 tool use；第二个 run 没有 tool event，并从恢复 history 返回
   准确的先前 token。
5. 持久化 session 包含 2 个 run ID 和 6 条 canonical message：user、assistant tool
   call、配对 tool result、assistant answer、resumed user、resumed assistant answer。
   两个 run 均成功完成。

结果：**通过** native DeepSeek tool-call、persistence、配对 canonical history 和
cross-process resume。

## 通过 ChatGPT Subscription 的 Codex Engine

配置：

- Engine/model：Codex Engine `gpt-5.6-luna`
- Reasoning effort：low
- Authentication：现有 ChatGPT subscription
- OpenAI API：未使用
- Persistence：session schema v3，`historyFidelity: structured`

实际结果：

1. 新 Codex Engine interactive process 通过 Codex-managed command activity 读取临时
   workspace token，并准确返回。
2. 新的 `forge resume --last` process 渲染出先前 user/assistant turn。
3. Resume wrapper 报告 2 条 retained canonical message、0 条 omitted message。
4. Resume prompt 禁止 file read 和 tool call；Luna 从恢复 conversation context 返回准确
   的先前 token。
5. 持久化 session 包含 2 个 run ID 和 4 条 canonical message；两轮均成功，第一轮的
   有界 reasoning summary 单独保留。

Codex-managed internal tool activity 不会表示成 Forge canonical tool call/result pair。
Forge 持久化 model-visible completed turn 与 reasoning summary，但不会恢复 Codex process
或 tool authority。

结果：**通过** Luna Codex Engine completed-turn persistence 与基于 ChatGPT
subscription 的 cross-process resume。

## 剩余真实验证边界

Native OpenAI API 没有测试，因为当前没有 OpenAI API key，且用户明确禁止该路径。
已配置的 OpenAI-compatible route 也没有调用。如果 stable release 声明包含 compatible
route 的真实行为，应在 tag 前另外取得授权并运行一次有界 smoke。
