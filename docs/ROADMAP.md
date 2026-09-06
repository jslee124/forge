# Roadmap

[简体中文](zh-CN/ROADMAP.md) · [Documentation index](README.md)

## Current milestone

**Milestone 15, the v0.3.4 release target, is complete.** It unifies
model-facing file editing, decomposes the interactive CLI, makes context mode
changes reversible, and repairs terminal listener lifecycle. Automatic
compaction remains an explicit user opt-in. See the
[v0.3.4 implementation plan](history/v0.3.4/IMPLEMENTATION_PLAN.md).

## Working rules

- Complete one milestone before expanding the next one.
- Every milestone must produce runnable behavior.
- Acceptance criteria define completion, not the number of files written.
- Keep the default test suite independent from paid model calls.
- Add a workspace package only when a milestone needs it.
- Update this document when implementation teaches us that the plan is wrong.
- Use [the historical v0.1 specification](history/v0.1/ACCEPTANCE.md) as the v0.1 release contract.

## Current development

- [Desktop design and implementation contract](DESKTOP_APP_PLAN.md): desktop scope and architecture constraints.
- [Desktop development task checklist](DESKTOP_APP_TASKS.md): dependencies, deliverables, and acceptance gates.
- Plans do not establish implemented behavior; use source, tests, and recorded task status.

## Completed milestones

| Stage | Scope |
| --- | --- |
| 0–7 | Project foundation, model conversation, tools and agent loop, TUI, policy, persistence, and initial evaluation |
| 8–12 | Plugins, authentication, context budgets, compatible providers, Skills, and product help |
| 13–14 | Long sessions, approval UX, structured history, and faithful resume |
| 15 | v0.3.4 file editing, CLI decomposition, context controls, and lifecycle repair |

Detailed criteria are preserved in the [Milestone 0–15 historical acceptance records](history/v0.3.4/MILESTONES.md).
Versioned validation is in [release reports](../evals/reports/README.md).

## Later extensions

These items are intentionally unordered exploration directions, not delivery
commitments or a list of implemented capabilities:

- Broader evaluation tasks and graders
- Native non-OpenAI wire protocols such as Anthropic Messages or Gemini
- Narrow outside-workspace approvals
- A clearly warned `full-access` profile
- Optional shell-language execution
- LangChain runtime adapter and benchmark comparison
- LangGraph checkpoint experiment
- HTTP API and Server-Sent Events
- SQLite-backed session and run indexing
- Session branching and cross-machine synchronization
- Optional semantic or vector retrieval justified by context evaluations
- MCP integration
- Stronger process isolation
