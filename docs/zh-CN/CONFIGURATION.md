# 配置参考

[English](../CONFIGURATION.md) · [中文文档目录](README.md)

这篇页面说明 `@forge/config` 当前实现的 schema version 1。当前设置和优先级以本页为入口；`AGENTS.md`、Skills 与资源目录见[项目上下文](PROJECT_CONTEXT.md)。

## 修改前先检查

```bash
pnpm forge config validate
pnpm forge config show
```

`validate` 会打印 Forge 实际检查的用户配置和项目配置路径；`show` 会展示每个有效值、来源、Forge home 和规范 workspace root。这两条命令都不会调用模型。

## 文件与优先级

Forge 按以下顺序加载：

```text
built-in defaults
  < $FORGE_HOME/config.json          用户配置
  < <workspace-root>/.forge/config.json
  < 支持的环境变量
  < 显式 CLI flags
```

`FORGE_HOME` 默认是 `~/.forge`。在 Git 仓库中，规范仓库根目录是 workspace root；不在 Git 仓库时使用当前目录。

这不是无限制的“后者覆盖前者”：

- 用户配置可以设置全部 schema 字段。
- 项目配置只能设置 `limits` 和 `context`。
- 项目 limit 只有比用户当前值更严格时才会生效。
- 项目 context mode 只能从 `off` 收紧到 `manual`/`automatic`，或从 `manual` 收紧到 `automatic`。
- Model、permission、trace、用户 plugin enablement 和 provider route 都是 user-only 字段；写入项目配置会直接报错。
- 未知字段和不支持的 schema version 都是错误。

因此仓库内容无法自行选择 credential 发送目标、启用可执行 plugin 或扩大安全 limit。

## 一个实用的用户配置

只需要写出想覆盖的值，省略字段会保留默认值：

```json
{
  "schemaVersion": 1,
  "model": {
    "engine": "forge",
    "provider": "deepseek",
    "id": "deepseek-v4-flash",
    "reasoningEffort": "medium",
    "thinking": "enabled"
  },
  "permissionProfile": "safe",
  "limits": {
    "maxSteps": 12,
    "maxToolCalls": 40,
    "commandTimeoutMs": 60000,
    "maxToolOutputBytes": 65536
  },
  "trace": { "enabled": true },
  "plugins": { "enabled": [] },
  "context": {
    "mode": "manual",
    "reservedOutputTokens": 4096,
    "bufferTokens": 8192,
    "recentTailTokens": 12000,
    "summaryTargetTokens": 1200
  }
}
```

交互式 `/model`、`/effort`、`/login` 和 provider 管理只会修改相关的用户字段，并使用校验后原子替换的方式保存。

## 字段参考

### Model 与 runtime

| 字段 | 默认值 | 可接受值 | 说明 |
| --- | --- | --- | --- |
| `model.engine` | `forge` | `forge`、`codex` | 交互式模型选择使用 native Forge Engine 或独立 Codex Engine。 |
| `model.provider` | `deepseek` | `deepseek`、`openai` 或已经配置的 route name | Native Forge Engine provider。自定义 route 必须存在于 `providers`。 |
| `model.id` | `deepseek-v4-flash` | 非空 model ID | 只选择 `openai` 时默认使用 `gpt-5.4-mini`；自定义 route 使用其第一个 model。 |
| `model.reasoningEffort` | `medium` | `none`、`minimal`、`low`、`medium`、`high`、`xhigh`、`max`、`ultra` | 实际模型可能只支持子集；`ultra` 只适用于明确公开该能力的 Codex model。 |
| `model.thinking` | `enabled` | `enabled`、`disabled` | Native provider 的 thinking mode，仍受 provider capability 限制。 |

切换 provider 而没有显式指定 model 时，Forge 会选择该 provider 默认值。推荐通过 `/model` 选择，因为它会展示发现或配置的 capability；reasoning effort 通过 `/effort` 独立修改。

### Permission 与 runtime limits

| 字段 | 默认值 | 有效范围 | 含义 |
| --- | ---: | --- | --- |
| `permissionProfile` | `safe` | `safe`、`workspace-write` | `safe` 确认首次写入和每条命令；`workspace-write` 自动允许 workspace 文件写入，但命令、网络工具和委派模型运行仍需确认。 |
| `limits.maxSteps` | `12` | 正整数 | 一次 run 最多 model turns。 |
| `limits.maxToolCalls` | `40` | 正整数 | 一次 run 最多 proposed tool calls。 |
| `limits.commandTimeoutMs` | `60000` | 正整数 | 进程命令 duration 上限。 |
| `limits.maxToolOutputBytes` | `65536` | 正整数 | 单次工具执行最多保留的输出。 |

Forge 没有实现 `full-access` profile。获批子进程也没有 OS sandbox，详见[安全模型](SECURITY_MODEL.md)。

Permission grant 不是配置。编号 session 选项只在当前进程保存 host 规范化 scope；项目配置、instruction、Skill、checkpoint、tool result 和 plugin hook 都不能持久化或扩大它。`/permissions` 可以查看并撤销当前内存 grant。

### Trace 与 plugins

| 字段 | 默认值 | 说明 |
| --- | --- | --- |
| `trace.enabled` | `true` | Native Forge Engine 事件写入 `$FORGE_HOME/runs`；Codex Engine 是另一套 runtime，不经过该 trace pipeline。 |
| `plugins.enabled` | `[]` | `$FORGE_HOME/plugins` 下启用的用户 plugin 名称。项目 plugin 使用 workspace trust，不使用这个列表。 |

用户 plugin 和受信任项目 plugin 都是进程内 JavaScript。Enable/trust 是代码信任决策，不是普通开关；详见[插件开发与信任](PLUGINS.md)。

### Context budget

| 字段 | 默认值 | 有效范围 | 项目 merge 规则 |
| --- | ---: | --- | --- |
| `context.mode` | `manual` | `off`、`manual`、`automatic` | 项目只能选择更严格模式。 |
| `context.reservedOutputTokens` | `4096` | 1–2,000,000 | 项目可以增加 reserve。 |
| `context.bufferTokens` | `8192` | 1–2,000,000 | 项目可以增加 safety buffer。 |
| `context.recentTailTokens` | `12000` | 0–2,000,000 | 项目可以减少原样保留的近期历史预算。 |
| `context.summaryTargetTokens` | `1200` | 64–2,000,000 | 项目可以减少 checkpoint target。 |
| `context.activationThreshold` | `0.78` | 0.5–0.95 | 项目只能降低压力阈值，不能提高。 |
| `context.minimumReclaimTokens` | `8000` | 0–2,000,000 | 项目只能降低 no-progress token 下限，不能提高。 |
| `context.minimumReclaimRatio` | `0.2` | 0–0.9 | 项目只能降低 no-progress 比率，不能提高。 |

`manual` 会测量预计下一次请求的压力，并在越过 activation threshold 时给出非阻塞控制；`automatic` 允许按压力生成 checkpoint。Manual 始终是产品默认，Automatic 只由用户主动开启。`/context` 可以只为当前进程选择任一行为，也可以明确保存对应模式，同时保留无关字段；session-only 状态不会恢复。旧版 `warn`/`compact` 在加载时迁移，并在下次保存时写成新名称。若 project 或 CLI precedence 使有效模式不同于用户保存值，面板会分别报告两者。`/compact` 在所有模式下仍可显式使用。规范 session transcript 始终独立保留。详见[上下文管理](CONTEXT_MANAGEMENT.md)。

## 安全的项目配置

仓库可以提交更小、更严格的配置：

```json
{
  "schemaVersion": 1,
  "limits": {
    "maxSteps": 8,
    "maxToolCalls": 20,
    "commandTimeoutMs": 30000
  },
  "context": {
    "mode": "automatic",
    "bufferTokens": 12000,
    "recentTailTokens": 8000
  }
}
```

以下内容会被拒绝，因为仓库不能自行选择 model 或扩大权限：

```json
{
  "schemaVersion": 1,
  "model": { "provider": "some-endpoint" },
  "permissionProfile": "workspace-write"
}
```

## 环境变量

### 配置选择

| 变量 | 用途 |
| --- | --- |
| `FORGE_HOME` | 覆盖用户配置、credential、plugin、session 与 trace 根目录。 |
| `FORGE_PROVIDER` | 选择 `deepseek`、`openai` 或已配置的 provider route。 |
| `FORGE_MODEL` | 选择 model ID。 |
| `FORGE_REASONING_EFFORT` | 选择 schema 支持的 reasoning level。 |
| `FORGE_THINKING` | 选择 `enabled` 或 `disabled`。 |

不存在用于扩大 permission profile 的环境变量。

### Credentials

| 变量 | 用途 |
| --- | --- |
| `DEEPSEEK_API_KEY` | DeepSeek API 认证。 |
| `OPENAI_API_KEY` | 按用量计费的 OpenAI API，与 ChatGPT subscription 无关。 |
| Route 声明变量 | Route 可通过 `auth.apiKeyEnv` 指定，例如 `GATEWAY_API_KEY`。 |
| `FORGE_<ROUTE>_API_KEY` | Bearer route 没有显式 `apiKeyEnv` 时的推导 fallback；连字符变下划线。 |

Credential 环境变量优先于 `$FORGE_HOME/auth.json`，secret value 永远不属于 `config.json`。

### 可选 plugin 网络变量

仓库中的 `web-tools` 示例通过 Forge 共享 HTTP dispatcher 支持 `HTTP_PROXY`、`HTTPS_PROXY` 与 `NO_PROXY`，也支持小写别名。这些变量影响可选网络 plugin，不影响内置 workspace tools。`BRAVE_SEARCH_API_KEY` 只由该示例的搜索 provider 使用。

## OpenAI-compatible routes

Provider route 是 user-only 配置，因为它决定 protocol、endpoint 和 credential 绑定。最小本地 route 示例：

```json
{
  "schemaVersion": 1,
  "providers": {
    "local": {
      "api": "openai-completions",
      "baseUrl": "http://127.0.0.1:11434/v1",
      "auth": { "type": "none" },
      "models": [
        {
          "id": "local-model",
          "contextWindow": 32768,
          "maxOutputTokens": 4096,
          "reasoningGears": false,
          "supportsImages": false
        }
      ]
    }
  }
}
```

支持的 `api` 值、远程 HTTPS 要求、bearer key 绑定、model discovery 限制与 reasoning metadata 见[认证模型](AUTHENTICATION.md)。

## 常见错误

- **修改了错误文件：** 使用 `forge config validate` 查看实际路径，用 `forge config show` 查看来源。
- **把 user-only 字段放进 `.forge/config.json`：** 把 model、permission、trace、plugin 和 provider 字段移到 `$FORGE_HOME/config.json`。
- **新增未知字段：** schema version 1 是 strict，拼写错误不会被静默忽略。
- **把 `reasoningEffort: "none"` 当成 provider default：** 省略才表示 provider default；显式 `none` 只会在 provider mapping 支持时发送。
- **把 API key 写进配置：** 删除它；若已提交则立即轮换，然后改用 `/login` 或环境变量。
- **期待 Forge 修改父 shell：** `/logout` 能移除保存的 credential，但不能取消父 shell 导出的环境变量。

## Skill 调用偏好

用户配置可以把 Skill 名称写入 `resources.disabledModelInvocation`。`forge resources disable <name>` 与 `forge resources enable <name>` 会更新这个仅限用户的设置。关闭自动调用不会修改 Skill 或仓库，也不会禁用显式 `$name` 请求；项目配置不能设置 `resources`。
