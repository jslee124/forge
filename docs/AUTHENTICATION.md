# Authentication Model

[简体中文](zh-CN/AUTHENTICATION.md) · [Documentation index](zh-CN/README.md)

## Status

Forge supports DeepSeek and OpenAI API-key authentication through
`DEEPSEEK_API_KEY` and `OPENAI_API_KEY`, plus ChatGPT subscription
authentication through the official Codex App Server.
User-scoped provider routes additionally support an explicitly selected bearer
credential or no authentication for local/self-hosted endpoints.
Forge presents the login command and browser/device-code instructions, while
Codex owns OAuth, credential persistence, refresh, and revocation.

## Supported and planned methods

| Method | Intended use | Status |
| --- | --- | --- |
| DeepSeek API key | Local development and automation | Implemented |
| OpenAI API key | Optional usage-based OpenAI API access | Implemented |
| Provider route bearer key | OpenAI-compatible gateways | Implemented |
| Provider route without authentication | Local Ollama/vLLM-style servers | Implemented |
| Sign in with ChatGPT | OpenAI subscription access through Codex App Server | Implemented |
| Codex access token | Trusted enterprise automation | Deferred |

DeepSeek's official API uses `https://api.deepseek.com` and the initial adapter
uses the official AI SDK provider package. The model ID remains configurable
because provider model names have a different lifecycle from the Forge release.

Official DeepSeek references:

- [DeepSeek API model documentation](https://api-docs.deepseek.com/quick_start/pricing/)
- [AI SDK DeepSeek provider](https://ai-sdk.dev/providers/ai-sdk-providers/deepseek)

OpenAI now documents Codex App Server as the integration protocol for embedding
Codex into a product. Its account surface supports managed ChatGPT browser and
device-code login. Forge uses that public surface rather than copying OpenCode's
OAuth client ID or rewriting requests to an undocumented ChatGPT endpoint.

Official reference:
[OpenAI Codex App Server](https://developers.openai.com/codex/app-server)

## Architectural boundary

The two execution paths have different ownership boundaries:

```text
Forge Engine: Forge Runtime -> Model Adapter -> DeepSeek or OpenAI API

Codex Engine: Forge CLI -> Codex App Server -> ChatGPT subscription
```

The Codex Engine is not wrapped as a Forge `ModelAdapter`: App Server owns a
complete agent runtime, including turns, tools, sandboxing, approvals, and
history. Treating it as a raw model transport would obscure which runtime made
security and execution decisions.

The provider-neutral authentication manager resolves API keys only from the
process environment and returns them to the selected adapter. Missing
credentials produce an actionable error without printing the key or a stack
trace. Keys are never copied into Forge configuration, prompts, traces, plugin
events, or repository files.

## OpenAI-compatible provider routes

Routes are declared under `providers` in `$FORGE_HOME/config.json`. They name a
wire protocol, canonical endpoint, explicit authentication mode, and model
profiles. Repository `.forge/config.json` files may not define routes because
that would let untrusted project content decide where a user credential is
sent.

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

`auth.type` is mandatory. `bearer` reads the declared variable, or derives
`FORGE_<ROUTE>_API_KEY`, before consulting Forge's stored credential. `none`
does not read or send any API key. Stored route credentials are bound to the
canonical `baseUrl`; after an endpoint change Forge refuses the old key until a
new one is saved.

Remote endpoints require HTTPS. Plain HTTP is accepted only for loopback hosts.
URLs containing credentials, query strings, or fragments are rejected. Model
discovery does not follow redirects, remains bounded to 4 MiB and 15 seconds,
and is optional because model IDs can be entered manually.

Forge treats an omitted reasoning setting as **provider default**, which is not
the same as disabling reasoning. Each `reasoningGears` entry maps a Forge UI
level to the exact wire value sent to the provider, so an explicit
`"none": "none"` is required when the endpoint supports disabling reasoning.
Legacy version-1 `null` mappings are read as their canonical key to avoid
silently turning `none` into provider default.

Model discovery also accepts bounded optional reasoning metadata such as
`reasoning_efforts`, `supported_reasoning_efforts`, or
`capabilities.reasoning.efforts`. These fields are non-standard extensions:
when they are absent Forge reports capabilities as unknown and keeps provider
defaults instead of guessing or issuing paid probe requests. The setup screen
prefills advertised levels and lets the user override them before saving.

An OpenAI API key is optional and is billed independently of ChatGPT. A ChatGPT
Plus, Pro, Business, or other subscription does not cause Forge to select the
API path. Users who only want subscription access should keep
`model.provider = "deepseek"` or use `forge codex`; they do not need to create
or export `OPENAI_API_KEY`.

## Compatibility requirements

The selected App Server integration satisfies these requirements:

- The flow is publicly documented for embedding Codex into a product
- Forge never supplies or copies an OAuth client identity
- Codex performs token exchange, refresh, revocation, and account selection
- The user-facing description accurately distinguishes subscription access from
  usage-based API access

Forge must not:

- Copy another application's client secret or identity
- Treat reverse-engineered endpoints as a permanent API contract
- Ask users to paste access or refresh tokens into chat
- Read, import, or modify `~/.codex/auth.json` directly
- Store credentials inside the current repository

## Credential storage

The interactive `/login` flow can persist API keys in
`$FORGE_HOME/auth.json`. The directory is mode `0700`, the file is mode `0600`,
updates are atomic, and environment variables take precedence. This is a
plaintext filesystem-protected fallback rather than an OS keychain. ChatGPT
subscription credentials remain owned entirely by Codex App Server.
The interactive `/logout` picker lists authenticated providers, removes the
selected stored API credential, or asks Codex App Server to sign out the
ChatGPT subscription. A logged-out third-party route remains visible as signed
out in `/login`, where it can be authenticated again. The route management
screen has a separate confirmed **Remove provider** action that deletes the
route, its models, and its stored credential. It reports any provider
environment variable that remains active; Forge cannot unset a variable in the
parent shell.

The preferred credential order is:

1. Operating-system credential store
2. Explicit file fallback outside the project with owner-only permissions
3. Environment variables for API keys in automation

Credentials must be excluded from prompts, run events, JSONL traces, plugin
events, telemetry, and ordinary error messages.

## Refresh and concurrency

Codex App Server owns subscription token refresh and persistence. Forge never
receives OAuth access or refresh tokens. The App Server may use the Codex
credential-store configuration shared with other local Codex clients.

Credential updates must be atomic. A failed refresh must not destroy the last
known credential before the error is handled.

## Commands

The CLI exposes:

```text
forge auth login openai
forge auth status openai
forge auth status openai-api
forge auth logout openai
forge models list --provider openai
forge codex "Inspect this repository" --model <id> --reasoning-effort <effort>
forge run "Inspect this repository" --provider openai --model gpt-5.4-mini --reasoning-effort low
```

Use `forge auth login openai --method device-code` for a headless login. Forge
prints the official verification URL and code and waits for App Server's
completion notification. Browser callback validation and PKCE are owned by
Codex. Cancelling Forge asks App Server to cancel the pending login.

Sign-in URLs are much wider than a terminal window. Terminals that linkify
plain text do so one display line at a time, so a wrapped URL would stay
clickable only up to its first wrap. Forge therefore emits the URL as a single
OSC 8 hyperlink on terminals known to support it, including VS Code, Ghostty,
WezTerm, iTerm2, Kitty, Windows Terminal, Konsole, and VTE 5000 or newer. The
visible label remains the complete address, so an unsupported terminal still
shows a copyable URL. Redirected output, `TERM=dumb`, and `NO_COLOR` always
produce the bare URL. Set `FORCE_HYPERLINK=1` to opt an unrecognized terminal
in, or `FORCE_HYPERLINK=0` to opt out.

`forge auth logout openai` operates on the shared Codex account and can sign
other local Codex clients out. Forge does not claim that these are Forge-owned
credentials.

`forge auth status openai-api` only checks whether `OPENAI_API_KEY` is present;
it never validates the key with a paid request. `forge auth login openai-api`
prints environment-variable guidance because Forge deliberately does not store
API keys. The interactive `/model` picker discovers the current Codex catalog
and also shows native API adapters without duplicating models by reasoning
effort. The separate `/effort` picker and Shift+Tab shortcut use the selected
model's supported levels. Forge persists these ordinary
engine/provider/model/reasoning settings under `$FORGE_HOME/config.json`, never
credentials.
Selecting a ChatGPT entry routes subsequent interactive prompts through Codex
Engine.
