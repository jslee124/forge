# Architecture

## Status

This document describes the initial design direction. It is expected to change
as the first working milestones reveal better boundaries.

## Initial implementation decisions

These choices are fixed for the first implementation so development can begin.
They may be revisited through a small architecture decision record when working
code provides contrary evidence.

| Area | Initial decision | Reason |
| --- | --- | --- |
| Runtime | Node.js 24 LTS | Use a supported LTS runtime and current platform APIs |
| Package manager | pnpm 11.18.0 | Fast, strict dependency layout with workspace support |
| Module format | ESM only | Avoid maintaining dual ESM/CommonJS output |
| Repository shape | pnpm monorepo | Make runtime boundaries visible without separate repositories |
| Build | TypeScript project references with `tsc -b` | Enforce package direction without an initial bundler |
| CLI parsing | Commander | Small, mature process command and help parser |
| Interactive UI | Ink + React | Component rendering and keyboard input without moving runtime logic into the UI |
| Validation | Zod | Share runtime validation between configuration and tool inputs |
| Formatting and linting | Biome | One fast tool with a small configuration surface |
| Testing | Vitest | Fast TypeScript tests and straightforward fakes |
| First provider | DeepSeek through `@ai-sdk/deepseek` | Prove one provider path before generalizing |
| Initial model | `deepseek-v4-flash` | Current fast DeepSeek model with tool and thinking support |
| Process execution | Node.js `spawn`, `shell: false` | Keep program and arguments structured and avoid implicit shell parsing |

The root `package.json` is private and pins pnpm through `packageManager`. Every
workspace package uses `"type": "module"`. Dependency versions are pinned by
the lockfile rather than copied into design documents, except for the runtime
and package-manager baseline above.

### Monorepo layout

Packages are created when their milestone begins, not as empty placeholders:

```text
apps/
`-- cli/                    # @forge/cli: parsing, rendering, approval UI
packages/
|-- core/                   # @forge/core: loop, events, policy contracts
|-- codex-app-server/       # Official Codex JSON-RPC transport and auth boundary
|-- model-deepseek/         # @forge/model-deepseek: AI SDK translation
|-- model-openai/           # @forge/model-openai: Responses API translation
|-- auth/                   # provider-neutral API-key resolution
|-- tools/                  # @forge/tools: built-in tool implementations
`-- config/                 # @forge/config: configuration and context loading
fixtures/                   # Small repository tasks used by integration tests
`-- validation-bug/
evals/                      # Task manifests, graders, trial runner, reports
```

`evals/` is a private workspace package. Its live runner imports the real CLI
run boundary, copies one fixture into a fresh temporary workspace, applies a
narrow test approval channel, persists the normal run trace, and invokes the
external grader only after the Agent stops. Generated artifacts are ignored
until a reviewed report is selected for publication.

Milestone 0 creates only `apps/cli` and `packages/core`. Later milestones add
the provider, tools, configuration, fixtures, and evaluation workspaces. A
generic `shared` package is intentionally avoided.

### CLI and process conventions

The initial CLI uses these exit codes:

| Code | Meaning |
| --- | --- |
| `0` | Run completed and required verification succeeded |
| `1` | Unrecovered runtime, provider, or tool failure |
| `2` | Invalid CLI usage or configuration |
| `3` | Run stopped without success, including a configured limit |
| `4` | A required action was denied or no approval channel was available |
| `130` | User cancellation through Ctrl+C |

Tool failures may be returned to the model as observations and therefore do not
immediately determine the process exit code. Only the terminal run status does.
Ordinary user errors do not print stack traces unless debug output is enabled.

## System context

```text
User
 |
 v
CLI
 |
 v
Agent Runtime
 |              |                |               |                 |
 v              v                v               v                 v
Model Adapter   Context Loader   Plugin Host     Policy Kernel     Run Events
 |              |                |               |                 |
 v              v                v               v                 v
Auth Manager    Instructions     Contributions   Tool Executor     Terminal + Trace
 |
 v
AI SDK -> Model Provider
```

## Responsibilities

### CLI

The CLI is responsible for:

- Parsing commands and configuration
- Managing the persistent interactive session, multi-line editor, slash-command
  completion, and structured `@` file mentions
- Selecting the workspace
- Rendering streamed events and readable diffs
- Asking the user to approve sensitive actions
- Forwarding cancellation through an `AbortSignal`
- Choosing an appropriate process exit code

The CLI should not contain the agent loop or tool implementation logic.
Commander owns process-level commands, while Ink owns only the interactive
terminal presentation. React and Ink remain dependencies of `apps/cli` and must
not cross into `@forge/core`. File mentions carry workspace-relative paths to
the model; they do not bypass `read_file`, workspace validation, policy, or
trace events by injecting file contents automatically.

Each interactive prompt starts a fresh bounded run and approval-policy instance.
Only completed user and assistant text is carried into the next prompt. That
conversation is persisted as a session and can be restored after restart, while
tool continuation metadata and approvals remain scoped to the run that produced
them. See [Persistent Sessions and Run Traces](SESSIONS.md).

### Agent runtime

The runtime owns:

- Run state and step count
- Conversation messages
- The model/tool execution loop
- Provider-supplied reasoning blocks
- Stop conditions
- Tool-call validation and dispatch
- Approval-policy checks
- Project-context assembly
- Controlled plugin-hook orchestration
- Event emission
- Final run status

The runtime should depend on interfaces for model access, tools, approval, and
trace persistence. This keeps it independently testable.

### Model adapter

The initial adapter uses Vercel AI SDK and `@ai-sdk/deepseek` for streaming and
tool-call transport. It uses `deepseek-v4-flash` and explicitly enables thinking
mode so a provider default change cannot silently alter behavior.

The model adapter performs exactly one provider turn and maps the AI SDK full
stream into Forge model events. Forge controls the multi-step loop and does not
delegate it to `ToolLoopAgent`, `stopWhen`, or another prebuilt agent
abstraction. AI SDK tool definitions sent to the model do not receive direct
`execute` callbacks; Forge validates and executes tool calls only after the
policy kernel records a decision.

DeepSeek thinking-mode tool calls require the provider-returned reasoning
content to be preserved in subsequent tool-result turns. The adapter therefore
returns an opaque continuation record alongside observable Forge events. The
core may store and return that record to the same adapter, but it must not
reconstruct it from terminal text or discard provider metadata. An integration
test will cover this round trip.

When a provider returns reasoning or thinking content, the adapter preserves it
as a typed response part. The runtime exposes that content to the terminal and
trace pipeline. It does not invent reasoning for providers that do not return
it.

### Authentication manager

Authentication is separate from model transport. The model adapter asks an
authentication manager for request credentials instead of reading environment
variables or token files directly.

The native Forge Engine resolves `DEEPSEEK_API_KEY` or `OPENAI_API_KEY` through
one provider-neutral manager and uses provider-specific AI SDK adapters. The
separate Codex Engine starts the official Codex App Server over stdio JSON-RPC.
Forge initiates managed ChatGPT browser or device-code login, but Codex owns the
OAuth client identity, callback, tokens, persistence, refresh, and logout.

Codex App Server is a complete agent runtime rather than a raw model endpoint.
It therefore remains a separate engine instead of implementing Forge's
`ModelAdapter`. Forge dynamically reads `model/list`, validates the selected
reasoning effort, and streams Codex turn events, while Codex owns its tools,
sandbox, approvals, and conversation state.

Forge must not copy client credentials from another application, depend on
undocumented endpoints as a stable contract, or silently read credentials from
`~/.codex/auth.json`. See [Authentication](AUTHENTICATION.md).

### Project context loader

The project context loader first resolves `FORGE_HOME`, defaulting to the
operating system user's `~/.forge/`. It validates user configuration and then
resolves the canonical workspace and working directory. Ordinary configuration
merges from defaults, user configuration, project configuration, environment
variables, and explicit CLI flags, preserving provenance for every value. The
configuration schema marks user-only and strictness-only keys so project values
cannot pass through the ordinary override algorithm.

The loader reads optional user instructions from `~/.forge/AGENTS.md`, then
loads project `AGENTS.md` instructions from the repository root toward the
working directory, preferring `AGENTS.override.md` at each level. It preserves
all instruction paths in the run trace.

It also discovers portable `.agents/` resources and Forge-specific `.forge/`
configuration. Discovery does not execute a resource. Project-local executable
plugins under `.forge/plugins/` are handed to the plugin host only after the
workspace has been explicitly trusted.

User configuration may choose a supported permission profile. Project context
can influence prompts and make policy stricter, but it cannot grant permissions
or weaken the policy kernel. Secrets are resolved by the authentication manager
and never from project configuration. See [Project Context and Local
Customization](PROJECT_CONTEXT.md).

### Plugin host

The plugin host is an extension boundary, not the security authority. Trusted
plugins may:

- Register custom tools
- Register user commands
- Contribute prompt instructions
- Observe immutable run events
- Participate in selected lifecycle hooks
- Make policy decisions stricter

All custom tool calls still pass through the policy kernel and tool executor.
Plugins cannot convert a core `deny` into `allow` or bypass an approval request.

An in-process JavaScript plugin is trusted local code and can use Node.js APIs
directly. API-level capability declarations do not create real isolation. Strong
plugin isolation requires a separate process or operating-system sandbox and is
deferred.

### Tools

Every tool has:

- A unique name
- A concise model-facing description
- A Zod input schema
- An execution function
- A risk classification
- A structured result

The initial tools are planned as:

| Tool | Responsibility | Initial risk |
| --- | --- | --- |
| `list_files` | List a bounded part of the workspace | Read-only |
| `read_file` | Read a workspace file with output limits | Read-only |
| `search` | Search text within the workspace | Read-only |
| `create_file` | Exclusively create a new UTF-8 workspace file | Write |
| `apply_patch` | Apply a structured file change | Write |
| `run_command` | Spawn a program with structured arguments and limits | Variable |

Tools receive an explicit execution context instead of reading global process
state. The context includes the workspace root, abort signal, limits, and event
emitter.

### Approval policy

The policy evaluates an action before execution and returns one of:

```text
allow    Execute without user interaction
confirm  Ask the user before execution
deny     Do not execute
```

The first policy will consider:

- The canonical target path and whether it remains inside the workspace
- Whether an operation changes files
- Whether a command is destructive or otherwise sensitive
- Whether configured time, output, or call limits have been reached
- Whether an approval UI is available

The default policy is:

| Action | Default decision |
| --- | --- |
| Read, list, or search inside the workspace | Allow |
| First write inside the workspace | Confirm |
| Later workspace writes in the approved run scope | Allow |
| Any process command | Confirm |
| Built-in file operation outside the workspace | Deny in v0.1 |
| Approval-required action without an approval channel | Deny |

Symlinks must be resolved before the policy decision. A future release may add
narrow outside-workspace approvals, but v0.1 does not expose that capability.

`run_command` accepts a program and argument array and uses Node.js `spawn` with
`shell: false`; shell expressions such as pipelines and redirection are not a
v0.1 feature. Starting a process in the workspace still does not confine it to
that workspace. Until an OS-level sandbox exists, confirmation, timeout, output
limits, and trace records are safety controls but not filesystem or network
isolation.

This policy is an application safety boundary, not a replacement for a hardened
operating-system sandbox.

### Hooks, events, and traces

Forge separates behavior-changing hooks from immutable observation events:

- Lifecycle hooks have specific, typed return values.
- Policy contributions may change `allow` to `confirm` or `deny`, but never make
  a mandatory decision less strict.
- `RunEvent` values are immutable observations used by renderers, traces, and
  metrics.

Runtime behavior is represented as structured events. Candidate event types
include:

```text
run.started
model.started
model.reasoning
model.completed
tool.proposed
tool.approved
tool.denied
tool.started
tool.completed
tool.failed
file.changed
run.completed
run.failed
run.cancelled
```

Terminal rendering and JSONL persistence consume the same event stream. This
prevents the user-visible activity and stored trace from becoming two unrelated
systems.

Trace files must not store API keys or other known secrets.

### Sessions and runs

A session is a persistent user conversation. A run is one bounded invocation of
the agent loop for one prompt. One session can therefore contain multiple runs,
and each run has its own event trace, limits, policy instance, and terminal
status.

The session store belongs at the application boundary rather than inside the
model adapter or tool packages. It saves completed user/assistant turns and
ordered run IDs. It does not serialize provider continuation objects, pending
approvals, an active child process, or an in-progress tool call.

On resume, the CLI validates the saved canonical workspace, reloads current
configuration and instructions, restores completed conversation messages, and
starts a new run. This makes recovery deterministic without treating stale
permission state as authority.

## Core interfaces

The exact TypeScript types will be decided during implementation. The intended
boundaries are:

```ts
interface ModelAdapter {
  stream(
    request: ModelRequest,
    signal: AbortSignal,
  ): AsyncIterable<ModelStreamEvent>;
}

interface AuthenticationManager {
  resolve(provider: string, signal: AbortSignal): Promise<ModelCredential>;
  logout(provider: string): Promise<void>;
}

interface ForgeTool<Input, Output> {
  name: string;
  description: string;
  inputSchema: ZodType<Input>;
  risk: ToolRisk;
  execute(input: Input, context: ToolContext): Promise<ToolResult<Output>>;
}

interface ApprovalPolicy {
  evaluate(action: ProposedAction): Promise<ApprovalDecision>;
}

interface TraceWriter {
  append(event: RunEvent): Promise<void>;
}

interface SessionStore {
  create(workspace: WorkspaceContext): Promise<SessionSnapshot>;
  load(sessionId: string): Promise<SessionSnapshot>;
  list(workspaceRoot: string): Promise<readonly SessionSummary[]>;
  save(snapshot: SessionSnapshot): Promise<void>;
}
```

These are design sketches, not stable public APIs.

## Run lifecycle

```text
created
   |
   v
running <--------+
   |             |
   v             |
awaiting_approval|
   |             |
   +-------------+
   |
   +--> completed
   +--> failed
   +--> cancelled
   `--> limit_reached
```

Only terminal states may end a run. A natural-language claim of success does not
override a failed verification result recorded by the runtime.

## Dependency direction

```text
CLI ---------------------> Core interfaces
Native runtime ----------> Core interfaces
AI SDK adapter ----------> Core interfaces
Authentication manager --> Core interfaces
Project context loader --> Core interfaces
Tools -------------------> Core interfaces
Trace implementations ---> Core interfaces
Plugin host --------------> Core extension interfaces
```

The core should not import CLI rendering, a specific provider implementation, a
plugin implementation, or a future LangChain adapter.

## Planned testing strategy

- Unit tests for path validation, stop conditions, policy rules, and event state
- Policy tests for external paths, symlinks, missing UI, and decision precedence
- Tool tests using temporary workspaces
- Runtime tests using a deterministic fake model adapter
- Integration tests for AI SDK message and tool-call translation
- Authentication tests using fake credentials and refresh responses
- Context-loader tests for hierarchy, overrides, case sensitivity, size limits,
  canonical roots, and provenance
- Plugin-contract tests proving that hooks cannot weaken core decisions
- End-to-end tests on small fixture repositories

Real model calls should not be required for the default test suite.

## Deferred decisions

The following choices will be made only when a milestone needs them:

- SQLite schema and migration library
- Terminal UI framework
- HTTP server framework
- LangChain or LangGraph integration shape
- Operating-system-level sandboxing
- Restricted plugin process and capability enforcement
- Public support and compatibility requirements for ChatGPT subscription login
