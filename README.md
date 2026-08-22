# Forge

Forge is a safe-by-default, observable, extensible, and evaluable coding agent
built with TypeScript.

It is a learning project and portfolio project focused on the engineering behind
coding agents: model interaction, tool execution, safety boundaries, execution
traces, plugins, and reproducible evaluations.

> Status: Milestones 8 through 10 are complete. Forge v0.2 includes the bounded coding runtime,
> persistent sessions and traces, three reproducible evaluation tasks, external
> graders, an opt-in DeepSeek runner, published live evidence, and an MIT
> license. Trusted plugins and portable project skills are available in v0.2,
> with a tested `web_search`/`web_fetch` example and explicit network approval.
> Forge can also use ChatGPT subscription access through the official Codex App
> Server without copying or parsing another application's credential file.
> Long sessions now receive inspectable per-step context budgets, lossless v2
> transcripts with opt-in checkpoints, bounded Codex wrappers, and explicit
> context-limit stops.

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
 |-- Forge Engine
 |    `-- Model Adapter --> Vercel AI SDK --> DeepSeek / OpenAI API
 |
 `-- Codex Engine -------> Official Codex App Server --> ChatGPT subscription

Forge Agent Runtime
 |-- Model Adapter ------> Vercel AI SDK ------> DeepSeek / OpenAI API
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
- [Plugin authoring guide](docs/PLUGINS.md)
- [v0.1 acceptance and evaluation specification](docs/V0.1_SPEC.md)
- [Evaluation commands, reports, and current evidence](docs/EVALUATION.md)
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
- Vercel AI SDK with `@ai-sdk/deepseek` and `@ai-sdk/openai`
- `deepseek-v4-flash` as the initial model, with thinking mode selected
  explicitly rather than inherited from provider defaults

The root package is private. Publishable package boundaries will only be added
when a milestone needs them; the monorepo will not begin with empty placeholder
packages.

## Development

Prerequisites:

- Node.js 24 LTS
- pnpm 11.18.0
- Codex CLI for ChatGPT subscription access

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
pnpm forge
# Then enter /login and choose a provider.
```

The blue startup frame lists enabled user plugins, trusted or skipped project
plugins, and discovered project Skills before the first prompt. This is
metadata-only discovery; project plugin code is still not imported before
trust, and actual activation happens when the native Forge Engine starts a run.
Use `/plugins` inside the TUI to review project plugin versions and capabilities,
then press `t` and confirm with `y` to trust the workspace. The same panel can
revoke trust without leaving the session.

To exercise the plugin system with bounded network tools, copy the checked-in
example into the user plugin directory and enable `web-tools` in
`$FORGE_HOME/config.json`:

```bash
mkdir -p "${FORGE_HOME:-$HOME/.forge}/plugins"
cp -R examples/plugins/web-tools "${FORGE_HOME:-$HOME/.forge}/plugins/web-tools"
forge plugins list
```

The example's `web_search` uses Brave Search when `BRAVE_SEARCH_API_KEY` is set
and otherwise falls back to DuckDuckGo HTML search. `web_fetch` accepts only
bounded public HTTP(S) text resources. Both use the `network` risk and require
approval on every model call. See the [plugin authoring guide](docs/PLUGINS.md)
for the complete API, testing recipe, security boundary, and model-ready plugin
authoring checklist.

Environment-only setup remains available:

```bash
export DEEPSEEK_API_KEY="your-api-key"
pnpm forge
```

The interactive prompt persists completed user/assistant turns under
`$FORGE_HOME/sessions/`. Continue one after restart with `forge resume <id>`,
`forge resume --last`, or the interactive `/resume` picker. Each prompt remains
a separate bounded run with fresh policy and approval state; pending tool calls,
provider continuations, and command approvals are never restored.
Available commands are `/help`, `/new`, `/clear`, `/context`, `/compact`,
`/plugins`, `/login`, `/model`, `/effort`, `/resume`, and `/exit`. `/plugins`
reviews, trusts, or untrusts project plugins without leaving the TUI. `/login`
lets you choose ChatGPT subscription, DeepSeek
API, or OpenAI API. API keys are entered through a masked field and stored in
`$FORGE_HOME/auth.json`; the directory is mode `0700` and the file is mode
`0600`. Like Pi and OpenCode's local auth files, this is plaintext protected by
filesystem permissions rather than an OS keychain. ChatGPT credentials remain
owned by the official Codex App Server.
`DEEPSEEK_API_KEY` and `OPENAI_API_KEY` remain supported and take precedence
over stored credentials.
`/model` discovers ChatGPT subscription models and also shows API models. It
selects the model once instead of repeating it for every effort level.
`/effort` opens the active model's supported effort levels, `/effort high` sets
a level directly, and Shift+Tab cycles levels from the prompt. Model and effort
selections persist separately from credentials.
Ctrl+C cancels an active task and returns to the prompt; press it again to exit.

The [interactive CLI UI](docs/CLI_UI.md) supports Shift+Enter, Meta+Enter
(`ESC+Enter`), or Ctrl+J for a newline, live `/` command completion, and
bounded fuzzy `@` workspace-file selection. A selected path is sent to the
model as an explicit reference; the model still reads its contents through the
normal `read_file` tool. When the selected file is JPEG, PNG, GIF, or WebP and
the active model is `deepseek-v4-flash-vision-exp`, Forge also sends it as an
image attachment. Pasting or dragging an absolute image path—including a
macOS clipboard helper's `/var/.../T/...png` path—creates a visible
`[Image #N]` attachment instead of treating the leading slash as a command.
File-write approval shows a colored, line-numbered diff with a no-color
fallback.

Forge directly enables the enhanced keyboard protocol in known-compatible
terminals, including VS Code and Ghostty, without sending a startup capability
query that can be echoed as input. Forge also accepts the common `ESC+Enter`
encoding used by terminal coding agents. On other terminals, Ctrl+J remains
the portable newline shortcut.

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

Optional OpenAI API-key access uses Forge's native runtime and is billed
separately from ChatGPT subscriptions:

```bash
export OPENAI_API_KEY="your-api-key"
pnpm forge run "Inspect this repository" \
  --provider openai \
  --model gpt-5.4-mini \
  --reasoning-effort low
```

If you only have a ChatGPT subscription, skip this API-key setup and use the
Codex commands below. Forge's default tests use mocked transports and never make
paid OpenAI API requests.

Inspect or remove saved API credentials with `forge auth status deepseek`,
`forge auth logout deepseek`, `forge auth status openai-api`, and
`forge auth logout openai-api`. Logout removes only Forge's stored key; it
cannot unset an environment variable in your parent shell. Never commit
`auth.json`, and do not set `FORGE_HOME` to a shared or repository directory.

Use a ChatGPT subscription through the official Codex App Server:

```bash
pnpm forge auth login openai
pnpm forge auth status openai
pnpm forge models list --provider openai
pnpm forge codex "Inspect this repository and summarize it" \
  --model gpt-5.6-luna \
  --reasoning-effort medium
```

Use `--method device-code` for a headless login. `forge models list` discovers
the currently available models and their supported reasoning efforts from the
running Codex version; Forge does not hard-code that catalog. The same Codex
path is available through `forge run --engine codex`.

The Codex Engine is intentionally separate from Forge's native agent runtime.
It uses Codex's conversation, tool, sandbox, approval, and authentication
implementation. Its default `safe` profile maps to Codex read-only mode. Pass
`--permission-profile workspace-write` explicitly to permit Codex workspace
writes and interactive approval requests. Codex Engine events are streamed to
the terminal but are not yet stored in Forge's native JSONL run schema.

Forge starts the `codex` executable found on `PATH`; set `FORGE_CODEX_PATH` to
an explicit executable path when needed. Codex owns credential persistence and
refresh. Forge never reads `~/.codex/auth.json` or receives the access and
refresh tokens. Because the account is shared with Codex, `forge auth logout
openai` also signs that Codex account out for other local Codex clients.

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

DeepSeek image understanding uses the experimental
`deepseek-v4-flash-vision-exp` model and its Responses API. Attach a local
image, an HTTP(S) URL, or a base64 image data URL:

```bash
pnpm forge run "Inspect this screenshot and fix the UI bug" \
  --model deepseek-v4-flash-vision-exp \
  --reasoning-effort max \
  --image screenshots/broken-layout.png
```

`forge ask` accepts the same `--image <source...>` option. Forge supports JPEG,
PNG, GIF, and WebP, at most eight images, 20 MiB per local/data image, and 40
MiB combined. Local paths are canonicalized and must remain inside the
workspace when selected through the `@` workspace picker. Paths supplied
explicitly with `--image`, paste, or drag-and-drop may point to another
readable local directory. Text-only DeepSeek models reject attachments locally
instead of letting the API replace them with placeholder text. DeepSeek's
current vision model returns text and reasoning; it does not generate image
output. Session history records the textual file reference, not base64 pixels,
so re-attach an image when a later interactive turn must inspect it again.
The vision Responses transport accepts reasoning efforts `none`, `minimal`,
`low`, `medium`, `high`, `xhigh`, and `max`; disabling `--thinking` forces
`none`. The experimental endpoint may report reasoning-token usage without
returning reasoning text. In that case Forge shows the reported token count and
states that the provider did not expose the reasoning instead of presenting a
blank or invented reasoning block.

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

## Evaluation

Run the paid-call-free recovery and grader checks:

```bash
pnpm eval:deterministic
```

Forge includes three small TypeScript tasks: strict port validation, rejected
promise cache recovery, and falsy configuration merging. Every task runs in a
fresh temporary workspace and is checked by fixture-owned tests plus an external
grader that the Agent cannot edit.

Live trials are deliberately opt-in because they make paid DeepSeek requests:

```bash
export DEEPSEEK_API_KEY="your-api-key"
FORGE_EVAL_LIVE=1 pnpm eval:live
```

The runner records all successes and failures, the exact commit and model
settings, trace-derived duration/steps/tool calls/token usage, grader results,
and redacted JSONL traces. See the [evaluation guide](docs/EVALUATION.md) before
running or publishing live evidence.

## Current results

The deterministic evaluation passed 2 test files and 8 tests on 2026-08-19.
The complete project suite passed 22 test files and 110 tests. Nine fresh
`deepseek-v4-flash` trials with thinking enabled passed 7/9 overall:

| Task | Passed | Pass rate |
| --- | ---: | ---: |
| `config-merge` | 3/3 | 100.0% |
| `retry-cache` | 2/3 | 66.7% |
| `validation-bug` | 2/3 | 66.7% |

Both failed runs are retained in the [v0.1 report](evals/reports/v0.1/report.md).
They requested a 120-second command timeout while the evaluation policy allowed
only the declared 60-second verification command, so Forge denied the action.

## Limitations

- The native Forge runtime supports DeepSeek and OpenAI API providers; the
  separate Codex Engine supports ChatGPT subscription access.
- Model behavior is nondeterministic; runtime tests do not prove live task
  success.
- Built-in file tools enforce a workspace boundary, but Forge is not an OS
  sandbox and approved commands run with the user's process privileges.
- Resume restores completed conversation text, not active tool calls or old
  approvals.
- Plugins are trusted in-process code, not isolated extensions; Forge does not
  install plugin dependencies or enforce manifest capabilities at the OS level.
  Registered network tools require approval, but trusted code can still call
  Node.js network APIs directly.
- Multi-agent orchestration, RAG, IDE integration, and cross-machine session
  synchronization are not implemented.

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
run. Milestone 7 added reproducible fixture manifests, external graders, an
opt-in live runner, trace-derived reports, published live evidence, and the
first v0.1 release. Milestone 8 added the versioned trusted-plugin API, explicit
project trust, custom tools and commands, immutable observers, prompt and
strictness-only policy hooks, and explicitly selected portable project skills.
Milestone 9 added OpenAI API and ChatGPT-subscription authentication boundaries.
Milestone 10 added provider capability tables, conservative request preflight,
safe conversation checkpoints, adapter-owned continuation pressure handling,
Codex wrapper budgets, context inspection, and deterministic long-session gates.
See the [Plugin authoring guide](docs/PLUGINS.md).

## License

[MIT](LICENSE)
