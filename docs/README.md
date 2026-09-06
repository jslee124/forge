# Forge Documentation

[简体中文](zh-CN/README.md) · [Project README](../README.md)

Forge's documentation is organized around what a reader is trying to do. Start
with the shortest path below instead of reading every page in order.

## Choose a path

| I want to... | Start here | Then read |
| --- | --- | --- |
| Run Forge for the first time | [Getting started](GETTING_STARTED.md) | [CLI UI](CLI_UI.md) · [Authentication](AUTHENTICATION.md) |
| Configure a model, limits, or context behavior | [Configuration](CONFIGURATION.md) | [Authentication](AUTHENTICATION.md) · [Context management](CONTEXT_MANAGEMENT.md) |
| Understand what Forge can and cannot protect | [Security model](SECURITY_MODEL.md) | [Architecture](ARCHITECTURE.md) |
| Resume a conversation or inspect a run | [Sessions and traces](SESSIONS.md) | [CLI UI](CLI_UI.md) |
| Add project instructions or a portable Skill | [Project context](PROJECT_CONTEXT.md) | [Security model](SECURITY_MODEL.md) |
| Build a plugin or study an extension example | [Plugin authoring](PLUGINS.md) | [Architecture](ARCHITECTURE.md) |
| Reproduce the published evidence | [Evaluation](EVALUATION.md) | [Versioned reports](../evals/reports/README.md) |
| Contribute to Forge | [Contributing](../CONTRIBUTING.md) | [Architecture](ARCHITECTURE.md) · [Roadmap](ROADMAP.md) |
| Publish an npm release | [npm release guide](RELEASING.md) | [Evaluation](EVALUATION.md) · [Security model](SECURITY_MODEL.md) |
| Review the current release | [v0.3.4 release notes](../evals/reports/v0.3.4/RELEASE_NOTES.md) | [release evidence](../evals/reports/v0.3.4/) |
| Review the first public release | [v0.3.0 release notes](history/v0.3.0/RELEASE_NOTES.md) | [npm release guide](RELEASING.md) |
| Diagnose a problem | [Troubleshooting](TROUBLESHOOTING.md) | The topic-specific guide linked from the symptom |

## Use Forge

| Guide | What it answers |
| --- | --- |
| [Getting started](GETTING_STARTED.md) | How do I install from source, choose an access route, verify setup, and complete a first task? |
| [CLI UI](CLI_UI.md) | Which slash commands and keyboard controls are available? How do approvals, file mentions, and images work? |
| [Configuration](CONFIGURATION.md) | Where are settings loaded from, which source wins, and which fields may a repository control? |
| [Authentication](AUTHENTICATION.md) | How do API keys, compatible endpoints, and ChatGPT subscription access differ? |
| [Sessions and traces](SESSIONS.md) | What is persisted, what does resume restore, and how do I inspect a run? |
| [Troubleshooting](TROUBLESHOOTING.md) | What should I check when startup, credentials, approvals, plugins, images, or the terminal misbehave? |
| [npm release guide](RELEASING.md) | How is the single public CLI package built, verified, published, updated, and rolled back? |

## Understand Forge

| Guide | Document type | What it covers |
| --- | --- | --- |
| [Architecture](ARCHITECTURE.md) | Current architecture and rationale | Package boundaries, both engines, the runtime loop, policy, events, and dependency direction |
| [Security model](SECURITY_MODEL.md) | Implemented security contract | Workspace, process, network, plugin, credential, session, and delegated-run boundaries |
| [Context management](CONTEXT_MANAGEMENT.md) | Implemented design record | Budget accounting, checkpoints, overflow recovery, invariants, and evaluation gates |
| [Product definition](PRODUCT.md) | Product rationale | Target users, principles, scope, and deliberate non-goals |

## Extend Forge

| Guide | What it covers |
| --- | --- |
| [Project context](PROJECT_CONTEXT.md) | `AGENTS.md`, `.agents/skills`, `.forge/`, `~/.forge/`, and instruction precedence |
| [Plugin authoring](PLUGINS.md) | Manifest v1, activation API, tools, commands, policy restrictions, observers, and host-managed subagents |
| [Example plugins](../examples/plugins/) | Custom tools, stricter policy, web tools, MCP stdio, to-dos, and a read-only code-review subagent |

`web_search` and `web_fetch` are optional example-plugin tools. They are not
built-in Forge defaults. Project plugins are trusted in-process code; manifest
capabilities and per-tool approval are not an operating-system sandbox.

## Current development

Plans and task lists define development contracts, not implemented capabilities.
Use source, tests, and recorded acceptance results to establish completion.

| Document | Purpose |
| --- | --- |
| [Evaluation guide](EVALUATION.md) | Run deterministic evidence and explicit opt-in live trials |
| [Roadmap](ROADMAP.md) | Current development, completed milestone summary, and later directions |
| [Desktop design and implementation contract](DESKTOP_APP_PLAN.md) | Planned desktop workflows, shared TUI architecture, bilingual UI, and coding-agent acceptance gates |
| [Development task checklist](DESKTOP_APP_TASKS.md) | Dependency-ordered desktop implementation tasks and acceptance gates |

## History and release evidence

| Document | Purpose |
| --- | --- |
| [Published reports](../evals/reports/README.md) | Reviewed release evidence, including retained failures |
| [v0.3.4 release notes](../evals/reports/v0.3.4/RELEASE_NOTES.md) | Current release behavior, migration, and verification boundary |
| [v0.3.4 implementation plan](history/v0.3.4/IMPLEMENTATION_PLAN.md) | Completed development contract for unified file editing, CLI decomposition, reversible context controls, and terminal lifecycle repair |
| [v0.3.0 release notes](history/v0.3.0/RELEASE_NOTES.md) | First public npm distribution, explicit updates, and release boundaries |
| [v0.3.3 detailed implementation record](history/v0.3.3/LONG_SESSION_IMPLEMENTATION.md) | Historical Milestone 13.0–13.5 design, architecture, tests, and offline gates; not a release declaration |
| [Structured session history implementation](history/v0.3.3/STRUCTURED_SESSION_HISTORY.md) | Historical Milestone 14 design record; current behavior remains in source, tests, Sessions, and Architecture |
| [v0.1 acceptance contract](history/v0.1/ACCEPTANCE.md) | Historical first-release scope, limits, and gates |
| [Milestone 0–15 acceptance records](history/v0.3.4/MILESTONES.md) | Historical goals, acceptance criteria, and validation boundaries through v0.3.4 |

Current guides live in `docs/`, with Chinese mirrors in `docs/zh-CN/`. Completed
version plans and acceptance records belong in each language’s `history/<version>/`;
release evidence and code review snapshots belong in `evals/reports/<version>/`.

The [documentation catalog](catalog.json) controls roles and product-help packaging.
Only current product guides are packaged; development plans and historical records
are excluded. Source, tests, and current product guides define current behavior.

## Documentation conventions

- Commands are written from the repository root unless a page says otherwise.
- `pnpm forge ...` runs the development checkout; `forge ...` uses either the
  installed npm package or a checkout linked with `pnpm link:global`.
- Default tests and deterministic evaluations make no paid model request.
  Live-provider commands are always marked as opt-in.
- English pages are the canonical detailed guides. Chinese pages preserve the
  same commands, configuration names, limits, and security boundaries; some
  historical design records are intentionally condensed.
- API keys, tokens, complete local traces, and repository-sensitive output
  should never be pasted into documentation or issue reports.
- When a version plan is complete, archive both languages under `history/<version>/`, add a historical role banner, and preserve the original design body.
- When adding, moving, or deleting documents, update the catalog, bilingual navigation, and all repository links; avoid empty redirect pages for unreferenced old paths.

Before submitting documentation changes, run:

```bash
pnpm check:docs
```
