# Roadmap

## Current milestone

**Milestone 10: Budgeted context management is complete.** Automatic
checkpoint generation remains opt-in while live provider-quality gates are
collected. No later milestone has started.

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

- [x] Keep the canonical fixture and add at least two more repository tasks
- [x] Add graders based on fixture-owned tests plus hidden release tests
- [x] Keep fake-model evaluation in the default test suite
- [x] Make paid DeepSeek trials explicit and opt-in
- [x] Run each release task multiple times with a recorded model ID and settings
- [x] Report pass rate, duration, model steps, tool calls, and token usage
- [x] Record a short terminal demo
- [x] Expand the README with setup, usage, results, and limitations
- [x] Select and add a project license
- [x] Revalidate the current DeepSeek model ID before tagging
- [x] Tag the v0.1 release

Acceptance criteria:

- All mandatory gates in `docs/V0.1_SPEC.md` pass.
- Forge completes at least one repository-level task end to end with DeepSeek.
- Reported evaluation numbers are reproducible from documented commands.
- The README never claims capabilities that the release does not implement.

## Milestone 8: Trusted plugin API (v0.2)

Goal: let users customize Forge without making plugins necessary for basic use.

- [x] Define a versioned plugin manifest and API
- [x] Discover enabled user plugins from `~/.forge/plugins/`
- [x] Discover portable project skills from `.agents/skills/`
- [x] Discover project plugins only from `.forge/plugins/`
- [x] Register custom tools and commands
- [x] Expose immutable run events to observer plugins
- [x] Add controlled prompt and policy contribution hooks
- [x] Require trust before loading project-local plugins
- [x] Prevent plugins from overriding the policy kernel
- [x] Add one custom-tool example and one stricter-policy example
- [x] Document that in-process plugins have full local code privileges

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

- [x] Re-check current official OpenAI authentication documentation and terms
- [x] Generalize the v0.1 authentication manager for multiple providers
- [x] Keep DeepSeek API-key authentication as a supported path
- [x] Add OpenAI API-key authentication
- [x] Add Codex-compatible Sign in with ChatGPT only through an appropriate
  public or explicitly authorized integration
- [x] Support browser callback and headless login when the supported flow allows
- [x] Delegate credential storage and refresh to the official Codex App Server
- [x] Add `forge auth status` and `forge auth logout`
- [x] Discover available Codex models and reasoning efforts through `model/list`
- [x] Add explicit `forge codex` and `forge run --engine codex` execution paths
- [x] Add an interactive `/model` picker and persisted user selection
- [x] Add an interactive `/login` provider picker with masked API-key entry
- [x] Store API keys in an owner-only user file with environment overrides
- [x] Redact credentials from logs, traces, errors, and plugin events
- [x] Test login, refresh, cancellation, expiry, corruption, and logout with fake
  authorization responses

Acceptance criteria:

- Forge never requires users to copy another application's credential file.
- API-key and subscription sign-in methods are clearly distinguished in the UI.
- Token refresh is concurrency-safe and does not leak credentials.
- Unsupported or changed upstream behavior fails with an actionable message.
- Documentation does not imply official third-party support beyond what OpenAI
  currently documents.

## Milestone 10: Budgeted context management

Goal: keep long-running sessions useful and predictable without hiding dropped
context, weakening instruction precedence, or introducing retrieval
infrastructure before it has measurable value. The detailed design and rollout
plan lives in [Context Management Improvement Plan](CONTEXT_MANAGEMENT.md).

### 10.1 Budget accounting and observability

- [x] Define provider/model context capabilities separately from runtime limits
- [x] Add a provider-neutral token estimator with documented conservative
  fallback behavior
- [x] Reserve explicit budgets for output, current instructions, tool schemas,
  the current request, conversation history, and in-run tool continuation
- [x] Use the larger of the requested output allowance and safety buffer as the
  context reserve instead of double-counting both
- [x] Emit versioned context-budget events without storing hidden credentials
- [x] Extend `forge inspect` with estimated, provider-reported, retained, and
  omitted context metrics
- [x] Budget both native `ModelAdapter` requests and the Forge conversation JSON
  currently wrapped into Codex App Server prompts
- [x] Warn before a request is likely to exceed the active model's context
  window

Acceptance criteria:

- Every native Forge model request has an inspectable preflight budget report.
- Every Codex Engine turn reports the Forge-owned wrapper cost separately from
  context managed inside Codex App Server when that usage is observable.
- Estimation error can be compared with provider-reported input-token usage.
- A request that cannot fit its mandatory context fails before a paid provider
  call with an actionable explanation.
- Default tests use deterministic estimators and make no paid model calls.

### 10.2 Safe conversation compaction

- [x] Introduce a versioned context checkpoint separate from the canonical
  session transcript
- [x] Support adapter-owned provider-native opaque compaction when available and
  a Forge-generated inspectable checkpoint otherwise
- [x] Stop sending an unbounded full Forge transcript inside every Codex Engine
  prompt; use the derived active view first, then evaluate persistent App Server
  thread mapping as a separate integration
- [x] Always retain current instructions, the current request, and a configured
  recent serialized-tail token budget
- [x] Compact only a completed prefix of user/assistant turns
- [x] Preserve the full original transcript until a separately designed
  retention policy exists
- [x] Treat generated summaries as untrusted conversation memory, never as
  instructions, approvals, verification evidence, or permission state
- [x] Persist checkpoint strategy, provenance, source and tail hashes, model ID,
  token counts, and generation time
- [x] Fall back predictably when summary generation fails or produces invalid
  output
- [x] Add an explicit `/context` status view, `/compact --dry-run`, and a manual
  `/compact` action before enabling automatic compaction by default

Acceptance criteria:

- A resumed session produces the same active context checkpoint as the session
  had before restart.
- No compaction path can restore an old approval or override freshly loaded
  project instructions.
- Users can identify exactly which turns were summarized and which remain
  verbatim.
- Failed, cancelled, or invalid compaction never corrupts the saved transcript.

### 10.3 In-run pressure handling

- [x] Re-check the context budget before every model step
- [x] Account for provider continuation data, assistant tool calls, and tool
  results without interpreting opaque provider metadata in `@forge/core`
- [x] Prune or replace old completed tool outputs with explicit bounded
  placeholders before summarizing broader conversation history
- [x] Prefer bounded tool-result representations, targeted re-reads, and a
  measured advertised-tool set over retaining duplicate outputs or schemas
- [x] Recover once from a provider-classified context overflow only when the
  failed attempt produced no assistant output or other retry evidence
- [x] Detect compaction thrashing and stop when repeated compaction fails to
  reclaim a minimum useful budget
- [x] Stop with `limit_reached` and a specific context-budget reason when the
  active run cannot be reduced safely
- [x] Evaluate provider-specific continuation compaction only behind adapter
  capabilities and feature flags

Acceptance criteria:

- Long tool loops cannot cross a known context limit silently.
- Core remains provider-neutral; adapters own provider message and continuation
  translation.
- Forge never drops a pending tool call or tool result required by the provider
  protocol.
- Overflow recovery never duplicates a user prompt or a completed tool action.

### 10.4 Evaluation and default rollout

- [x] Add deterministic long-session fixtures for recall, instruction changes,
  tool-result pressure, resume, and hostile historical text
- [x] Measure task success, input tokens, estimation error, latency, compaction
  count, retained-turn count, and summary regeneration rate
- [x] Compare `off`, `warn`, and `compact` modes on the same tasks
- [x] Define release thresholds before making automatic compaction the default
- [x] Keep semantic or vector retrieval deferred until evaluation demonstrates
  that budgeted history plus existing lexical tools is insufficient

Acceptance criteria:

- The checked-in evaluation suite demonstrates lower context usage without a
  material regression in task completion or safety behavior.
- Automatic compaction remains opt-in until its quality and failure thresholds
  are met.
- Documentation distinguishes conversation compaction from repository
  retrieval and persistent semantic memory.

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
- Optional semantic or vector retrieval justified by context evaluations
- MCP integration
- Stronger process isolation
