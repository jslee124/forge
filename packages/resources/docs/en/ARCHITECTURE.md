# Architecture

简体中文 · Documentation index

Forge separates **who renders the UI**, **who orchestrates workflows**, **who decides policy and budgets**, and **who talks to model providers**. That separation keeps security rules testable without a terminal or Electron window, and keeps model-vendor quirks out of the agent loop.

## Layered workspace layout

The repository contains 15 workspace members across five layers (only `@jslee124/forge` in `apps/cli` publishes to npm; all `@forge/*` implementation packages remain private):

```text
Entry & UI          apps/cli (Ink TUI & CLI)     apps/desktop (Electron workbench)
                             \                       /
Orchestration                packages/application
                    (runs, sessions, slash commands, scheduler)
                                      |
Core & Contracts     packages/core · @forge/config · @forge/auth · @forge/plugin-api
                                      |
Adapters & I/O       tools · persistence · resources · model-{deepseek,openai,compat} · codex-app-server
                                      |
Verification         evals (deterministic fixtures, opt-in live trials, reports)
```

| Layer | Workspace members | Responsibility |
| --- | --- | --- |
| Entry & UI | `apps/cli`, `apps/desktop` | Parse commands, manage interactive terminal or Electron UI, render streams/diffs/approvals, handle signals. Desktop acceptance harnesses live separately under `apps/desktop/src/main/acceptance/`. |
| Orchestration | `packages/application` | Compose runs, persistent sessions, image normalization, slash-command catalog/parsing, startup resource scanning, and multi-session scheduling (`SessionScheduler`). |
| Core & Contracts | `packages/core`, `packages/config`, `packages/auth`, `packages/plugin-api` | Provider-neutral agent loop, approval policy kernel, context budgeting, run events, config merging & provenance, credential resolution, plugin API contract. |
| Capabilities & Adapters | `packages/tools`, `packages/persistence`, `packages/resources`, `packages/model-deepseek`, `packages/model-openai`, `packages/model-compat`, `packages/codex-app-server` | Bounded workspace/process tools, session schema v3 & redacted JSONL traces, Skill & plugin loading, single-turn model streaming, and Codex App Server stdio JSON-RPC integration. |
| Evaluation | `evals` | Offline deterministic contract suites, fixture repositories, opt-in live evaluations, and release reports. |

Dependency direction points strictly inward toward `@forge/core`. Core never imports Ink, React, Electron, CLI parsers, specific model SDKs, or plugin implementations.

## Two execution engines

Forge supports two execution engines with clean ownership boundaries:

```text
Prompt ─┬─► Native Forge Engine ──► @forge/core loop ─► @forge/model-* adapter (single turn)
        │                                             └─► Policy kernel + Forge tools + JSONL trace
        │
        └─► Codex Engine ─────────► @forge/codex-app-server ─► Official Codex App Server (stdio JSON-RPC)
                                        (owns its own tools, sandbox, approvals, and state)
```

- **Native Forge Engine**: Forge runs the multi-step agent loop (`runAgent`), enforces workspace path checks and approval policy before every side effect, streams provider reasoning when returned, executes built-in or trusted plugin tools, and writes structured JSONL traces.
- **Codex Engine**: Forge delegates execution to the official Codex App Server over stdio JSON-RPC. Forge passes the active prompt (and a bounded active history wrapper for multi-turn Forge sessions), validates supported reasoning effort via `model/list`, and renders turn events—while Codex owns its OAuth lifecycle, tools, sandbox, and approvals.

See Authentication for route selection and credential isolation rules.

## Inside a native run

### Modular agent runtime

Inside `packages/core/src/`, `runtime.ts` coordinates each run through focused single-purpose helpers:

| Module | Responsibility |
| --- | --- |
| `runtime.ts` | Run entrypoint (`runAgent`), step loop lifecycle, read-progress / invalid-action loop checks (`ReadProgressTracker`, `InvalidActionLoopTracker`), one-shot overflow recovery, stop conditions, and final status assembly |
| `runtime-conversation.ts` | Provider-neutral message formatting and canonical conversation projection (`runConversationMessages`, `canonicalExchange`, `canonicalDeltaWithOutcome`) |
| `runtime-step.ts` | Single model turn streaming (`consumeModelStep`), tool definition projection (`toModelToolDefinitions`), cache observation, and step error classification |
| `runtime-budget.ts` | Step request assembly, prompt-prefix cache tagging (`cacheControl`), context budgeting, threshold checks, and pre-step adapter-continuation compaction (`prepareModelStepRequest`) |
| `runtime-tools.ts` | Per-call input validation, duplicate-denied-call suppression, policy evaluation, approval flow, tool execution dispatch, and skill/docs domain events (`executeToolCallBatch`) |
| `runtime-events.ts` | `RunEvent` union types, run option/result/limit interfaces, default limit constants, and `exitCodeForRunStatus` (trace redaction and JSONL emission live in `packages/persistence`) |

### Model adapters and opaque continuation

Model adapters (`@forge/model-deepseek`, `@forge/model-openai`, `@forge/model-compat`) perform **one provider turn** per call and stream normalized events back to core—Forge never hands multi-step loop control to an external agent wrapper (`ToolLoopAgent` or auto-executing SDK callbacks).

Providers that support reasoning/thinking in tool-call loops (such as DeepSeek thinking mode) require provider reasoning parts to travel back across tool-result turns. Adapters return an **opaque continuation record** alongside normalized events; `@forge/core` passes that record back intact within the same run without inspecting vendor fields or reconstructing it from terminal output.

### Tools and safety boundaries

Built-in tools accept Zod-validated inputs, receive an explicit `ToolContext` (workspace root, `AbortSignal`, limits, event sink), and return structured errors rather than throwing raw strings:

| Tool | Role | Default risk | Notes |
| --- | --- | --- | --- |
| `list_files` | Bounded workspace file listing | Read-only | Sorted bounded directory traversal |
| `read_file` | Bounded file inspection | Read-only | Supports `startLine`/`lineCount`, encoding checks (`not_text`), `stale_file` detection, and complete non-truncated SHA-256 hashes |
| `search` | Literal text search | Read-only | Bounded scan budget, `include`/`exclude` globs, context lines (`mode: "literal"`) |
| `edit_file` | Create, exact replace, or full rewrite | Write | Flat `operation` enum; rewrites require matching the SHA-256 from a complete `read_file` |
| `run_command` | Spawn an external program | Variable | Uses Node `spawn` with `shell: false` (no shell pipelines or redirection) |

Checked-in example plugins under `examples/plugins/` additionally demonstrate `web_search`, `web_fetch` (both `network` risk), and `delegate_code_review` (host-managed non-recursive subagent, `model` risk).

### Policy kernel (`allow` / `confirm` / `deny`)

Every proposed tool action passes through the policy kernel before execution:

```text
Tool call proposed
       │
       ├──► Read / list / search inside workspace ──► allow (under default "safe" profile)
       ├──► First write inside workspace ────────────► confirm (subsequent run writes allowed if scoped)
       ├──► run_command / registered network tool ───► confirm on every call
       ├──► Built-in file access outside workspace ──► deny (after resolving symlinks)
       └──► Approval needed with no TTY/UI channel ──► deny
```

Plugin lifecycle hooks and project configuration may **tighten** an `allow` into `confirm` or `deny`, but can never weaken a policy decision. Remember: the policy kernel is an application-level safety boundary, not an operating-system sandbox—an approved `run_command` or a trusted in-process JavaScript plugin executes with Forge's local user privileges. See Security model.

## Context, instructions, and extensions

Configuration, instructions, Skills, and plugins follow strict trust boundaries before entering a run:

1. **Configuration (`@forge/config`)**: Merges defaults → user `~/.forge/config.json` → project `.forge/config.json` → environment variables → CLI flags, recording provenance (`forge config show`). Project configuration can lower budgets or enforce stricter policies, but cannot select models, store secrets, enable plugins, or loosen limits.
2. **Instructions (`AGENTS.md`)**: Loads optional user instructions (`~/.forge/AGENTS.md`) followed by workspace hierarchy `AGENTS.md` (or `AGENTS.override.md`). Resolved instructions are frozen per run so mid-run file edits cannot mutate the system prompt silently.
3. **Skills & Plugins (`@forge/resources`, `@forge/plugin-api`)**: Portable `.agents/skills` and bundled Skills are discovered as bounded metadata and loaded only on demand via `load_skill`. Project-local plugins under `.forge/plugins/` remain disabled until the workspace is explicitly trusted. Subagents declared by plugins are instantiated by the host with isolated history, single-level depth (no recursive delegation), and inherited parent policy. See Project context and Plugin authoring.

## Sessions, events, and traces

Terminal renderers, the Desktop UI, and JSONL persistence all subscribe to the same `RunEvent` stream (`run.started`, `model.reasoning`, `tool.proposed`, `tool.decision`, `tool.completed`, `run.completed`, etc.).

```text
created ──► running ◄──► awaiting_approval
               │
               ├──► completed
               ├──► failed
               ├──► cancelled
               ├──► denied
               └──► limit_reached
```

| CLI Exit Code | Run Status / Meaning |
| --- | --- |
| `0` | `completed` — Run completed and required verification succeeded |
| `1` | `failed` — Unrecovered runtime, provider, or tool failure |
| `2` | Invalid CLI usage or configuration |
| `3` | `limit_reached` — Run stopped without success, including a configured limit or no-progress stop |
| `4` | `denied` — A required action was denied or no approval channel was available |
| `130` | `cancelled` — User cancellation through Ctrl+C |

Forge keeps **sessions** and **runs** distinct:

- A **Session** (schema v3) stores durable user/assistant messages and completed tool-call/result pairs across restarts.
- A **Run** is a single bounded execution of the agent loop with its own step/tool budget, fresh `SessionApprovalStore`, and redacted JSONL trace.

Resuming a session validates the workspace path, reloads fresh config and `AGENTS.md`, and starts a new run—it never reactivates old approvals, unfinished tool calls, child processes, or opaque provider continuation state. See Sessions and traces and Context management.

## Verification strategy

Default automated tests and `pnpm eval:deterministic` never require paid model calls:

- Core runtime, policy, and context tests use deterministic fake adapters and temporary workspaces.
- Provider adapter integration tests validate streaming, tool-call pairing, reasoning preservation, and local HTTP routes.
- Cross-layer evaluation contracts under `evals/` test end-to-end tool recovery, workspace containment, session resume, and doc integrity (`pnpm check:docs`).
