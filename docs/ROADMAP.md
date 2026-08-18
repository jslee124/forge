# Roadmap

## Current milestone

**Milestone 6: Structured traces, persistent sessions, and resume is complete.**
The next milestone is **Milestone 7: Evaluation and first release**. No later
milestone should be treated as implemented merely because its design is
documented.

## Working rules

- Complete one milestone before expanding the next one.
- Every milestone must produce runnable behavior.
- Acceptance criteria define completion, not the number of files written.
- Keep the default test suite independent from paid model calls.
- Add a workspace package only when a milestone needs it.
- Update this document when implementation teaches us that the plan is wrong.
- Use [the v0.1 specification](V0.1_SPEC.md) as the release contract.

## Milestone 0: Project foundation

Goal: create the smallest consistent monorepo that is easy to run and test.

- [x] Add a private root `package.json` with `packageManager: pnpm@11.18.0`
- [x] Require Node.js 24 LTS and add `pnpm-workspace.yaml`
- [x] Create `apps/cli` and `packages/core`; do not create empty future packages
- [x] Configure ESM-only strict TypeScript with project references
- [x] Build with `tsc -b`
- [x] Configure Biome for formatting and linting
- [x] Configure Vitest
- [x] Add a minimal Commander CLI entry point
- [x] Add CI for type checking, tests, and linting
- [x] Document install, build, check, test, and CLI commands in the README

Acceptance criteria:

- `pnpm install` works from a clean checkout on Node.js 24.
- `pnpm forge --version` and `pnpm forge --help` exit with code `0`.
- `pnpm build`, `pnpm check`, and `pnpm test` pass locally.
- The same checks run in CI.
- `@forge/core` does not import CLI code.

## Milestone 1: DeepSeek model conversation

Goal: prove the real provider, authentication, and streaming path before
building an agent.

- [x] Add `packages/model-deepseek`
- [x] Install Vercel AI SDK and `@ai-sdk/deepseek`
- [x] Resolve `DEEPSEEK_API_KEY` without persisting it
- [x] Use `deepseek-v4-flash` as the default model
- [x] Select thinking mode explicitly instead of relying on provider defaults
- [x] Implement a one-turn streaming `ModelAdapter`
- [x] Add `forge ask <prompt>`
- [x] Stream provider-returned text and reasoning as distinct events
- [x] Capture token usage and provider metadata when available
- [x] Return readable credential, provider, and network errors
- [x] Cancel an active request with Ctrl+C
- [x] Unit-test the adapter contract with no real API calls

Acceptance criteria:

- With `DEEPSEEK_API_KEY` set, `forge ask "hello"` streams a response.
- Provider-returned reasoning is labeled separately; Forge never fabricates it.
- A missing API key exits with code `2` and no stack trace or secret output.
- Ctrl+C cancels the request and exits with code `130`.
- Default tests make no paid model calls.

## Milestone 2: Workspace and read-only tools

Goal: safely expose enough repository context for the model to inspect code.

- [x] Add `packages/tools`
- [x] Resolve the canonical workspace root and working directory
- [x] Define tool, tool-call, tool-result, and workspace-context types
- [x] Implement bounded `list_files`, `read_file`, and `search`
- [x] Validate canonical paths and resolved symlinks against the workspace root
- [x] Deny built-in file operations outside the workspace
- [x] Enforce per-result output limits
- [x] Translate Forge tool schemas to AI SDK tool definitions without direct
  `execute` callbacks
- [x] Map model tool calls back into validated Forge proposals
- [x] Test normal paths, traversal, symlinks, missing files, limits, and
  cancellation in temporary workspaces

Acceptance criteria:

- Forge can propose and execute a read that answers a question about a local
  file.
- Tool failures are structured results rather than uncaught exceptions.
- Traversal and symlink escapes are denied before file access.
- No model-generated tool call executes through an AI SDK callback.

## Milestone 3: Native agent loop and policy foundation

Goal: support multiple model and tool steps under Forge-owned runtime control.

- [x] Implement run state and lifecycle
- [x] Continue after tool results and recoverable tool failures
- [x] Keep the multi-step loop in `@forge/core`
- [x] Preserve DeepSeek continuation metadata, including reasoning content,
  across tool-result turns
- [x] Add model-step and tool-call limits with initial defaults of `12` and `40`
- [x] Detect cancellation between steps
- [x] Route every tool call through a policy gateway
- [x] Implement `allow`, `confirm`, and `deny` decisions
- [x] Deny approval-required actions when no approval channel is available
- [x] Implement the documented CLI exit-code mapping
- [x] Add deterministic runtime tests with a scripted fake model adapter

Acceptance criteria:

- A fake-model run can inspect multiple files before producing a final response.
- The runtime stops at configured limits instead of looping forever.
- No tool executes without a recorded policy decision.
- An adapter integration test with mocked DeepSeek responses completes a
  thinking-mode tool round trip without dropping required continuation metadata.
- Runtime tests cover completed, failed, cancelled, denied, and limit-reached
  runs.

## Milestone 4: Safe coding vertical slice

Goal: complete the first small repository change and verify it.

- [x] Implement structured file patches and show the diff before approval
- [x] Create new workspace files without replacing existing paths
- [x] Confirm the first workspace patch in the default profile
- [x] Scope that approval to later workspace patches in the current run only
- [x] Implement `run_command` as `program + args[]` using `spawn` with
  `shell: false`
- [x] Confirm every process command in the default profile
- [x] Apply a default command timeout of `60000` milliseconds
- [x] Limit command output to `65536` bytes per result
- [x] Terminate cancelled and timed-out child processes reliably
- [x] Preserve pre-existing workspace changes
- [x] Create `fixtures/validation-bug` from the v0.1 specification
- [x] Add an end-to-end test for the canonical fixture
- [x] Add a scripted recovery test: failing verification, corrective patch,
  passing verification

Acceptance criteria:

- Forge completes the canonical fixture task from inspection through passing
  verification.
- The deterministic recovery scenario proves that a failed verification is
  returned to the loop and followed by a corrective action.
- Timed-out commands are terminated and reported accurately.
- Shell expressions and outside-workspace file operations are denied.
- Unrelated user changes are not overwritten.

## Milestone 4.5: Interactive CLI

Goal: make the completed coding loop usable as a multi-turn terminal session
before adding broader configuration machinery.

- [x] Start an interactive session when `forge` has no subcommand
- [x] Preserve conversation context across prompts in the current session
- [x] Keep tool approvals and patch scope explicit per task/run
- [x] Add `/help`, `/clear`, and `/exit`
- [x] Cancel the active task with Ctrl+C without immediately losing the session
- [x] Exit cleanly on a second Ctrl+C or end-of-input
- [x] Add a supported local/global install or link workflow for the `forge` bin
- [x] Test prompt sequencing, cancellation, approvals, and non-TTY behavior

Acceptance criteria:

- Typing `forge` from a configured installation opens a prompt in the current
  repository.
- A user can submit more than one task without restarting the process.
- Patch and command approvals retain the Milestone 4 safety behavior.
- Exiting or cancelling never leaves a model request or child process running.

## Milestone 4.6: Interactive TUI and context mentions

Goal: replace the minimal readline prompt with a discoverable, multi-line
terminal interface while preserving the Forge-owned runtime and safety model.
The detailed interaction contract lives in [Interactive CLI UI](CLI_UI.md).

- [x] Use Ink for the interactive rendering layer inside `apps/cli`
- [x] Implement a multi-line prompt editor where Enter submits and Shift+Enter
  inserts a newline, with Ctrl+J as a portable fallback
- [x] Open and filter the command menu when `/` is typed at the start of input
- [x] Drive `/help` and completion from one command registry
- [x] Open a bounded fuzzy workspace-file picker for the active `@` token
- [x] Keep selected file mentions as structured workspace-relative paths
- [x] Send mentioned paths to the model without automatically injecting entire
  file contents
- [x] Render clear running, streaming, cancellation, and approval states
- [x] Show create/modify/delete diff panels with file headers, line numbers,
  colored additions/removals, and a usable no-color representation
- [x] Preserve safe diff limits and prevent approval of an undisplayed change
- [x] Test keyboard input, menus, mentions, state transitions, diff rendering,
  terminal resize, and non-TTY behavior without paid model calls

Acceptance criteria:

- Typing `/` displays the available commands; keyboard selection executes the
  chosen command and `/help` shows the same registry.
- Typing `@` plus part of a filename displays bounded workspace candidates;
  selecting one sends its canonical workspace-relative path to the model.
- Enter submits, while Shift+Enter inserts a visible newline without submitting
  in supported terminals; Ctrl+J provides a documented fallback.
- A proposed write shows an exact, readable diff with path, operation, hunks,
  old/new line numbers, additions, and removals before approval.
- Completion, streaming output, Ctrl+C, and approval prompts do not consume one
  another's input or weaken Milestone 4 safety behavior.
- The agent runtime and tools do not import React, Ink, or terminal UI code.

## Milestone 5: Configuration, instructions, and permission profiles

Goal: add customization after the core coding path works.

- [x] Add `packages/config`
- [x] Resolve `FORGE_HOME`, defaulting to `~/.forge/`
- [x] Implement the versioned Zod schema documented in `PROJECT_CONTEXT.md`
- [x] Load user and project `.forge/config.json` files
- [x] Merge documented sources with provenance
- [x] Add `forge config show` and `forge config validate`
- [x] Load optional user instructions from `~/.forge/AGENTS.md`
- [x] Discover project `AGENTS.md` from root to working directory
- [x] Prefer `AGENTS.override.md` at each directory level
- [x] Apply instruction file and total-size limits
- [x] Add `safe` and `workspace-write` profiles; keep `full-access` deferred
- [x] Prove project content cannot widen permissions or increase user safety
  limits

Acceptance criteria:

- Invalid configuration produces an actionable error with its source path.
- `forge config show` reports each effective value and source.
- Root and nested instructions merge in deterministic order with provenance.
- Project configuration and instructions cannot weaken the active policy.
- Starting in a repository subdirectory resolves the same workspace-level
  configuration as starting at its root.

## Milestone 6: Structured traces, persistent sessions, and resume

Goal: make every run inspectable, continue completed conversations after a
restart, and verify that persistence cannot weaken the safety boundary. The
detailed persistence contract lives in [Persistent Sessions and Run
Traces](SESSIONS.md).

- [x] Define versioned run-event schemas
- [x] Render terminal output from the event stream
- [x] Persist events as JSONL
- [x] Add versioned session snapshots under `FORGE_HOME`
- [x] Assign separate session IDs and run IDs
- [x] Persist only completed user/assistant conversation turns
- [x] Represent provider-returned reasoning as typed events
- [x] Redact configured credentials and known secrets
- [x] Add `forge inspect <run-id>`
- [x] Add `forge resume <session-id>` and `forge resume --last`
- [x] Add an interactive `/resume` session picker scoped to the workspace
- [x] Reload current configuration and instructions when a session resumes
- [x] Never restore approvals, provider continuations, or incomplete tool calls
- [x] Record duration, model steps, tool calls, token usage, and terminal status
- [x] Test external paths, symlinks, missing approval UI, decision precedence,
  command timeouts, and representative destructive programs
- [x] Keep `docs/SECURITY.md` aligned with implemented behavior

Acceptance criteria:

- A completed run can be reconstructed from its trace.
- Terminal rendering and persistence consume the same structured events.
- After restarting Forge, a saved session can be selected and continued with
  its completed conversation history intact.
- Resuming creates a new run and requires fresh approvals under the current
  effective configuration.
- Sessions from another canonical workspace are not resumed implicitly.
- Trace files contain no configured API keys.
- Safety documentation distinguishes policy and approval from OS isolation.

## Milestone 7: Evaluation and first release

Goal: publish a small, truthful, and reproducible v0.1 portfolio release.

- [ ] Keep the canonical fixture and add at least two more repository tasks
- [ ] Add graders based on fixture-owned tests plus hidden release tests
- [ ] Keep fake-model evaluation in the default test suite
- [ ] Make paid DeepSeek trials explicit and opt-in
- [ ] Run each release task multiple times with a recorded model ID and settings
- [ ] Report pass rate, duration, model steps, tool calls, and token usage
- [ ] Record a short terminal demo
- [ ] Expand the README with setup, usage, results, and limitations
- [ ] Select and add a project license
- [ ] Revalidate the current DeepSeek model ID before tagging
- [ ] Tag the v0.1 release

Acceptance criteria:

- All mandatory gates in `docs/V0.1_SPEC.md` pass.
- Forge completes at least one repository-level task end to end with DeepSeek.
- Reported evaluation numbers are reproducible from documented commands.
- The README never claims capabilities that the release does not implement.

## Milestone 8: Trusted plugin API (v0.2)

Goal: let users customize Forge without making plugins necessary for basic use.

- [ ] Define a versioned plugin manifest and API
- [ ] Discover enabled user plugins from `~/.forge/plugins/`
- [ ] Discover portable project skills from `.agents/skills/`
- [ ] Discover project plugins only from `.forge/plugins/`
- [ ] Register custom tools and commands
- [ ] Expose immutable run events to observer plugins
- [ ] Add controlled prompt and policy contribution hooks
- [ ] Require trust before loading project-local plugins
- [ ] Prevent plugins from overriding the policy kernel
- [ ] Add one custom-tool example and one stricter-policy example
- [ ] Document that in-process plugins have full local code privileges

Acceptance criteria:

- Forge works normally with no plugins installed.
- A trusted plugin can add a tool without modifying Forge core.
- Project-local plugins do not load before an explicit trust decision.
- Starting Forge in a repository subdirectory resolves the same project plugin
  set as starting at the repository root.
- Plugin tools pass through the same policy and trace pipeline as built-in tools.
- A plugin cannot make a core decision less strict through Forge APIs.

## Milestone 9: OpenAI authentication expansion (post-v0.2)

Goal: add a secure OpenAI login experience without treating another client's
private OAuth behavior as a stable contract.

- [ ] Re-check current official OpenAI authentication documentation and terms
- [ ] Generalize the v0.1 authentication manager for multiple providers
- [ ] Keep DeepSeek API-key authentication as a supported path
- [ ] Add OpenAI API-key authentication
- [ ] Add Codex-compatible Sign in with ChatGPT only through an appropriate
  public or explicitly authorized integration
- [ ] Support browser callback and headless login when the supported flow allows
- [ ] Store credentials in the OS credential store by default
- [ ] Implement single-flight token refresh and expiry handling
- [ ] Add `forge auth status` and `forge auth logout`
- [ ] Redact credentials from logs, traces, errors, and plugin events
- [ ] Test login, refresh, cancellation, expiry, corruption, and logout with fake
  authorization responses

Acceptance criteria:

- Forge never requires users to copy another application's credential file.
- API-key and subscription sign-in methods are clearly distinguished in the UI.
- Token refresh is concurrency-safe and does not leak credentials.
- Unsupported or changed upstream behavior fails with an actionable message.
- Documentation does not imply official third-party support beyond what OpenAI
  currently documents.

## Later extensions

These items are intentionally unordered and are not part of v0.1:

- Broader evaluation tasks and graders
- Additional model providers
- Narrow outside-workspace approvals
- A clearly warned `full-access` profile
- Optional shell-language execution
- LangChain runtime adapter and benchmark comparison
- LangGraph checkpoint experiment
- HTTP API and Server-Sent Events
- SQLite-backed session and run indexing
- Session branching and cross-machine synchronization
- Dynamic context management
- MCP integration
- Stronger process isolation
