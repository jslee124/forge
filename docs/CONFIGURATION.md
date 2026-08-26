# Configuration Reference

[简体中文](zh-CN/CONFIGURATION.md) · [Documentation index](README.md)

This page documents Forge configuration schema version 1 as implemented by
`@forge/config`. Use it for current settings and precedence; use [Project
context](PROJECT_CONTEXT.md) for `AGENTS.md`, Skills, and the broader resource
layout.

## Inspect before editing

Two read-only commands explain the active configuration:

```bash
pnpm forge config validate
pnpm forge config show
```

`validate` prints the user and project paths Forge checked. `show` prints each
effective value together with its source, plus the resolved Forge home and
canonical workspace root. Neither command contacts a model provider.

## Files and precedence

Forge loads settings in this order:

```text
built-in defaults
  < $FORGE_HOME/config.json          user configuration
  < <workspace-root>/.forge/config.json
  < supported environment variables
  < explicit CLI flags
```

`FORGE_HOME` defaults to `~/.forge`. A Git repository's canonical root is the
workspace root; outside Git, the current directory is used.

This is not unrestricted last-writer-wins behavior:

- User configuration may set every schema field.
- Project configuration may set only `limits` and `context`.
- A project limit is applied only when it is stricter than the active user
  value.
- Project context mode may move only from `off` to `warn` or `compact`, or from
  `warn` to `compact`.
- Model selection, permission profile, trace persistence, enabled user plugins,
  and provider routes are user-only and are rejected in project configuration.
- Unknown fields and unsupported schema versions are errors.

These rules prevent repository-controlled configuration from choosing where a
credential is sent, enabling executable code, or widening a safety limit.

## A practical user configuration

Create `$FORGE_HOME/config.json` only for values you want to override. Omitted
values keep their defaults.

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
    "mode": "warn",
    "reservedOutputTokens": 4096,
    "bufferTokens": 8192,
    "recentTailTokens": 12000,
    "summaryTargetTokens": 1200
  }
}
```

The interactive `/model`, `/effort`, `/login`, and provider-management flows
write only the relevant user-owned fields. Updates are validated and replaced
atomically.

## Field reference

### Model and runtime

| Field | Default | Accepted values | Notes |
| --- | --- | --- | --- |
| `model.engine` | `forge` | `forge`, `codex` | Chooses the native Forge Engine or separate Codex Engine for interactive model selection. |
| `model.provider` | `deepseek` | `deepseek`, `openai`, or a configured route name | Native Forge Engine provider. A route must exist under `providers`. |
| `model.id` | `deepseek-v4-flash` | Non-empty model ID | Defaults to `gpt-5.4-mini` when `openai` is selected without an explicit model; configured routes use their first model. |
| `model.reasoningEffort` | `medium` | `none`, `minimal`, `low`, `medium`, `high`, `xhigh`, `max`, `ultra` | The selected provider/model may support only a subset. `ultra` is reserved for a Codex model that advertises it. |
| `model.thinking` | `enabled` | `enabled`, `disabled` | Native provider thinking mode; provider capability still applies. |

Changing provider without setting a model selects that provider's default.
Use `/model` for the safest interactive path because it displays discovered or
configured capabilities; use `/effort` independently to change reasoning
effort.

### Permission and runtime limits

| Field | Default | Valid range | Meaning |
| --- | ---: | --- | --- |
| `permissionProfile` | `safe` | `safe`, `workspace-write` | `safe` confirms the first write and every command. `workspace-write` auto-allows workspace file writes but still confirms commands, network tools, and delegated model runs. |
| `limits.maxSteps` | `12` | Positive integer | Maximum model turns in one run. |
| `limits.maxToolCalls` | `40` | Positive integer | Maximum proposed tool calls in one run. |
| `limits.commandTimeoutMs` | `60000` | Positive integer | Upper bound applied to process-command duration. |
| `limits.maxToolOutputBytes` | `65536` | Positive integer | Maximum retained output from one tool execution. |

Forge does not implement a `full-access` profile. An approved child process is
still not OS-sandboxed; see [Security](SECURITY.md).

### Traces and plugins

| Field | Default | Notes |
| --- | --- | --- |
| `trace.enabled` | `true` | Native Forge Engine events are written under `$FORGE_HOME/runs`. Codex Engine has a separate runtime and is not wrapped by this trace pipeline. |
| `plugins.enabled` | `[]` | Names of user plugins under `$FORGE_HOME/plugins`. Project plugins use workspace trust instead of this list. |

User plugins and trusted project plugins are executable in-process JavaScript.
Enabling or trusting one is a code-trust decision, not an ordinary feature
toggle. See [Plugin authoring and trust](PLUGINS.md).

### Context budget

| Field | Default | Valid range | Project merge rule |
| --- | ---: | --- | --- |
| `context.mode` | `warn` | `off`, `warn`, `compact` | A project may select only a stricter mode. |
| `context.reservedOutputTokens` | `4096` | 1–2,000,000 | A project may increase the reserve. |
| `context.bufferTokens` | `8192` | 1–2,000,000 | A project may increase the safety buffer. |
| `context.recentTailTokens` | `12000` | 0–2,000,000 | A project may reduce the verbatim recent-history budget. |
| `context.summaryTargetTokens` | `1200` | 64–2,000,000 | A project may reduce the checkpoint target. |

`warn` measures pressure and reports it without automatically generating a
checkpoint. `compact` enables automatic checkpoint behavior when required by
the implemented budget rules. `/compact` remains available as an explicit
interactive action. The canonical session transcript is retained separately in
all modes. See [Context management](CONTEXT_MANAGEMENT.md).

## Safe project configuration

A repository may check in a smaller, stricter configuration such as:

```json
{
  "schemaVersion": 1,
  "limits": {
    "maxSteps": 8,
    "maxToolCalls": 20,
    "commandTimeoutMs": 30000
  },
  "context": {
    "mode": "compact",
    "bufferTokens": 12000,
    "recentTailTokens": 8000
  }
}
```

The following project configuration is rejected because the repository may not
select a model or widen its own privileges:

```json
{
  "schemaVersion": 1,
  "model": { "provider": "some-endpoint" },
  "permissionProfile": "workspace-write"
}
```

## Environment variables

### Configuration selection

| Variable | Purpose |
| --- | --- |
| `FORGE_HOME` | Override the user-level configuration, credential, plugin, session, and trace root. |
| `FORGE_PROVIDER` | Select `deepseek`, `openai`, or a configured provider route. |
| `FORGE_MODEL` | Select the model ID. |
| `FORGE_REASONING_EFFORT` | Select one of the schema reasoning levels. |
| `FORGE_THINKING` | Select `enabled` or `disabled`. |

There is intentionally no environment variable that widens the permission
profile.

### Credentials

| Variable | Purpose |
| --- | --- |
| `DEEPSEEK_API_KEY` | DeepSeek API authentication. |
| `OPENAI_API_KEY` | Usage-based OpenAI API authentication; unrelated to a ChatGPT subscription. |
| Declared route variable | A route may name `auth.apiKeyEnv`, for example `GATEWAY_API_KEY`. |
| `FORGE_<ROUTE>_API_KEY` | Derived fallback for a bearer route without an explicit `apiKeyEnv`; hyphens become underscores. |

Credential variables take precedence over `$FORGE_HOME/auth.json`. Secret
values never belong in `config.json`.

### Optional plugin networking

The checked-in `web-tools` example honors `HTTP_PROXY`, `HTTPS_PROXY`, and
`NO_PROXY`, including lowercase aliases, through Forge's shared HTTP
dispatcher. These variables affect optional network plugins, not the built-in
workspace tools. `BRAVE_SEARCH_API_KEY` is used only by that example's search
provider.

## OpenAI-compatible routes

Provider routes are user-only because they decide the protocol, endpoint, and
credential binding. A minimal local route looks like this:

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

Supported `api` values, remote HTTPS requirements, bearer-key binding, model
discovery limits, and reasoning metadata are documented in
[Authentication](AUTHENTICATION.md).

## Common mistakes

- **Editing the wrong file:** run `forge config validate` to see both resolved
  paths and `forge config show` to see provenance.
- **Placing user-only fields in `.forge/config.json`:** move model, permission,
  trace, plugin, and provider fields to `$FORGE_HOME/config.json`.
- **Adding an unknown field:** schema version 1 is strict; spelling mistakes are
  errors, not ignored settings.
- **Treating `reasoningEffort: "none"` as provider default:** omission means
  provider default; explicit `none` is sent only when the provider mapping
  supports it.
- **Putting an API key in configuration:** remove it, rotate it if committed,
  then use `/login` or an environment variable.
- **Expecting Forge to unset the parent shell:** `/logout` removes stored
  credentials but cannot remove an exported environment variable.
