<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="docs/assets/forge-logo-dark.svg">
    <source media="(prefers-color-scheme: light)" srcset="docs/assets/forge-logo-light.svg">
    <img src="docs/assets/forge-logo-light.svg" alt="Forge" width="760">
  </picture>
</p>

<p align="center">
  <strong>A coding agent you can inspect, constrain, and evaluate.</strong><br>
  <sub>Forge owns the agent loop, keeps tool use behind explicit policy, and records evidence for every run.</sub>
</p>

<p align="center">
  <a href="https://github.com/jslee124/forge/actions/workflows/ci.yml"><img src="https://img.shields.io/github/actions/workflow/status/jslee124/forge/ci.yml?branch=main&amp;style=flat-square&amp;label=CI" alt="CI status"></a>
  <img src="https://img.shields.io/badge/source-v0.3.3-0e7490?style=flat-square" alt="Source version 0.3.3">
  <img src="https://img.shields.io/badge/Node.js-%3E%3D24-3c873a?style=flat-square&amp;logo=nodedotjs&amp;logoColor=white" alt="Node.js 24 or newer">
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-7c3aed?style=flat-square" alt="MIT license"></a>
</p>

<p align="center">
  <a href="docs/GETTING_STARTED.md">Getting started</a> ·
  <a href="#why-forge">Why Forge?</a> ·
  <a href="#safety-model">Safety</a> ·
  <a href="#evaluation">Evaluation</a> ·
  <a href="docs/README.md">Documentation</a> ·
  <a href="CONTRIBUTING.md">Contributing</a>
</p>

<p align="center">
  <a href="README.md">English</a> ·
  <a href="README.zh-CN.md">简体中文</a>
</p>

Forge is an open-source TypeScript project for learning and demonstrating the
engineering behind coding agents: model interaction, tool execution, approval
boundaries, context management, persistence, plugins, and reproducible
evaluations.

It is best suited to developers who want a small runtime they can read end to
end, experiment with, and measure. Forge now has a single-package npm release
path while retaining the source checkout for contributors. It is not a turnkey
replacement for a hardened coding environment.

## Why Forge?

Many coding-agent demos stop when a model emits a tool call. Forge focuses on
everything that must happen around that call for the system to be understandable
and testable.

| Capability | What Forge proves |
| --- | --- |
| **Forge-owned loop** | The runtime controls model steps, tool execution, continuation, recovery, cancellation, and stop limits. |
| **Explicit policy** | Every tool proposal receives an `allow`, `confirm`, or `deny` decision before execution. |
| **Observable runs** | Structured terminal events and versioned JSONL traces show what the model proposed and what actually happened. |
| **Persistent sessions** | Completed turns and bounded failed-run outcomes survive restarts without restoring old approvals or pending tool calls. |
| **Budgeted context** | `/context` exposes the active budget; optional checkpoints compact canonical history without deleting the canonical transcript. |
| **Reproducible evaluation** | Deterministic tests prove runtime behavior, while live-model trials retain both successes and failures. |
| **Controlled extensibility** | Trusted plugins and non-executable built-in, user, and project Skills extend Forge without bypassing the core policy pipeline. |

## Quick start

Released builds can be installed as a global CLI:

```bash
npm install --global @jslee124/forge
forge config validate
```

Contributors can use the source checkout below. Source development requires
Node.js 24 or newer, pnpm 11.18.0, Git, and one supported model-access route:

```bash
git clone https://github.com/jslee124/forge.git
cd forge
pnpm install --frozen-lockfile
pnpm build
pnpm forge config validate
```

Choose how the model should be accessed:

| Access route | Engine | Setup |
| --- | --- | --- |
| DeepSeek API | Native Forge Engine | Start `pnpm forge`, then use `/login` |
| OpenAI API | Native Forge Engine | Start `pnpm forge`, then use `/login` |
| OpenAI-compatible endpoint | Native Forge Engine | Add a user-scoped route through `/login` or configuration |
| ChatGPT subscription | Separate Codex Engine | Install Codex CLI, then run `pnpm forge auth login openai` |

OpenAI API usage is billed separately from ChatGPT subscriptions. API keys may
be entered through the masked `/login` flow or supplied through environment
variables; environment credentials take precedence.

Start the interactive terminal and begin with a read-only request:

```bash
pnpm forge
```

```text
Inspect this repository. Summarize its package structure and verification
commands. Do not modify files.
```

Then try a bounded coding task:

```text
Fix the failing tests. Inspect the relevant files first and verify the result.
```

Under the default `safe` profile, Forge asks before the first workspace write
in a run and before every process command. Review the exact diff, command,
working directory, and timeout before approving.

Useful interactive commands include:

```text
/login      configure or manage a provider
/model      choose the active model
/effort     choose a supported reasoning effort
/context    inspect the active context budget
/plugins    review project plugin trust
/resume     continue a persisted session
/help       show the complete command list
```

To make the development checkout available globally:

```bash
pnpm link:global
forge
```

The link points to the current checkout. Run `pnpm build` after source changes
and `pnpm unlink:global` when you no longer need it.

The [complete getting-started guide](docs/GETTING_STARTED.md) explains each
authentication route, local validation, first-run approvals, sessions, and run
inspection.

## What Forge can do

- Inspect a workspace with bounded file listing, reading, and search tools.
- Create files and apply targeted patches after showing an exact diff.
- Run structured process commands with explicit arguments, timeouts, output
  limits, and approval.
- React to failed verification and continue toward a corrected result.
- Stream model text and provider-exposed reasoning as separate events.
- Persist sessions and resume completed turns plus bounded failed-run outcomes by ID or recency.
- Inspect context usage and create explicit, displayable conversation
  checkpoints.
- Load hierarchical `AGENTS.md` instructions and lazily invoked built-in, user, and project Skills.
- Load trusted plugins that contribute tools, commands, observers, prompts, or
  stricter policy hooks, including bounded host-managed subagent roles.
- Attach JPEG, PNG, GIF, or WebP input to supported vision models.
- Record native-engine runs as inspectable, versioned JSONL traces.

Run a one-shot native-engine task:

```bash
pnpm forge run "Inspect the repository and summarize its architecture"
```

Run through the separate Codex Engine with ChatGPT subscription access:

```bash
pnpm forge auth login openai
pnpm forge codex "Inspect this repository and summarize it"
```

See the [CLI UI guide](docs/CLI_UI.md) for keyboard shortcuts, image paste and
drag-and-drop, slash commands, file mentions, diff review, and interactive
provider management.

## Safety model

Forge is safe by default in a specific, inspectable sense:

| Action | Default `safe` decision |
| --- | --- |
| Read, list, or search inside the workspace | Allow |
| First workspace write in a run | Confirm |
| Later writes covered by that run approval | Allow |
| Any process command | Confirm |
| Any registered network tool | Confirm |
| Any delegated subagent model run | Confirm |
| Built-in file access outside the workspace | Deny |
| Approval-required action without an approval channel | Deny |

Built-in file tools resolve canonical paths and symlinks before enforcing the
workspace boundary. Process commands use structured `program + args[]` input
with `shell: false`, a 60-second default timeout, and bounded output.

> **Security boundary:** Approval is not isolation. Forge is **not an
> operating-system sandbox**. An approved child process runs with the privileges
> of the user who launched Forge, and trusted plugins are in-process code. Read
> the [security model](docs/SECURITY.md) before using Forge on untrusted
> repositories.

## Providers and engines

Forge keeps authentication method, provider protocol, and runtime ownership
separate.

| Access route | Runtime | Notes |
| --- | --- | --- |
| DeepSeek API key | Native Forge Engine | Chat, tool use, and supported experimental vision input |
| OpenAI API key | Native Forge Engine | API usage is billed separately from ChatGPT subscriptions |
| OpenAI-compatible route | Native Forge Engine | User-scoped HTTPS endpoints or auth-free loopback servers |
| ChatGPT subscription | Codex Engine | Uses the official Codex App Server and its existing account boundary |

API keys may be entered through the masked `/login` flow or supplied through
environment variables. Environment credentials take precedence. Forge stores
saved API keys in an owner-only local file; Codex continues to own ChatGPT
credentials and refresh. See [Authentication](docs/AUTHENTICATION.md) for the
complete boundary and third-party route configuration.

## Architecture

```text
Interactive CLI
 |
 |-- Forge Engine
 |   `-- Native runtime
 |       |-- Models: DeepSeek / OpenAI / compatible APIs
 |       |-- Context: ~/.forge / AGENTS.md / .agents
 |       |-- Extensions: plugins / Skills
 |       |-- Policy: allow / confirm / deny
 |       |-- Tools: files / search / patch / process
 |       `-- Output: terminal events / JSONL traces
 |
 `-- Codex Engine
     `-- Official Codex App Server
```

The native runtime remains provider-neutral. Adapters translate provider
requests and continuation metadata; the core owns lifecycle state, policy,
limits, tools, and trace events. The Codex Engine is deliberately separate and
uses Codex's conversation, sandbox, approval, and authentication behavior.

Read the [architecture guide](docs/ARCHITECTURE.md) for package boundaries and
the full call path.

## Evaluation

Forge separates deterministic runtime correctness from nondeterministic model
quality. Default tests use scripted models and mocked transports; they do not
make paid model calls.

Run the deterministic recovery and grader suite:

```bash
pnpm eval:deterministic
```

The published v0.1 DeepSeek evaluation ran three trials across each of three
small TypeScript repair tasks. Seven of nine trials passed end to end:

| Task | Passed | Pass rate |
| --- | ---: | ---: |
| `config-merge` | 3/3 | 100.0% |
| `retry-cache` | 2/3 | 66.7% |
| `validation-bug` | 2/3 | 66.7% |

Both failures remain in the repository. A run counts as passing only when Forge
finishes successfully and both fixture-owned tests and an external grader pass.
Read the [evaluation guide](docs/EVALUATION.md), the
[published report](evals/reports/v0.1/report.md), and the
[v0.2.0 release notes](evals/reports/v0.2/RELEASE_NOTES.md), plus the
[v0.2 context-management gate](evals/reports/v0.2/CONTEXT_MANAGEMENT.md).

Live trials are explicit and opt-in because they make paid provider requests:

```bash
export DEEPSEEK_API_KEY="your-api-key"
FORGE_EVAL_LIVE=1 pnpm eval:live
```

## Development

```bash
pnpm build               # compile TypeScript project references
pnpm check               # run Biome and strict TypeScript checks
pnpm test                # build and run the complete Vitest suite
pnpm eval:deterministic  # run paid-call-free release evidence
pnpm forge --help        # build and inspect the CLI
```

The root remains a private pnpm workspace. Release automation bundles private
`@forge/*` implementation code into the single public `@jslee124/forge` CLI;
the plugin SDK is not separately published. The workspace packages still
separate the CLI, runtime, tools, configuration, persistence, authentication,
plugin API, and provider adapters for development.

## Documentation

Start at the [documentation hub](docs/README.md), which routes readers by task.
中文读者可查看[简体中文 README](README.zh-CN.md)和[中文文档目录](docs/zh-CN/README.md)。

| Topic | Guide |
| --- | --- |
| Install and first task | [Getting started](docs/GETTING_STARTED.md) · [Troubleshooting](docs/TROUBLESHOOTING.md) |
| Daily use | [CLI UI](docs/CLI_UI.md) · [Configuration](docs/CONFIGURATION.md) · [Authentication](docs/AUTHENTICATION.md) · [Sessions](docs/SESSIONS.md) |
| Boundaries and internals | [Architecture](docs/ARCHITECTURE.md) · [Security](docs/SECURITY.md) · [Context management](docs/CONTEXT_MANAGEMENT.md) |
| Customization and extensions | [Project context](docs/PROJECT_CONTEXT.md) · [Plugins](docs/PLUGINS.md) · [examples](examples/plugins/) |
| Evidence and direction | [Evaluation](docs/EVALUATION.md) · [published reports](evals/reports/README.md) · [Roadmap](docs/ROADMAP.md) |
| Contributing | [Contribution guide](CONTRIBUTING.md) |

## Current status and limitations

Forge is under active development. The development source version is `0.3.3`;
the latest published npm release remains `0.3.2` until the release workflow is
run. Historical details for the first public feature baseline are in the
[v0.3.0 release notes](docs/history/v0.3.0/RELEASE_NOTES.md). Automatic context checkpoint
generation remains opt-in while live provider-quality evidence is collected.

- The native runtime supports DeepSeek, OpenAI API, and configured
  OpenAI-compatible routes. Native Anthropic and Gemini protocols are not yet
  implemented.
- Model behavior is nondeterministic; runtime correctness does not guarantee
  live task success.
- Resume replays available historical model/tool events, but never reactivates
  pending tool calls or old approvals.
- Plugins are trusted local code, not isolated extensions.
- General multi-agent orchestration beyond bounded plugin-declared subagents,
  RAG, IDE integration, cloud execution, autonomous Git pushes, and
  cross-machine session synchronization are out of scope.

See the [roadmap](docs/ROADMAP.md) for completed acceptance criteria and future
work.

## License

Forge is available under the [MIT License](LICENSE).
