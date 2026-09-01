# Product Definition

[简体中文](zh-CN/PRODUCT.md) · [Documentation index](README.md)

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

## Shipped product surface

The v0.3.4 release includes:

- A TypeScript command-line interface
- A multi-line interactive terminal UI with slash-command discovery,
  workspace-file mentions, and readable diff review
- Native DeepSeek and OpenAI API adapters, configured OpenAI-compatible routes,
  and a separate ChatGPT-subscription path through Codex App Server
- Streaming model responses through the active provider adapter
- A multi-step agent loop with explicit stop conditions
- User-wide configuration through `~/.forge/config.json`
- Hierarchical repository instructions through `AGENTS.md`
- Inspectable configuration provenance through `forge config show`
- Tools for listing, reading, searching, unified guarded file editing, and
  running commands
- Workspace path validation
- Command timeout and cancellation
- Approval decisions for sensitive actions
- Visible provider-supplied reasoning when available
- Structured terminal events and JSONL traces
- Persistent local sessions that can be resumed after restarting Forge
- Canonical completed tool-call/result history across resume without restoring
  approvals, pending execution, or provider continuation state
- Context budgeting, manual checkpoints, opt-in automatic compaction, scoped
  in-memory permission grants, and prompt-cache observations
- Versioned product documentation, portable Skills, and trusted local plugins
- Automated tests for the runtime and tools
- A canonical fixture task, deterministic recovery scenario, and reproducible
  release evaluation

## Historical v0.1 baseline

Forge v0.1 established the concrete release gates in [v0.1 Acceptance and
Evaluation](history/v0.1/ACCEPTANCE.md), including a small repository task from
end to end:

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

## Current limitations

- Graphical or IDE interfaces
- Remote execution
- Persistent semantic memory
- Retrieval-augmented generation
- MCP server discovery
- Third-party plugin package installation
- Automatic commits, pushes, or pull requests
- Production-grade operating-system sandboxing
- Native Anthropic Messages or Gemini protocols
- General recursive multi-agent orchestration; plugin-declared subagents are
  bounded, host-managed, and non-recursive

Forge does support an MCP stdio example plugin, but does not discover arbitrary
MCP servers as a built-in default. Trusted plugins and approved child processes
run with the local privileges of Forge; policy checks are not an OS sandbox.

## Later direction

Later work may add:

- A broader evaluation suite with more tasks, trials, graders, and reports
- A LangChain or LangGraph runtime adapter evaluated on the same tasks
- An HTTP API with Server-Sent Events, cancellation, and human approval
- SQLite-backed indexing, session branching, and cross-machine synchronization

These are directions, not claims about current behavior. The
[Roadmap](ROADMAP.md) is the completion contract for work that is actually
scheduled.
