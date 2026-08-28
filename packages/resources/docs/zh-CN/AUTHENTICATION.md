# 认证模型

English · 中文目录

## 状态

Forge 支持通过 `DEEPSEEK_API_KEY` 和 `OPENAI_API_KEY` 使用 DeepSeek/OpenAI API key，也支持通过官方 Codex App Server 使用 ChatGPT 订阅。用户配置的 provider route 还可以使用明确选择的 bearer credential，或对本地/self-hosted endpoint 不使用认证。Forge 展示登录命令和 browser/device-code 指引；Codex 负责 OAuth、凭据持久化、刷新和撤销。

| 方法 | 用途 | 状态 |
| --- | --- | --- |
| DeepSeek API key | 本地开发和自动化 | 已实现 |
| OpenAI API key | 按用量计费的 OpenAI API | 已实现 |
| Provider route bearer key | OpenAI-compatible gateway | 已实现 |
| 无认证 provider route | 本地 Ollama/vLLM 风格 server | 已实现 |
| Sign in with ChatGPT | 通过 Codex App Server 使用 OpenAI 订阅 | 已实现 |
| Codex access token | 受信任企业自动化 | 延后 |

DeepSeek 的官方 endpoint 是 `https://api.deepseek.com`，初始 adapter 使用官方 AI SDK provider package。模型 ID 保持可配置，因为 provider 的模型生命周期与 Forge release 不同。参考：[DeepSeek API model documentation](https://api-docs.deepseek.com/quick_start/pricing/)、[AI SDK DeepSeek provider](https://ai-sdk.dev/providers/ai-sdk-providers/deepseek)。OpenAI 的产品集成使用公开的 [Codex App Server](https://developers.openai.com/codex/app-server)，不复制其他应用的 OAuth client identity，也不把未公开的 ChatGPT endpoint 当作稳定合约。

## 架构边界

```text
Forge Engine: Forge Runtime -> Model Adapter -> DeepSeek 或 OpenAI API

Codex Engine: Forge CLI -> Codex App Server -> ChatGPT 订阅
```

Codex Engine 不是 Forge `ModelAdapter` 的包装：App Server 自己拥有完整 agent runtime、turn、tools、sandbox、审批和 history。Provider-neutral authentication manager 会先读取显式环境变量，再读取 Forge 的用户级 owner-only credential store，最后把 key 交给选定 adapter。缺失凭据时给出可操作错误，但不打印 key 或 stack trace。凭据不会复制到 Forge 配置、prompt、trace、plugin event 或仓库文件。

## OpenAI-compatible provider route

Route 只能在 `$FORGE_HOME/config.json` 的 `providers` 中声明；仓库 `.forge/config.json` 不得决定凭据发送到哪里。

```json
{
  "schemaVersion": 1,
  "providers": {
    "my-gateway": {
      "api": "openai-responses",
      "baseUrl": "https://gateway.example/openai/v1",
      "auth": { "type": "bearer", "apiKeyEnv": "GATEWAY_API_KEY" },
      "models": [
        {
          "id": "reasoning-model",
          "contextWindow": 128000,
          "maxOutputTokens": 8192,
          "reasoningGears": { "none": "none", "high": "high" }
        }
      ]
    }
  }
}
```

`auth.type` 必填。`bearer` 读取声明的环境变量，或先推导 `FORGE_<ROUTE>_API_KEY`，再查 Forge 保存的 credential；`none` 不读取也不发送 key。保存的 route credential 与规范 `baseUrl` 绑定，endpoint 变化后旧 key 会被拒绝，直到重新保存。

远程 endpoint 要求 HTTPS；只有 loopback host 允许普通 HTTP。包含 credential、query 或 fragment 的 URL 会被拒绝。模型发现不跟随 redirect，限制为 4 MiB 和 15 秒，并且是可选的，因为用户可以手动填写 model ID。

省略 reasoning 设置表示 **provider default**，不等于禁用 reasoning。每个 `reasoningGears` 将 Forge UI 等级映射为发给 provider 的精确 wire value；如果 endpoint 支持关闭 reasoning，必须显式写出 `"none": "none"`。缺失 capability metadata 时 Forge 报告 unknown，保留 provider default，不猜测，也不发起付费探测请求。

OpenAI API key 与 ChatGPT 订阅独立计费。只有订阅的用户不需要创建或导出 `OPENAI_API_KEY`，可以继续使用 `model.provider = "deepseek"` 或 `forge codex`。

## 兼容性要求

- 使用公开记录的 App Server 产品集成流程。
- Forge 不提供或复制 OAuth client identity。
- 由 Codex 执行 token exchange、refresh、revoke 和 account selection。
- 面向用户的文案明确区分订阅访问和按用量计费的 API。

Forge 不得复制其他应用的 client secret、把逆向 endpoint 当永久 API、要求用户在聊天中粘贴 token、直接读取或修改 `~/.codex/auth.json`，或把 credential 存入当前仓库。

## 凭据存储

交互式 `/login` 可以把 API key 保存到 `$FORGE_HOME/auth.json`。目录权限为 `0700`，文件为 `0600`，更新是原子的，环境变量优先。这是受文件权限保护的明文 fallback，不是 OS keychain；ChatGPT 订阅 credential 完全由 Codex App Server 所有。`/logout` 会移除选择的 Forge credential，或请求 Codex 注销 ChatGPT 订阅。移除第三方 route 是单独的确认操作，会删除 route、models 和保存的 credential；无法替父 shell 取消环境变量。

当前 runtime 查找顺序是：provider 的显式/约定环境变量；项目外、仅 owner 可读的 `$FORGE_HOME/auth.json`。OS credential store 比明文 file storage 更理想，但目前仍是后续改进；自动化推荐使用环境变量注入。凭据不得进入 prompt、run event、JSONL trace、plugin event、telemetry 或普通错误信息。

## 刷新与并发

Codex App Server 负责订阅 token 刷新和持久化，Forge 永远不接收 OAuth access/refresh token。凭据更新必须原子完成；刷新失败不能在错误处理前破坏最后一个已知凭据。OAuth refresh 应 single-flight，避免并发请求竞争同一个 refresh token。

## 命令

```text
forge auth login openai
forge auth status openai
forge auth status openai-api
forge auth logout openai
forge models list --provider openai
forge codex "Inspect this repository" --model <id> --reasoning-effort <effort>
forge run "Inspect this repository" --provider openai --model gpt-5.4-mini --reasoning-effort low
```

无头环境使用 `forge auth login openai --method device-code`。Forge 展示官方 verification URL 和 code，并等待 App Server 完成通知；browser callback 校验和 PKCE 由 Codex 负责。`forge auth status openai-api` 会报告当前生效的是环境 credential 还是已保存 credential，但不发起付费验证请求；`forge auth login openai-api` 会引导用户使用带掩码的交互 `/login` 或 `OPENAI_API_KEY`，普通子命令不会从命令参数读取 secret。

`/model` 会发现当前 Codex catalog，并展示不按 reasoning effort 重复的 native API models。独立的 `/effort` 和 Shift+Tab 使用当前模型支持的等级。普通 engine/provider/model/reasoning 设置保存到 `$FORGE_HOME/config.json`；credential 则独立存在环境变量、`$FORGE_HOME/auth.json` 或 Codex-owned storage。选择 ChatGPT 条目后，后续交互 prompt 通过 Codex Engine 路由。
