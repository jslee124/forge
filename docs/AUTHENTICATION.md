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
| Third-party provider route | A gateway or self-hosted OpenAI-compatible endpoint | Implemented |
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

An environment variable is always consulted first, and a key present there is
never written to disk. `/login` may additionally store a key in
`$FORGE_HOME/auth.json`, whose directory is mode `0700` and whose file is mode
`0600`; writes are atomic and guarded by a lock file. Like Pi and OpenCode's
local auth files, this is plaintext protected by filesystem permissions rather
than an OS keychain, which remains the preferred storage if one is adopted.

The credential file is keyed by credential owner: `deepseek`, `openai`, or a
third-party route name. Any other key is skipped when the file is read and
refused when written, so a hand-edited stray entry cannot make the remaining
credentials unreadable and no caller can write an arbitrary property.

Credentials must be excluded from prompts, run events, JSONL traces, plugin
events, telemetry, and ordinary error messages.

## Third-party provider routes

A route is one entry of the user-configuration `providers` table, keyed by the
route name. It declares the wire protocol, the endpoint, an optional display
name and credential variable, and the models the route serves:

```json
{
  "schemaVersion": 1,
  "providers": {
    "my-gateway": {
      "api": "openai-completions",
      "baseUrl": "https://gateway.example/openai/v1",
      "models": [
        { "id": "glm-4.6", "reasoningGears": { "none": null, "high": "high" } }
      ]
    }
  }
}
```

Three boundaries apply to a route:

- **Repository configuration may not define one.** A route names the endpoint
  that receives the stored API key, so `.forge/config.json` is refused if it
  contains `providers`. Only user configuration and the CLI may add a route.
- **Plain HTTP is accepted only for a loopback host.** A local gateway such as
  Ollama or vLLM has no certificate, while an external plaintext endpoint would
  put the key on the network. An endpoint may not embed a username, password,
  query string, or fragment.
- **Route names are validated.** Lowercase letters, digits, and hyphens only,
  and the built-in provider and engine names are reserved.

A route's key is read from the environment variable its profile declares, or
from `FORGE_<ROUTE>_API_KEY` when it declares none, before the stored
credential is consulted.

Reasoning gears map a Forge gear name to the wire value the endpoint expects,
so the selectable gear is decoupled from each endpoint's parameter spelling. A
gear mapped to null is offered but sends no reasoning parameter, `false`
declares a model that does not reason, and an absent declaration sends no
reasoning parameter at all.

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
