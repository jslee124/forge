# Forge

Forge is a safe-by-default, observable, extensible, and evaluable coding agent
built with TypeScript.

It is a learning project and portfolio project focused on the engineering behind
coding agents: model interaction, tool execution, safety boundaries, execution
traces, plugins, and reproducible evaluations.

> Status: Milestone 6 complete. Forge supports bounded coding runs, a multi-line
> Ink terminal, versioned configuration and instructions, explicit permission
> profiles, versioned JSONL traces, run inspection, and resumable local sessions.
> Evaluation and the first reproducible release are next.

## Vision

Forge should eventually be able to accept a repository-level task such as:

```bash
forge run "Fix the failing tests"
```

It will inspect the workspace, use tools to read and modify code, run relevant
commands, react to failures, and stop only after it has verified the result or
reached a defined limit.

Type `forge` to start an interactive session where you can ask the agent to
perform tasks and inspect model-provided reasoning, actions, tool calls, and
execution decisions.

```bash
forge
```

## Project goals

- Build the core agent loop instead of hiding it behind a high-level framework.
- Use Vercel AI SDK as the model integration layer.
- Execute filesystem tools and child processes within explicit safety boundaries.
- Show reasoning or thinking content when the model provider returns it.
- Represent every model and tool action as a structured event.
- Save complete execution traces for inspection and replay.
- Evaluate behavior with reproducible coding tasks and automated graders.
- Keep the core runtime independent from any single model provider.
- Load user-wide settings and instructions from `~/.forge/`.
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
 |-- Model Adapter ------> Vercel AI SDK ------> DeepSeek (first provider)
 |-- Context Loader -----> ~/.forge / AGENTS.md / .agents / project .forge
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
- [Interactive CLI UI](docs/CLI_UI.md)
- [Authentication model](docs/AUTHENTICATION.md)
- [Project context and local customization](docs/PROJECT_CONTEXT.md)
- [Security model](docs/SECURITY.md)
- [Persistent sessions and run traces](docs/SESSIONS.md)
- [Plugin model](docs/PLUGINS.md)
- [v0.1 acceptance and evaluation specification](docs/V0.1_SPEC.md)
- [Roadmap](docs/ROADMAP.md)

## Initial technical baseline

- Node.js 24 LTS
- pnpm workspaces, pinned through the root `packageManager` field
- ESM-only TypeScript monorepo
- TypeScript project references and `tsc -b` for builds
- Commander for CLI parsing
- Ink and React for the interactive terminal UI
- Zod for runtime schemas
- Biome for formatting and linting
- Vitest for tests
- Vercel AI SDK with `@ai-sdk/deepseek`
- `deepseek-v4-flash` as the initial model, with thinking mode selected
  explicitly rather than inherited from provider defaults

The root package is private. Publishable package boundaries will only be added
when a milestone needs them; the monorepo will not begin with empty placeholder
packages.

## Development

Prerequisites:

- Node.js 24 LTS
- pnpm 11.18.0

Install dependencies:

```bash
pnpm install
```

Run the CLI scaffold:

```bash
pnpm forge --version
pnpm forge --help
```

Start an interactive session from the repository:

```bash
export DEEPSEEK_API_KEY="your-api-key"
pnpm forge
```

The interactive prompt persists completed user/assistant turns under
`$FORGE_HOME/sessions/`. Continue one after restart with `forge resume <id>`,
`forge resume --last`, or the interactive `/resume` picker. Each prompt remains
a separate bounded run with fresh policy and approval state; pending tool calls,
provider continuations, and command approvals are never restored.
Available commands are `/help`, `/clear`, `/resume`, and `/exit`. Ctrl+C cancels
an active task and returns to the prompt; press it again to exit.

The [interactive CLI UI](docs/CLI_UI.md) supports Shift+Enter or Ctrl+J for a
newline, live `/` command completion, and bounded fuzzy `@` workspace-file
selection. A selected path is sent to the model as an explicit reference; the
model still reads its contents through the normal `read_file` tool. File-write
approval shows a colored, line-numbered diff with a no-color fallback.

Some macOS terminals, including the VS Code integrated terminal, send the same
byte for Enter and Shift+Enter. Forge cannot distinguish those keys at the TTY
boundary, so Ctrl+J works as the portable newline shortcut. To make Shift+Enter
send that shortcut in VS Code, open **Preferences: Open Keyboard Shortcuts
(JSON)** and add:

```json
{
  "key": "shift+enter",
  "command": "workbench.action.terminal.sendSequence",
  "when": "terminalFocus",
  "args": { "text": "\u000a" }
}
```

To make the development build available as `forge` globally:

```bash
pnpm link:global
forge
```

The link points to this checkout. Run `pnpm build` after code changes, and use
`pnpm unlink:global` to remove it.

Send one prompt to DeepSeek:

```bash
export DEEPSEEK_API_KEY="your-api-key"
pnpm forge ask "Explain what this repository is for"
```

Run a repository coding task:

```bash
pnpm forge run "Inspect the README and package files, then summarize the project"
```

Forge uses the `safe` permission profile by default: reads are automatic, while
the first workspace write and every process command require confirmation. To
allow workspace file writes without per-run write approval, select
`workspace-write`; process commands still require confirmation:

```bash
pnpm forge run "Fix the failing tests" --permission-profile workspace-write
```

`forge run` lets the model propose `list_files`, `read_file`, `search`,
`create_file`, `apply_patch`, and `run_command` calls. Forge validates each
call, records an `allow`, `confirm`, or `deny` policy decision, executes
approved tools itself, and returns structured results to the next model step.
File creation refuses to replace an existing path. The first workspace write
shows a diff and requires confirmation; that approval covers later workspace
writes only in the same run. Every process command is shown and confirmed
separately. Commands use structured arguments with no shell, a 60-second
maximum timeout, and a 65,536-byte result limit. The run stops after at most 12
model steps or 40 tool calls.

Forge uses `deepseek-v4-flash` with thinking enabled by default. Both settings
are explicit and can be changed for one invocation:

```bash
pnpm forge ask "Answer briefly" \
  --model deepseek-v4-flash \
  --thinking disabled
```

`FORGE_MODEL` and `FORGE_THINKING` provide environment-level defaults. Command
line flags take precedence. Valid thinking modes are `enabled` and `disabled`.
Reasoning is labeled separately only when DeepSeek returns reasoning content;
Forge does not synthesize it. Token usage is written to standard error when the
provider reports it.

Forge loads user defaults from `$FORGE_HOME/config.json` (or
`~/.forge/config.json`) and project limits from `<workspace>/.forge/config.json`.
Project configuration may only make safety limits stricter and cannot select a
permission profile, model, or trace behavior. Inspect or validate the effective
configuration without starting a model request:

```bash
pnpm forge config show
pnpm forge config validate
```

Optional user instructions come from `$FORGE_HOME/AGENTS.md`. Project
instructions are loaded once from the repository root to the current working
directory, preferring `AGENTS.override.md` over `AGENTS.md` at each level. Each
instruction retains its source path and remains prompt input only; it cannot
approve tools or widen permissions.

Every traced coding run prints its run ID and stores a versioned JSONL event
stream under `$FORGE_HOME/runs/`. Inspect it without contacting the model or
executing tools:

```bash
pnpm forge inspect <run-id>
```

Session snapshots and traces may contain repository text, diffs, commands, and
model output. Forge redacts configured credentials, but these files should still
be treated as sensitive local data.

The API key is read from the process environment for each invocation and is not
saved by Forge. A missing key exits with code `2`; provider and network failures
exit with code `1`; Ctrl+C cancels an active request and exits with code `130`.

Run the project checks:

```bash
pnpm build
pnpm check
pnpm test
```

`pnpm check` runs Biome and strict TypeScript checks. `pnpm test` builds the
workspace and runs Vitest. The same commands run in GitHub Actions.

## Development approach

Development is organized into small, testable milestones. Each milestone must
produce a runnable behavior and meet its acceptance criteria before the next one
begins.

Milestone 0 established the workspace, CLI scaffold, and local quality checks.
Milestone 1 added the provider-neutral model contract, DeepSeek adapter,
one-turn streaming command, error mapping, usage reporting, and cancellation.
Milestone 2 added canonical workspace resolution, bounded `list_files`,
`read_file`, and `search` tools, untrusted tool-call validation, and AI SDK
schema translation without execution callbacks. Milestone 3 connected these
pieces through a Forge-owned multi-step loop, provider continuation records,
policy gateway, lifecycle events, cancellation, and deterministic limits. The
Milestone 4 added the safe patch/command vertical slice and deterministic
failure recovery. Milestone 4.5 added the bare `forge` multi-turn session,
slash commands, task cancellation, and a global development-link workflow.
Milestone 4.6 added the interactive TUI, multi-line editing, command and file
completion, and readable diff review. Milestone 5 added versioned configuration
with provenance, hierarchical repository instructions, enforced limits, and
the `safe` and `workspace-write` permission profiles. Milestone 6 added
versioned JSONL traces, run inspection, persistent workspace-scoped sessions,
restart-safe resume by ID or recency, and fresh security state for every resumed
run.

## License

A license will be selected before the first public release.
