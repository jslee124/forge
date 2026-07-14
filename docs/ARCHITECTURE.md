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
 |              |                |
 v              v                v
Model Adapter   Tool Executor    Trace Writer
 |              |                |
 v              v                v
AI SDK          Workspace        JSONL file
 |
 v
Model Provider
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
- Stop conditions
- Tool-call validation and dispatch
- Approval-policy checks
- Event emission
- Final run status

The runtime should depend on interfaces for model access, tools, approval, and
trace persistence. This keeps it independently testable.

### Model adapter

The initial adapter will use Vercel AI SDK for provider interoperability,
message types, streaming, and tool-call transport.

Forge will control the multi-step loop. It will not initially delegate the
entire runtime to a prebuilt agent abstraction.

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

- Whether a path remains inside the workspace
- Whether an operation changes files
- Whether a command is destructive or otherwise sensitive
- Whether configured time, output, or call limits have been reached

This policy is an application safety boundary, not a replacement for a hardened
operating-system sandbox.

### Events and traces

Runtime behavior is represented as structured events. Candidate event types
include:

```text
run.started
model.started
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

interface ForgeTool<Input, Output> {
  name: string;
  description: string;
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
Tools -------------------> Core interfaces
Trace implementations ---> Core interfaces
```

The core should not import CLI rendering, a specific provider implementation, or
a future LangChain adapter.

## Planned testing strategy

- Unit tests for path validation, stop conditions, policy rules, and event state
- Tool tests using temporary workspaces
- Runtime tests using a deterministic fake model adapter
- Integration tests for AI SDK message and tool-call translation
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
