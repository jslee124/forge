# Forge Documentation

[简体中文](zh-CN/README.md) · [Project README](../README.md)

Forge's documentation is organized around what a reader is trying to do. Start
with the shortest path below instead of reading every page in order.

## Choose a path

| I want to... | Start here | Then read |
| --- | --- | --- |
| Run Forge for the first time | [Getting started](product/start/GETTING_STARTED.md) | [CLI UI](product/reference/CLI_UI.md) · [Authentication](product/start/AUTHENTICATION.md) |
| Try the desktop preview | [Desktop preview](product/operations/DESKTOP.md) | [Windows installation](../apps/desktop/INSTALL-WINDOWS.md) · [macOS installation](../apps/desktop/INSTALL.md) · [Preview 4 evidence](../evals/reports/desktop-0.3.4-preview.4/README.md) |
| Configure a model, limits, or context behavior | [Configuration](product/start/CONFIGURATION.md) | [Authentication](product/start/AUTHENTICATION.md) · [Context management](product/concepts/CONTEXT_MANAGEMENT.md) |
| Understand what Forge can and cannot protect | [Security model](product/concepts/SECURITY_MODEL.md) | [Architecture](product/concepts/ARCHITECTURE.md) |
| Resume a conversation or inspect a run | [Sessions and traces](product/reference/SESSIONS.md) | [CLI UI](product/reference/CLI_UI.md) |
| Add project instructions or a portable Skill | [Project context](product/reference/PROJECT_CONTEXT.md) | [Security model](product/concepts/SECURITY_MODEL.md) |
| Try Telegram from the development checkout | [Chat channels (experimental)](product/operations/CHAT_CHANNELS.md) | [Security model](product/concepts/SECURITY_MODEL.md) |
| Build a plugin or study an extension example | [Plugin authoring](product/reference/PLUGINS.md) | [Architecture](product/concepts/ARCHITECTURE.md) |
| Reproduce the published evidence | [Evaluation](development/EVALUATION.md) | [Versioned reports](../evals/reports/README.md) |
| Contribute to Forge | [Contributing](../CONTRIBUTING.md) | [Architecture](product/concepts/ARCHITECTURE.md) · [Roadmap](development/ROADMAP.md) |
| Publish an npm release | [npm release guide](product/operations/RELEASING.md) | [Evaluation](development/EVALUATION.md) · [Security model](product/concepts/SECURITY_MODEL.md) |
| Review the current release | [Latest release evidence](../evals/reports/README.md#latest) | [Published reports](../evals/reports/README.md) · [npm release guide](product/operations/RELEASING.md) |
| Review the first public release | [v0.3.0 release notes](history/v0.3.0/RELEASE_NOTES.md) | [npm release guide](product/operations/RELEASING.md) |
| Diagnose a problem | [Troubleshooting](product/start/TROUBLESHOOTING.md) | The topic-specific guide linked from the symptom |

## Use Forge

| Guide | What it answers |
| --- | --- |
| [Getting started](product/start/GETTING_STARTED.md) | How do I install from source, choose an access route, verify setup, and complete a first task? |
| [Desktop preview](product/operations/DESKTOP.md) | What does the current macOS prerelease support, and what remains unverified? |
| [CLI UI](product/reference/CLI_UI.md) | Which slash commands and keyboard controls are available? How do approvals, file mentions, and images work? |
| [Configuration](product/start/CONFIGURATION.md) | Where are settings loaded from, which source wins, and which fields may a repository control? |
| [Authentication](product/start/AUTHENTICATION.md) | How do API keys, compatible endpoints, and ChatGPT subscription access differ? |
| [Sessions and traces](product/reference/SESSIONS.md) | What is persisted, what does resume restore, and how do I inspect a run? |
| [Troubleshooting](product/start/TROUBLESHOOTING.md) | What should I check when startup, credentials, approvals, plugins, images, or the terminal misbehave? |
| [npm release guide](product/operations/RELEASING.md) | How is the single public CLI package built, verified, published, updated, and rolled back? |

## Understand Forge

| Guide | Document type | What it covers |
| --- | --- | --- |
| [Architecture](product/concepts/ARCHITECTURE.md) | Current architecture and rationale | Package boundaries, both engines, the runtime loop, policy, events, and dependency direction |
| [Security model](product/concepts/SECURITY_MODEL.md) | Implemented security contract | Workspace, process, network, plugin, credential, session, and delegated-run boundaries |
| [Context management](product/concepts/CONTEXT_MANAGEMENT.md) | Implemented design record | Budget accounting, checkpoints, overflow recovery, invariants, and evaluation gates |
| [Product definition](product/concepts/PRODUCT.md) | Product rationale | Target users, principles, scope, and deliberate non-goals |

## Decisions

Accepted [decision records](decisions/) explain why the system is shaped this way.
They are append-only: a changed decision is superseded by a new record instead of
being edited in place. Records are English-only and are not packaged as product
help.

| Record | Decision |
| --- | --- |
| [ADR-0001](decisions/0001-gateway-single-owner-workspace.md) | The chat gateway serves one owner and one workspace |

## Extend Forge

| Guide | What it covers |
| --- | --- |
| [Project context](product/reference/PROJECT_CONTEXT.md) | `AGENTS.md`, `.agents/skills`, `.forge/`, `~/.forge/`, and instruction precedence |
| [Plugin authoring](product/reference/PLUGINS.md) | Manifest v1, activation API, tools, commands, policy restrictions, observers, and host-managed subagents |
| [Example plugins](../examples/plugins/) | Custom tools, stricter policy, web tools, MCP stdio, to-dos, and a read-only code-review subagent |

`web_search` and `web_fetch` are optional example-plugin tools. They are not
built-in Forge defaults. Project plugins are trusted in-process code; manifest
capabilities and per-tool approval are not an operating-system sandbox.

## Current development

Plans and task lists define development contracts, not implemented capabilities.
Use source, tests, and recorded acceptance results to establish completion.

| Document | Purpose |
| --- | --- |
| [Evaluation guide](development/EVALUATION.md) | Run deterministic evidence and explicit opt-in live trials |
| [Roadmap](development/ROADMAP.md) | Current development, completed milestone summary, and later directions |
| [Chat channels intent](development/CHAT_CHANNELS_INTENT.md) | Proposed 0.4.0 outcomes, scope, and product decisions |
| [Chat channels specification](development/CHAT_CHANNELS_SPEC.md) | Proposed Telegram gateway contracts, security, recovery, and acceptance |

## History and release evidence

| Document | Purpose |
| --- | --- |
| [Published reports](../evals/reports/README.md) | Reviewed release evidence, including retained failures |
| [v0.4.0 release verification](../evals/reports/v0.4.0/RELEASE_VERIFICATION.md) | Current stable release scope, evidence, and remaining limits |
| [v0.3.4 release notes](../evals/reports/v0.3.4/RELEASE_NOTES.md) | v0.3.4 user-visible changes, migration, and verification boundary |
| [v0.3.4 implementation plan](history/v0.3.4/IMPLEMENTATION_PLAN.md) | Completed development contract for unified file editing, CLI decomposition, reversible context controls, and terminal lifecycle repair |
| [v0.3.0 release notes](history/v0.3.0/RELEASE_NOTES.md) | First public npm distribution, explicit updates, and release boundaries |
| [v0.3.3 detailed implementation record](history/v0.3.3/LONG_SESSION_IMPLEMENTATION.md) | Historical Milestone 13.0–13.5 design, architecture, tests, and offline gates; not a release declaration |
| [Structured session history implementation](history/v0.3.3/STRUCTURED_SESSION_HISTORY.md) | Historical Milestone 14 design record; current behavior remains in source, tests, Sessions, and Architecture |
| [v0.1 acceptance contract](history/v0.1/ACCEPTANCE.md) | Historical first-release scope, limits, and gates |
| [Milestone 0–15 acceptance records](history/v0.3.4/MILESTONES.md) | Historical goals, acceptance criteria, and validation boundaries through v0.3.4 |
| [Desktop implementation contract](history/desktop-0.3.4-preview.2/DESKTOP_APP_PLAN.md) | Historical desktop scope and coding-agent handoff |
| [Desktop D01–D13 checklist](history/desktop-0.3.4-preview.2/DESKTOP_APP_TASKS.md) | Historical task completion and acceptance record |
| [Desktop D01 baseline](history/desktop-0.3.4-preview.2/DESKTOP_BASELINE.md) | Historical toolchain and architecture snapshot |

## Directory layout

| Directory | Role | Meaning |
| --- | --- | --- |
| `product/start/` | current-product | Install, configure, authenticate, and recover from problems |
| `product/reference/` | current-product | Commands, manifests, instruction precedence, and persistence contracts |
| `product/concepts/` | current-product | Why the system is shaped this way and where its boundaries are |
| `product/operations/` | current-product | Releasing, distributing, and running Forge |
| `development/` | current-development | Roadmap, evaluation, and proposals that are not shipped behavior |
| `decisions/` | decision | Append-only records of hard-to-reverse choices |
| `history/` | historical | Versioned design and acceptance snapshots; load only when relevant |
| `zh-CN/` | mirror | Same layout as above, in Chinese |

`product/` and `development/` carry their own `AGENTS.md` with directory-specific
rules. Chinese mirrors repeat the same subdirectory path, so
`product/start/GETTING_STARTED.md` pairs with
`zh-CN/product/start/GETTING_STARTED.md`.

Current guides live in `docs/`, with Chinese mirrors in `docs/zh-CN/`. Completed
version plans and acceptance records belong in each language’s `history/<version>/`;
desktop preview implementation records use `history/desktop-<version>/`;
release evidence and code review snapshots belong in `evals/reports/<version>/`.

The [documentation catalog](catalog.json) controls roles and product-help packaging.
Only current product guides are packaged; development plans, historical records, and
decision records are excluded. Source, tests, and current product guides define
current behavior. `pnpm check:docs` also verifies that every page is reachable from
an entry point and that every published report directory is listed in
`evals/reports/README.md`.

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
- When a design decision becomes hard to reverse, add `decisions/<NNNN>-<slug>.md` with Context, Decision, Alternatives, and Consequences sections. Declare its status under a `## Status` heading and in the catalog; change that status only to supersede the record.
- Every page must be reachable by following links from a documentation entry point. `README.md`, `AGENTS.md`, `SKILL.md`, and skill reference files are entries; anything else needs an index link.
- Relative links are rewritten to plain text when a product page is packaged, so a link that must stay clickable inside packaged product help uses an absolute `https://github.com/jslee124/forge/blob/<branch>/...` URL. `pnpm check:docs` does not validate those, so update them by hand when a target moves.
- A file referenced that way from published release notes or from shipped packaged help is pinned in place. `pnpm check:docs` resolves every `blob/<branch>/<path>` URL in the repository and in `.github/releases`, so a moved or deleted target fails the build; branch targets are resolved against the worktree and tag or commit targets against that git object. Restore the path, leave a redirect, or correct the link instead of moving the file.
- Markdown outside `docs/` is owned by its component directory: every file under `apps/` must be listed in that directory's `AGENTS.md` or `README.md` index.
- When adding, moving, or deleting documents, update the catalog, bilingual navigation, and all repository links; avoid empty redirect pages for unreferenced old paths.

Before submitting documentation changes, run:

```bash
pnpm check:docs
```
