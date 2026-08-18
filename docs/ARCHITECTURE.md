# Architecture

## Status

This document describes the initial design direction. It is expected to change
as the first working milestones reveal better boundaries.

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
- Selecting the workspace
- Rendering streamed events
- Asking the user to approve sensitive actions
- Forwarding cancellation through an `AbortSignal`
- Choosing an appropriate process exit code

The CLI should not contain the agent loop or tool implementation logic.

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

The initial adapter will use Vercel AI SDK for provider interoperability,
message types, streaming, and tool-call transport.

Forge will control the multi-step loop. It will not initially delegate the
entire runtime to a prebuilt agent abstraction.

When a provider returns reasoning or thinking content, the adapter preserves it
as a typed response part. The runtime exposes that content to the terminal and
trace pipeline. It does not invent reasoning for providers that do not return
it.

### Authentication manager

Authentication is separate from model transport. The model adapter asks an
authentication manager for request credentials instead of reading environment
variables or token files directly.

The initial implementation supports API keys. A later experimental adapter may
support Codex-compatible Sign in with ChatGPT if OpenAI provides or authorizes a
suitable public integration for third-party clients.

Forge must not copy client credentials from another application, depend on
undocumented endpoints as a stable contract, or silently read credentials from
`~/.codex/auth.json`. See [Authentication](AUTHENTICATION.md).

### Project context loader

The project context loader resolves the canonical workspace and working
directory before the first model call. It loads `AGENTS.md` instructions from
the repository root toward the working directory, preferring
`AGENTS.override.md` at each level, and preserves path provenance in the run
trace.

It also discovers portable `.agents/` resources and Forge-specific `.forge/`
configuration. Discovery does not execute a resource. Project-local executable
plugins under `.forge/plugins/` are handed to the plugin host only after the
workspace has been explicitly trusted.

Project context can influence prompts and make policy stricter, but it cannot
grant permissions or weaken the policy kernel. See [Project Context and Local
Customization](PROJECT_CONTEXT.md).

### Plugin host

The plugin host is an extension boundary, not the security authority. It may
eventually let trusted plugins:

- Register custom tools
- Register user commands
- Contribute prompt instructions
- Observe immutable run events
- Participate in selected lifecycle hooks
- Make policy decisions stricter

All custom tool calls still pass through the policy kernel and tool executor.
Plugins cannot convert a core `deny` into `allow` or bypass an approval request.

An in-process TypeScript plugin is trusted local code and can use Node.js APIs
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
| `apply_patch` | Apply a structured file change | Write |
| `run_command` | Execute an allowed command with limits | Variable |

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
| First patch inside the workspace | Confirm |
| Later workspace patches in the approved session scope | Allow |
| Any shell command | Confirm |
| Exact file operation outside the workspace | Confirm |
| Approval-required action without an approval channel | Deny |

Outside-workspace approval is scoped to the canonical path and requested
operation. Broad or permanent approval is not implied. Symlinks must be resolved
before the policy decision.

Starting a shell command in the workspace does not confine it to that workspace.
Until an OS-level sandbox exists, confirmation, timeout, output limits, and trace
records are safety controls but not filesystem or network isolation.

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

## Core interfaces

The exact TypeScript types will be decided during implementation. The intended
boundaries are:

```ts
interface ModelAdapter {
  generate(request: ModelRequest): Promise<ModelResponse>;
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

- Monorepo versus a single package
- SQLite schema and migration library
- Terminal UI framework
- HTTP server framework
- LangChain or LangGraph integration shape
- Operating-system-level sandboxing
- Restricted plugin process and capability enforcement
- Public support and compatibility requirements for ChatGPT subscription login
