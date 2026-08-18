# Authentication Model

## Status

Forge v0.1 starts with DeepSeek API-key authentication through
`DEEPSEEK_API_KEY`. Codex-compatible Sign in with ChatGPT is a later
compatibility goal and must be revalidated against current official OpenAI
documentation before implementation or release.

## Supported and planned methods

| Method | Intended use | Status |
| --- | --- | --- |
| DeepSeek API key | Local development and automation | Planned for v0.1 |
| Other provider API keys | Future provider adapters | Deferred |
| Sign in with ChatGPT | OpenAI subscription access | Post-v0.2 research goal |
| Codex access token | Trusted enterprise automation | Deferred |

DeepSeek's official API uses `https://api.deepseek.com` and the initial adapter
uses the official AI SDK provider package. The model ID remains configurable
because provider model names have a different lifecycle from the Forge release.

Official DeepSeek references:

- [DeepSeek API model documentation](https://api-docs.deepseek.com/quick_start/pricing/)
- [AI SDK DeepSeek provider](https://ai-sdk.dev/providers/ai-sdk-providers/deepseek)

OpenAI officially documents that Codex clients support Sign in with ChatGPT for
subscription access and API keys for usage-based access. That documentation does
not by itself establish a public OAuth contract for arbitrary third-party
clients. Forge must not present compatibility work as an official OpenAI
integration without evidence of such support.

Official reference:
[OpenAI Codex authentication](https://developers.openai.com/codex/auth)

## Architectural boundary

Model transport and authentication are separate concerns:

```text
Agent Runtime
     |
     v
Model Adapter -----> Authentication Manager -----> Credential Store
     |
     v
Vercel AI SDK -----> Model Provider
```

The model adapter requests a usable credential. It does not own browser login,
refresh-token rotation, persistence, or logout.

The v0.1 authentication manager validates that `DEEPSEEK_API_KEY` is present and
returns it only to the DeepSeek adapter. Missing credentials produce an
actionable error without printing the key or a stack trace. The key is never
copied into Forge configuration, prompts, traces, plugin events, or repository
files.

## Compatibility requirements

Before implementing subscription login, Forge must confirm:

- The flow is publicly documented or explicitly authorized for third-party use
- The required client registration and scopes are legitimate for Forge
- The token audience and API endpoint are intended for this client
- Refresh, revocation, account switching, and workspace selection are understood
- The user-facing description accurately distinguishes subscription access from
  usage-based API access

Forge must not:

- Copy another application's client secret or identity
- Treat reverse-engineered endpoints as a permanent API contract
- Ask users to paste access or refresh tokens into chat
- Read, import, or modify `~/.codex/auth.json` without an explicit future import
  design and user approval
- Store credentials inside the current repository

## Credential storage

Forge v0.1 does not persist DeepSeek credentials; it reads
`DEEPSEEK_API_KEY` from the process environment for each invocation. If a later
authentication method needs persistence, the preferred storage order is:

1. Operating-system credential store
2. Explicit file fallback outside the project with owner-only permissions
3. Environment variables for API keys in automation

Credentials must be excluded from prompts, run events, JSONL traces, plugin
events, telemetry, and ordinary error messages.

## Refresh and concurrency

An OAuth-capable credential store must coordinate refreshes. If several model
requests discover an expired token at the same time, only one refresh operation
should run; the others should await its result.

Credential updates must be atomic. A failed refresh must not destroy the last
known credential before the error is handled.

## Commands

The eventual CLI may expose:

```text
forge auth login openai
forge auth status
forge auth logout openai
```

Headless and non-interactive login should be added only when supported by the
chosen public flow. Browser login must handle cancellation, callback timeout,
state validation, and PKCE correctly.
