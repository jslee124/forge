# Forge

Forge is a safe-by-default, observable, extensible, and evaluable coding agent
built with TypeScript.

It is a learning project and portfolio project focused on the engineering behind
coding agents: model interaction, tool execution, safety boundaries, execution
traces, plugins, and reproducible evaluations.

> Status: early design and development. Forge is not usable yet.

## Vision

Forge should eventually be able to accept a repository-level task such as:

```bash
forge run "Fix the failing tests"
```

It will inspect the workspace, use tools to read and modify code, run relevant
commands, react to failures, and stop only after it has verified the result or
reached a defined limit.

Or simply type `forge` to start an interactive session where you can ask the
agent to perform tasks and inspect model-provided reasoning, actions, tool calls,
and execution decisions.

```bash
forge
```

## Project goals

- Build the core agent loop instead of hiding it behind a high-level framework.
- Use Vercel AI SDK as the model integration layer.
- Execute filesystem and shell tools within explicit safety boundaries.
- Show reasoning or thinking content when the model provider returns it.
- Represent every model and tool action as a structured event.
- Save complete execution traces for inspection and replay.
- Evaluate behavior with reproducible coding tasks and automated graders.
- Keep the core runtime independent from any single model provider.
- Load repository guidance from the standard `AGENTS.md` hierarchy.
- Let trusted plugins extend Forge without weakening mandatory safeguards.

## Non-goals for the first version

- Multi-agent orchestration
- IDE extensions
- Browser automation
- Cloud deployment
- Long-term memory
- Autonomous Git pushes or pull requests
- Support for every model provider and agent framework

## Planned architecture

```text
CLI
 |
 v
Forge Agent Runtime
 |-- Model Adapter ------> Vercel AI SDK ------> Model Provider
 |-- Context Loader -----> AGENTS.md / .agents / .forge
 |-- Plugin Host --------> Tools / Commands / Controlled Hooks
 |-- Policy Kernel ------> Allow / Confirm / Deny
 |-- Tool Executor ------> Filesystem / Search / Patch / Shell
 `-- Run Events ---------> Terminal Output + JSONL Trace
```

The Forge runtime will own the execution loop, state transitions, stop
conditions, safety checks, and trace events. All built-in and plugin tools must
pass through the policy kernel. Framework integrations such as LangChain may be
added later as optional adapters and evaluation baselines.

## Documentation

- [Product definition](docs/PRODUCT.md)
- [Architecture](docs/ARCHITECTURE.md)
- [Authentication model](docs/AUTHENTICATION.md)
- [Project context and local customization](docs/PROJECT_CONTEXT.md)
- [Security model](docs/SECURITY.md)
- [Plugin model](docs/PLUGINS.md)
- [Roadmap](docs/ROADMAP.md)

## Development approach

Development is organized into small, testable milestones. Each milestone must
produce a runnable behavior and meet its acceptance criteria before the next one
begins.

The first milestone is intentionally small: send a prompt to a model and stream
the response in the terminal.

## License

No license has been selected yet.
