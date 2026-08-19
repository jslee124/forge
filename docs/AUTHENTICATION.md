# Authentication Model

## Status

Forge supports DeepSeek and OpenAI API-key authentication through
`DEEPSEEK_API_KEY` and `OPENAI_API_KEY`, plus ChatGPT subscription
authentication through the official Codex App Server.
Forge presents the login command and browser/device-code instructions, while
Codex owns OAuth, credential persistence, refresh, and revocation.

## Supported and planned methods

| Method | Intended use | Status |
| --- | --- | --- |
| DeepSeek API key | Local development and automation | Implemented |
| OpenAI API key | Optional usage-based OpenAI API access | Implemented |
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

Forge does not persist API credentials; it reads `DEEPSEEK_API_KEY` or
`OPENAI_API_KEY` from the process environment for each invocation. If a later
authentication method needs persistence, the preferred storage order is:

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
API keys. The interactive `/model` picker discovers the current Codex catalog,
also shows native API adapters, and persists ordinary engine/provider/model and
reasoning settings under `$FORGE_HOME/config.json`, never credentials.
Selecting a ChatGPT entry routes subsequent interactive prompts through Codex
Engine.
