# Product Definition

## Summary

Forge is a lightweight terminal coding agent that can inspect a local codebase,
use tools, modify files, run commands, and adapt its next action to the observed
result.

Its distinguishing feature is transparency. A developer should be able to see
what Forge did, why execution stopped, how much it cost, and whether the result
passed an objective evaluation.

## Target users

### Primary user

A developer who wants to understand and experiment with the internal behavior
of a coding agent.

### Secondary user

A developer who wants a small, inspectable coding assistant for local tasks and
prefers explicit behavior over a large, opaque feature set.

## Core use case

```bash
forge run "Add input validation and update the tests"
```

The expected user journey is:

1. Forge validates its configuration and workspace.
2. Forge asks the model to choose the next action.
3. The model uses tools to inspect relevant files.
4. Forge checks each proposed action against its safety policy.
5. Forge executes approved actions and records their results.
6. The model uses those results to decide what to do next.
7. Forge modifies the code and runs an appropriate verification command.
8. Forge stops with a truthful summary, or explains why it could not finish.

## Product principles

### Transparent

The terminal should show meaningful model and tool activity without exposing
private chain-of-thought. A structured trace should preserve the observable
execution trajectory for later inspection.

### Safe by default

Forge should restrict filesystem access to the selected workspace, limit
commands and execution time, and require approval for risky operations.

### Verifiable

Forge should not treat a plausible final message as proof of completion. When a
task can be verified with tests, type checking, linting, or another deterministic
check, Forge should run that check and report its real result.

### Framework-aware, not framework-owned

Forge will use established libraries where they remove incidental complexity,
but its central runtime concepts should remain visible and independently
testable.

### Small before broad

A narrow, reliable workflow is more valuable than many incomplete features.

## Initial feature set

The first useful version will include:

- A TypeScript command-line interface
- Streaming model responses through Vercel AI SDK
- A multi-step agent loop with explicit stop conditions
- Tools for listing, reading, searching, patching, and running commands
- Workspace path validation
- Command timeout and cancellation
- Approval decisions for sensitive actions
- Structured terminal events and JSONL traces
- Automated tests for the runtime and tools

## Success criteria for v0.1

Forge v0.1 is successful when it can complete a small repository task from end
to end:

1. Inspect more than one relevant file.
2. Make a targeted code change.
3. Run an automated verification command.
4. React to a failed verification instead of immediately stopping.
5. Stop after success or a configured limit.
6. Stay within the selected workspace.
7. Produce a trace consistent with its real actions.
8. Produce a final summary consistent with the actual file changes and command
   results.

## Out of scope for v0.1

- Multiple cooperating agents
- Graphical or IDE interfaces
- Remote execution
- Persistent semantic memory
- Retrieval-augmented generation
- MCP server discovery
- Automatic commits, pushes, or pull requests
- Production-grade operating-system sandboxing

## Future portfolio direction

After the native runtime is reliable, Forge may add:

- A reproducible evaluation suite with tasks, trials, graders, and reports
- A LangChain or LangGraph runtime adapter evaluated on the same tasks
- An HTTP API with Server-Sent Events, cancellation, and human approval
- SQLite-backed run metadata and resumable sessions

These are future extensions, not requirements for beginning implementation.
