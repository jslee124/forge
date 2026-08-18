# Product Definition

## Summary

Forge is a lightweight, safe-by-default terminal coding agent that can inspect a
local codebase, use tools, modify files, run commands, and adapt its next action
to the observed result. Trusted plugins can extend its capabilities without
replacing mandatory runtime safeguards.

Its distinguishing feature is transparency. A developer should be able to see
model-provided reasoning when available, what Forge did, why execution stopped,
how much it cost, and whether the result passed an objective evaluation.

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
2. Forge merges user settings from `~/.forge/` with applicable project settings
   and instructions, recording their source paths.
3. Forge asks the model to choose the next action.
4. The model uses tools to inspect relevant files.
5. Forge checks each proposed action against its safety policy.
6. Forge asks for approval when an action crosses a configured boundary.
7. Forge executes approved actions and records their results.
8. The model uses those results to decide what to do next.
9. Forge modifies the code and runs an appropriate verification command.
10. Forge stops with a truthful summary, or explains why it could not finish.

## Product principles

### Transparent

The terminal should show meaningful model and tool activity. Reasoning or
thinking content returned by the model provider should be visible to the user by
default and represented honestly as provider-supplied content. If a model does
not return reasoning content, Forge must not fabricate or imply access to it. A
structured trace should preserve the observable execution trajectory for later
inspection.

### Safe by default

Forge should restrict filesystem access to the selected workspace, limit
commands and execution time, and require approval for risky operations.

Read-only operations inside the workspace may run automatically. The first
workspace write requires approval by default, every process command requires
approval by default, and built-in file tools deny operations outside the
workspace in v0.1. In non-interactive operation, an action that requires
approval is denied unless a matching narrow approval was supplied in advance.

### Verifiable

Forge should not treat a plausible final message as proof of completion. When a
task can be verified with tests, type checking, linting, or another deterministic
check, Forge should run that check and report its real result.

### Framework-aware, not framework-owned

Forge will use established libraries where they remove incidental complexity,
but its central runtime concepts should remain visible and independently
testable.

### Extensible without weakening safeguards

Plugins may add tools, commands, prompt contributions, and controlled lifecycle
hooks. They must not turn a core `deny` into `allow`, bypass approval, or replace
the policy kernel. Trusted in-process plugins still execute as local code and
therefore require an explicit trust decision.

### Small before broad

A narrow, reliable workflow is more valuable than many incomplete features.

## Initial feature set

The first useful version will include:

- A TypeScript command-line interface
- A multi-line interactive terminal UI with slash-command discovery,
  workspace-file mentions, and readable diff review
- DeepSeek as the first provider, authenticated with `DEEPSEEK_API_KEY`
- Streaming model responses through Vercel AI SDK and `@ai-sdk/deepseek`
- A multi-step agent loop with explicit stop conditions
- User-wide configuration through `~/.forge/config.json`
- Hierarchical repository instructions through `AGENTS.md`
- Inspectable configuration provenance through `forge config show`
- Tools for listing, reading, searching, patching, and running commands
- Workspace path validation
- Command timeout and cancellation
- Approval decisions for sensitive actions
- Visible provider-supplied reasoning when available
- Structured terminal events and JSONL traces
- Automated tests for the runtime and tools
- A canonical fixture task, deterministic recovery scenario, and reproducible
  release evaluation

## Success criteria for v0.1

Forge v0.1 is successful when it meets the concrete release gates in
[v0.1 Acceptance and Evaluation](V0.1_SPEC.md), including a small repository
task from end to end:

1. Inspect more than one relevant file.
2. Make a targeted code change.
3. Run an automated verification command.
4. Demonstrate recovery from a failed verification in a deterministic runtime
   scenario.
5. Stop after success or a configured limit.
6. Deny built-in file operations outside the selected workspace.
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
- Third-party plugin package installation
- Automatic commits, pushes, or pull requests
- Production-grade operating-system sandboxing

## Future portfolio direction

After the native runtime is reliable, Forge may add:

- A broader evaluation suite with more tasks, trials, graders, and reports
- A trusted TypeScript plugin API with project-trust checks
- Portable project skills under `.agents/skills/`
- Forge-specific project configuration and plugins under `.forge/`
- OpenAI API-key authentication and, when supported by an appropriate public
  integration, Codex-compatible Sign in with ChatGPT
- A LangChain or LangGraph runtime adapter evaluated on the same tasks
- An HTTP API with Server-Sent Events, cancellation, and human approval
- SQLite-backed run metadata and resumable sessions

These are future extensions, not requirements for beginning implementation.
