# Roadmap

[简体中文](zh-CN/ROADMAP.md) · [Documentation index](README.md)

## Current milestone

**Milestone 14: structured session history and faithful resume is complete, and
v0.3.3 is published.** The release includes the Milestone 13 long-session,
scoped-permission, cache-observability, and update work plus canonical completed
tool exchanges across resume. Automatic compaction remains opt-in; live-provider
validation and npm publication remain separate from offline acceptance evidence.

## Working rules

- Complete one milestone before expanding the next one.
- Every milestone must produce runnable behavior.
- Acceptance criteria define completion, not the number of files written.
- Keep the default test suite independent from paid model calls.
- Add a workspace package only when a milestone needs it.
- Update this document when implementation teaches us that the plan is wrong.
- Use [the historical v0.1 specification](history/v0.1/ACCEPTANCE.md) as the v0.1 release contract.

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
- [x] Keep `docs/SECURITY_MODEL.md` aligned with implemented behavior

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

- All mandatory gates in `docs/history/v0.1/ACCEPTANCE.md` pass.
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

## Milestone 11: OpenAI-compatible provider routes

Goal: reach gateways and self-hosted servers without adding a compiled adapter
for every vendor, while keeping credential destinations user-controlled.

- [x] Add user-scoped provider route profiles for Chat Completions and Responses
- [x] Reject provider routes from repository configuration
- [x] Require HTTPS except for canonical loopback endpoints
- [x] Add explicit bearer and no-auth modes
- [x] Bind stored route credentials to their canonical endpoint
- [x] Add bounded, redirect-free model discovery with manual fallback
- [x] Read bounded optional reasoning-effort metadata without paid probing
- [x] Add `@forge/model-compat` behind the provider-neutral adapter contract
- [x] Feed route model capabilities into context budgets, images, `/model`, and
  `/effort`
- [x] Distinguish explicit `none` from an omitted provider-default effort
- [x] Preserve replayable reasoning provider metadata in stateless continuation
  and warn when a thinking tool call returns no replayable state
- [x] Surface bounded, credential-redacted provider error details
- [x] Keep model and effort selection separate in the current TUI
- [x] Cover bearer, auth-free, missing-key, and no-downgrade paths without paid
  calls

Acceptance criteria:

- A loopback OpenAI-compatible server completes a compiled CLI request through
  both bearer and auth-free route configurations.
- A project cannot define or redirect a provider route.
- Changing a route endpoint cannot cause Forge to reuse its stored key.
- A large discovered model catalog remains searchable instead of losing its
  visible selection after a fixed number of rows.
- Configured context/output capacities and reasoning gears reach the existing
  context and effort surfaces.
- Build, formatting, type checks, and the full default test suite pass without
  paid model calls.

## Milestone 12: Model-invocable Skills and versioned product knowledge

Versions: v0.3.1 feature release, v0.3.2 packaged-resource hotfix.

Goal: let Forge recognize when a task needs specialized instructions or
product documentation, load only the matching bounded resources, and continue
through the existing model/tool/policy/trace loop. The first complete vertical
slices are creating a Forge plugin and answering questions about the installed
Forge version.

This milestone extends the portable Skill convention; it does not turn Skills
into executable plugins. Built-in, user, and project Skills are model-invocable
by default. Repository Skill content remains untrusted prompt input: selecting
a Skill grants no capability, approval, filesystem access, network access, or
permission change, and every resulting tool action still passes through the
normal policy, approval, execution, event, and trace pipeline.

### 12.1 Resource model, discovery, and precedence

- [x] Add a dedicated resource boundary instead of growing executable plugin
  activation around non-executable Skills and documentation
- [x] Parse bounded YAML frontmatter from `SKILL.md`, requiring a valid `name`
  and task-oriented `description`; retain the body for lazy loading
- [x] Represent `builtin`, `user`, and `project` provenance, canonical path,
  content size, model-invocation state, and diagnostics in typed descriptors
- [x] Discover bundled Skills, user Skills, and project
  `.agents/skills/<name>/SKILL.md` resources without executing repository code
- [x] Make built-in, user, and project Skills visible to the model and eligible
  for automatic invocation by default; `disable-model-invocation: true` makes a
  Skill explicit-only
- [x] Preserve explicit `$skill-name` selection as the deterministic override
  and compatibility path
- [x] Resolve name collisions deterministically with
  `explicit selection > project > user > builtin`, report the shadowed sources,
  and record the selected source
- [x] Include only escaped `name`, `description`, source, and stable identifier
  in the initial model request rather than every Skill body
- [x] Apply per-file, catalog, description, and total instruction budgets before
  any paid provider request

Acceptance criteria:

- A valid project Skill becomes model-invocable without a separate trust step
  or an explicit `$name` mention.
- A project Skill is parsed as data and never imported or executed during
  discovery.
- An explicit `$name` still selects the expected Skill when automatic routing
  would choose another resource.
- Invalid metadata, collisions, and size-limit failures produce bounded,
  source-specific diagnostics.
- A workspace with many Skills adds only bounded catalog metadata to the first
  request.

### 12.2 Safe lazy loading and runtime integration

- [x] Add a host-owned `load_skill` read tool that accepts a catalog identifier,
  not a model-generated arbitrary path
- [x] Canonicalize every resource root and target; reject traversal, escaped
  symlinks, non-regular files, changed identities, and files outside the
  registered resource root
- [x] Return bounded content, provenance, base directory, and truncation state
  so relative references can be resolved deliberately
- [x] Keep workspace `read_file` constrained to the selected workspace; do not
  widen it to reach installed Forge resources or arbitrary user files
- [x] Tell the model to load a Skill before acting whenever the request matches
  its description, while allowing an explicit-only Skill to be selected only
  by the user
- [x] Allow at most a bounded number of Skill loads and deduplicate repeated
  loads within one run
- [x] Re-run context preflight after resource results enter the conversation
  and fail before a provider request when mandatory context cannot fit
- [x] Emit structured discovery, automatic-selection, explicit-selection,
  load, rejection, and truncation events with no hidden chain-of-thought

Acceptance criteria:

- "Create a Forge plugin" can cause the native model loop to load the plugin
  authoring Skill without the user naming it.
- A hostile Skill cannot read outside its registered root through `load_skill`
  or weaken the active approval policy through instructions.
- A loaded Skill may recommend actions, but no write, process, or network action
  executes outside the existing policy and approval path.
- `forge inspect` can identify which Skill was selected, why it was eligible,
  its source, and whether its content was truncated.

### 12.3 Built-in Forge plugin authoring Skill

- [x] Ship a version-matched `forge-plugin-creator` Skill with the CLI package
- [x] Trigger it for plugin creation, modification, validation, capability,
  lifecycle, trust, loading, tool, command, observer, prompt-hook, policy-hook,
  and plugin-test requests
- [x] Keep workflow instructions in the Skill and current API facts in bundled
  documentation or generated references instead of duplicating an entire
  manual in the prompt
- [x] Include minimal manifest, entry, and test templates that use the current
  plugin API version and package layout
- [x] Require inspection of the active manifest schema, TypeScript types, and
  the nearest maintained example before generating code
- [x] Preserve the distinction between a non-executable Skill and trusted
  in-process plugin code with local process privileges
- [x] Validate generated plugin names, entries, capabilities, reserved tool
  names, and project trust behavior before reporting completion
- [x] Run build, typecheck, focused plugin tests, and documentation checks
  without paid model calls

Acceptance criteria:

- A user can ask for a small Forge plugin in ordinary language and receive a
  current manifest, implementation, tests, and activation instructions.
- Generated examples do not bypass plugin trust, capability validation,
  policy, approval, or trace handling.
- The built-in Skill and templates are included in the packaged CLI and match
  the runtime's plugin API version.

### 12.4 Versioned Forge documentation retrieval

- [x] Package the canonical English documentation and maintained Chinese
  mirrors needed for product help with the CLI release
- [x] Generate a deterministic index containing Forge version, locale,
  document identifier, title, headings, keywords, path, and content hash
- [x] Split Markdown by headings and use bounded lexical ranking first; defer
  embeddings or vector infrastructure until evaluation shows a measurable need
- [x] Add `search_forge_docs` for bounded ranked results and `read_forge_doc`
  for an allowlisted document or section
- [x] Prefer the user's active locale, fall back to canonical English, and mark
  the fallback instead of silently mixing translations
- [x] Add a built-in `forge-product-help` Skill for installation,
  configuration, providers, models, authentication, plugins, Skills, sessions,
  context, traces, security, release, and troubleshooting questions
- [x] Require documentation lookup before answering changeable or
  implementation-specific Forge product questions; distinguish documented
  facts, repository inspection, inference, and unsupported behavior
- [x] Return stable document and section references suitable for terminal
  rendering and traces without exposing arbitrary package paths
- [x] Verify at package-build time that indexed paths exist, hashes match,
  local Markdown links pass, and the index version equals `FORGE_VERSION`

Acceptance criteria:

- Asking whether project configuration may select a provider searches the
  bundled documentation and answers from the current installed version.
- Chinese product questions prefer a maintained Chinese page and visibly fall
  back to English when no mirror exists.
- Documentation tools cannot read an arbitrary workspace, home, credential,
  or package file.
- Product answers expose the document and section used, and say when the docs
  do not establish an answer.

### 12.5 CLI discovery and control surfaces

- [x] Extend startup resource reporting without importing executable project
  plugins or eagerly reading Skill bodies
- [x] Add `forge resources list` and an interactive `/resources` view for
  source, description, automatic/explicit-only status, shadowing, and
  diagnostics
- [x] Keep `/plugins` focused on executable plugins and show a clear link to
  Skills/resources rather than conflating the two lifecycles
- [x] Surface automatic Skill selection and documentation lookup as concise
  run events without exposing private reasoning
- [x] Add a user-scoped way to disable a specific automatically invocable Skill
  while keeping project Skills model-invocable by default
- [x] Keep non-interactive behavior deterministic and emit actionable warnings
  instead of opening a trust or selection prompt

Acceptance criteria:

- A user can discover why a Skill is or is not model-invocable before starting
  a paid run.
- The UI identifies builtin, user, and project resources and never presents a
  Skill as already-executed plugin code.
- Disabling one automatic Skill does not disable explicit selection or mutate
  repository files.

### 12.6 Evaluation, compatibility, and release gates

- [x] Add scripted fake-model tests for matching, non-matching, ambiguous,
  explicit, disabled, collision, repeated-load, and over-budget Skill cases
- [x] Add adversarial project Skills that attempt prompt injection, permission
  widening, arbitrary path reads, secret access, and unapproved commands
- [x] Add product-question fixtures spanning plugin API, configuration,
  authentication, sessions, context, security, and deliberate unknowns
- [x] Measure selection precision/recall, unnecessary resource loads, first-turn
  catalog tokens, loaded-resource tokens, answer citation accuracy, latency,
  and task completion
- [x] Keep all default tests deterministic and offline; make live provider
  quality trials explicit and opt-in
- [x] Preserve sessions and traces created before resource events existed, and
  keep the old explicit `$name` flow working
- [x] Verify the packed artifact contains Skills, templates, docs, index, and no
  development-only or secret files
- [x] Run `pnpm build`, `pnpm check`, `pnpm test`, `pnpm check:docs`, deterministic
  evaluations, package verification, and version consistency for `0.3.2`

Release criteria:

- Plugin-creation and product-question vertical slices pass deterministic
  end-to-end tests through the compiled CLI.
- Project Skills are automatically model-invocable by default, but adversarial
  Skills cannot expand capabilities or bypass policy and approval.
- Resource selection and reads are bounded, provenance-visible, inspectable,
  and included in context accounting.
- The clean packaged `0.3.2` CLI answers from its own version-matched docs and
  can scaffold a plugin matching its shipped API.
- No release claim treats model-invocable Skills as trusted executable code or
  claims OS sandboxing that Forge does not provide.

## Milestone 13: Long-session efficiency and user control (v0.3.3, implemented and offline-validated)

Goal: let a user keep Forge running through long coding sessions with visible
context pressure, fewer repetitive approval interruptions, non-disruptive
update guidance, and provider prompt-cache behavior that can be measured and
improved. Milestone 10 supplies the context-budget and checkpoint foundation;
Milestone 13 turns that foundation into a discoverable, evaluation-gated
default experience. The architecture, UI flows, proposed TypeScript contracts,
module map, test matrix, and staged delivery sequence are preserved in the
[Chinese v0.3.3 implementation record](zh-CN/history/v0.3.3/LONG_SESSION_IMPLEMENTATION.md).

This implementation does not add persistent unrestricted permissions, silently run
package-manager updates, delete canonical conversation history, promise cache
support from an endpoint that does not report it, or treat an extractive
checkpoint as production-quality semantic memory. Optional live-provider
validation and npm publication remain separate release steps and have not been
completed by the offline development-branch gates.

### 13.0 Cross-cutting contracts and baseline

- [x] Record a reproducible v0.3.2 baseline for long-session task completion,
  context estimates, provider input usage, cache read/write tokens, approval
  count, time waiting for approval, compaction count, and startup/update-check
  latency
- [x] Introduce versioned, provider-neutral runtime events for context-pressure
  state, cache observations, scoped approval decisions, and update availability
- [x] Keep policy and context decisions in `@forge/core`; keep canonical
  transcript and checkpoint integrity in persistence; keep terminal layout,
  interactive menus, and notification dismissal in `apps/cli`
- [x] Add adapter capability descriptors for native compaction and prompt-cache
  control without branching on provider names in core
- [x] Store hashes, token counts, scope identifiers, and provenance in traces,
  but never raw credentials, hidden reasoning, provider cache contents, or
  unredacted sensitive command input
- [x] Preserve compatibility with existing `safe` and `workspace-write`
  configuration and with session-v2 snapshots and older trace events

Acceptance criteria:

- A trace reader can distinguish unavailable metrics from real zero values.
- Offline fake adapters exercise every new event and decision state without a
  paid provider request.
- Project configuration, instructions, Skills, and plugins cannot enable a
  weaker permission mode, persist a grant, disable a required context guard,
  or select an update destination.

### 13.1 Prompt-cache observability and stable request prefixes

- [x] Extend run summaries and `forge inspect` with per-step and aggregate
  input, cache-read, cache-write, uncached-input, and cache-hit-ratio metrics
- [x] Report cache metrics only when the provider supplies them; render unknown
  as unavailable instead of inferring a miss
- [x] Compute redacted stable-prefix, instruction, resource-catalog, and tool
  schema hashes so a local trace can explain likely invalidation without
  persisting prompt contents twice
- [x] Refactor request composition into a deterministic stable prefix followed
  by dynamic turn content: core contract, current repository instructions,
  stable Skill metadata, and stable tool definitions precede selected Skill
  content, per-turn plugin contributions, checkpoint memory, conversation, and
  the current request
- [x] Keep byte-for-byte-stable ordering for instructions, tools, JSON schemas,
  and provider options when their semantics have not changed
- [x] Define explicit invalidation for provider/model changes, instruction
  content or order, Forge prompt-schema version, enabled resources/plugins,
  tool schema, and compaction checkpoint generation
- [x] Add a provider capability for automatic caching, keyed caching, explicit
  breakpoints, or unsupported caching; pass a stable session/workspace cache key
  only when the adapter and endpoint declare support
- [x] Preserve replayable provider continuation and append-only tool results so
  a tool loop does not unnecessarily rewrite an earlier cacheable prefix
- [x] Keep the advertised tool set stable by default; evaluate dynamic allowed
  tool subsets separately from removing or reordering tool definitions

Acceptance criteria:

- Repeating a deterministic tool loop with an unchanged prefix produces the
  same local prefix hash on every step.
- Changing one invalidation input changes the relevant hash and records the
  reason; changing only the user request does not invalidate the stable prefix.
- Providers that report cached tokens expose a correct per-run ratio; providers
  that do not report them remain fully usable and show `unavailable`.
- Compaction intentionally starts a new cache prefix and does not claim a cache
  hit until the provider reports one.

### 13.2 Pressure-driven auto compaction and context controls

- [x] Define the idle and next-request pressure ratio as projected input tokens
  divided by available input tokens, where available input has already removed
  the single effective output/safety reserve
- [x] Include instructions, Skill/resource metadata, tool schemas, the active
  checkpoint, retained conversation, draft input, and attached-image estimates
  in the projected numerator; mark conservative or unavailable estimates with
  `~` or `?` rather than false precision
- [x] Add a persistent context indicator next to the editor using a segmented
  ring plus an exact percentage: `○`, `◔`, `◑`, `◕`, and `●`, with semantic
  normal, elevated, warning, and critical colors
- [x] Render `context · warn`, `context · auto`, `compact soon`, `compacting`,
  `compacted`, and `auto paused` states; keep the percentage visible in narrow
  terminals while progressively hiding labels
- [x] Split the editor footer into a model/context status row and a shortcut row
  so the new indicator does not make existing input controls unreadable
- [x] Upgrade `/context` from a status-only panel into an interactive control
  surface with pressure breakdown, mode, strategy, recent-tail budget, last
  compaction, `/compact` preview, compact-now, enable-for-session, and
  save-as-user-default actions
- [x] When `warn` first crosses the configured activation threshold, show one
  non-blocking prompt offering compact once, enable auto for this session, or
  dismiss; never require editing JSON to discover automatic compaction
- [x] Keep session-only auto mode in runtime state; persist a default only after
  an explicit user action to user-level configuration outside the repository
- [x] Start with an evaluation-tuned pressure threshold rather than message
  count alone; use 75-80% projected pressure as the initial experiment and
  compact only completed history or safely projectable continuation state
- [x] Reclaim context in stages: bound or replace stale completed tool outputs,
  use adapter-native opaque compaction when declared, otherwise generate a
  validated Forge summary while retaining a recent verbatim tail
- [x] Keep the current deterministic extractive summary as a safe fallback and
  test oracle, not the quality basis for enabling automatic compaction by
  default
- [x] Persist strategy, source/tail hashes, token estimates, model, generation
  time, safety labels, and whether summary generation incurred provider usage
- [x] Pause auto compaction after cancellation, invalid output, repeated
  failure, or low reclamation; initially treat less than the larger of 8,000
  tokens or 20% of projected input as low value, then tune from evaluations
- [x] Show a concise result such as `Context compacted · 86K -> 34K`, strategy,
  retained recent turns, and any separately measured generation usage

Acceptance criteria:

- A new user can discover and enable auto compaction entirely from the TUI.
- The indicator and `/context` panel use the same snapshot and never label a
  history-only estimate as complete context-window usage.
- Auto compaction triggers before a representative long session reaches a hard
  provider overflow, but does not compact every turn or loop without progress.
- Explicit goals, constraints, edited files, unresolved work, and historical
  verification provenance survive compaction fixtures and resume.
- No checkpoint restores approval, trust, permission profile, current
  verification status, pending tool calls, or secret material.

### 13.3 Scoped permission grants and approval UX

- [x] Replace the boolean approval response with a structured decision for
  allow once, allow a displayed scope for the current session, or deny with
  optional user feedback
- [x] Define normalized, inspectable scopes for workspace writes, an exact
  command plus arguments/cwd/timeout ceiling, a network tool plus destination
  host, and a named delegated-model tool; do not use shell strings, unresolved
  globs, or model-authored descriptions as grant identities
- [x] Require the host to derive a structured approval descriptor for every
  proposed tool action from validated input: effect, resource/destination, risk
  flags, preview, and the scopes core permits the UI to offer; plugins cannot
  author allowed scopes
- [x] Present numbered TUI choices for allow once, allow similar actions in this
  session, and deny; display exactly what a session grant will cover before the
  user selects it
- [x] Add `/permissions` to show the effective profile, its configuration
  provenance, active session grants, use count, and revoke controls
- [x] Keep grants scoped to the active canonical workspace and session by
  default; do not restore them through `/resume` or write them to project files,
  session snapshots, prompts, summaries, Skills, or plugin events
- [x] Re-confirm destructive, credential-sensitive, publish/install, broad
  external-side-effect, or policy-designated actions even if a broader session
  scope would otherwise match
- [x] Let deny-with-feedback return bounded user guidance to the active run as a
  denial result, without turning that guidance into an approval
- [x] Preserve `deny > confirm > allow` across core and plugin policy hooks, and
  keep trusted plugin code distinct from model-tool approval

Acceptance criteria:

- A normal inspect-edit-test loop can authorize a clearly displayed narrow
  scope and finish without repeating an identical prompt for every action.
- A changed command argument, cwd, destination host, canonical workspace, risk
  classification, or timeout above the grant ceiling causes a fresh decision.
- Session grants disappear on exit and resume; traces record scope identifiers
  and decisions but not authority that can be replayed.
- A malicious instruction, Skill, checkpoint, tool result, or plugin policy
  hook cannot manufacture or widen a grant.

### 13.4 In-TUI update experience

- [x] Refactor the existing rate-limited update check to publish structured
  cached, refreshing, available, current, failed, and disabled states instead
  of writing a startup notice outside the Ink tree
- [x] Preserve non-blocking startup, the 24-hour check interval, bounded network
  timeout, `CI` behavior, and `FORGE_DISABLE_UPDATE_CHECK=1`
- [x] Let an update discovered after startup update the current TUI without
  entering the transcript or model context
- [x] Render a compact update banner with current/latest version, `forge update`
  guidance, release-notes destination, dismiss-this-version, and an accessible
  narrow-terminal layout
- [x] Show each available version prominently at most once after dismissal while
  keeping explicit `forge update check` authoritative and repeatable
- [x] Detect supported installation provenance before suggesting or executing a
  package-manager command; when provenance is unknown, report the new version
  and documentation without guessing an installer
- [x] Keep installation explicit, use argument-array process execution, report
  that the running process still uses the old version, and require restart
- [x] Verify that check, dismissal, failed install, successful install, and
  restart never modify credentials, config, sessions, traces, plugins, or other
  user data under `FORGE_HOME`

Acceptance criteria:

- A fresh fake-registry result can appear in an already running TUI without
  corrupting the editor, approval input, streaming output, or scrollback.
- Offline, timeout, malformed registry data, CI, and disabled checks are silent
  or bounded and never block interactive startup.
- npm/pnpm or other explicitly supported provenance receives the correct safe
  guidance; unknown provenance never triggers an automatic global install.
- Update UI and the compiled `forge update` command agree on current version,
  target version, and restart requirements.

### 13.5 Evaluation matrix and release gates

- [x] Add deterministic long-session fixtures covering constraint recall,
  edited-file tracking, unresolved work, changed instructions, tool-output
  pressure, repeated compaction, cancellation, resume, and hostile historical
  approval claims
- [x] Add permission fixtures for exact-match reuse, near-match rejection,
  workspace changes, symlink/canonical-path changes, destructive actions,
  revoke, deny-with-feedback, plugins, network destinations, and subagents
- [x] Add cache fixtures for stable prefixes, every invalidation input,
  unavailable usage, tool continuation, compaction boundaries, and aggregate
  accounting without asserting provider support the endpoint did not declare
- [x] Add update fixtures for cached and fresh results, late async delivery,
  dismissal, malformed semver, timeout, disabled/CI mode, install provenance,
  failed install, and protected `FORGE_HOME` data
- [x] Render the editor/footer, context controls, approval panels, and update
  banner at representative narrow and wide terminal widths; preserve existing
  Enter/newline/Ctrl+C behavior and readable semantic colors
- [x] Compare `warn` and session/default `compact` modes on the same tasks and
  record task success, constraint retention, tokens before/after, reclamation,
  latency, cache reads/writes, compaction count, and no-progress pauses
- [x] Run live provider trials only behind an explicit opt-in; store bounded,
  redacted reports and never make paid calls part of the default suite
- [x] Update English and Chinese context, configuration, security, session,
  CLI UI, releasing, troubleshooting, and product docs to match implemented
  behavior and mark provider-specific limits honestly
- [x] Run build, format/lint, typecheck, full offline tests, documentation/link
  checks, deterministic evaluations, packed-artifact verification, installed
  CLI smoke tests, and version consistency for `0.3.3`

Release criteria:

- Every unchecked item claimed for v0.3.3 is implemented or explicitly moved
  out of the release; planning language is not presented as shipped behavior.
- Auto compaction has no deterministic fixture regression in explicit goals,
  constraints, edited-file tracking, unresolved work, safety, or resume, and
  its live quality report satisfies thresholds recorded before default rollout.
- The context indicator stays responsive and truthful, and auto compaction can
  be enabled, observed, paused, and reversed without editing repository files.
- Scoped grants materially reduce duplicate approvals in the representative
  coding flow while every near-match and high-risk fixture still re-prompts or
  denies as designed.
- Cache reports are arithmetically correct and provider-qualified; the release
  makes no universal hit-rate promise.
- Update discovery is non-blocking, install-aware, explicit, and proven not to
  mutate existing `FORGE_HOME` user data.
- Clean packed `0.3.3` behavior, docs, `FORGE_VERSION`, package manifests, tag,
  and public installation smoke expectations agree before publication.

### 13.6 Suggested delivery sequence

1. Land event schemas, baseline reporting, cache telemetry, and stable-prefix
   hashing before changing defaults.
2. Land structured approval responses, scope matching, `/permissions`, and TUI
   choices behind compatibility-preserving policy adapters.
3. Land the persistent context ring and interactive `/context` controls, then
   pressure-driven compaction and quality/no-progress gates.
4. Land the structured update service, live TUI banner, dismissal, and install
   provenance handling as an isolated vertical slice.
5. Run the cross-feature matrix: compaction invalidates cache predictably,
   update UI never steals approval/editor input, and resumed sessions restore
   context checkpoints but never grants.
6. Change the default from `warn` to automatic compaction only if the recorded
   evaluation gate passes; otherwise ship the discoverable session opt-in and
   keep the default honest.

## Milestone 14: Structured session history and faithful resume (completed)

Goal: persist the complete provider-neutral, model-visible conversation across
completed tool exchanges so a resumed model can use prior calls, outputs, and
failures without restoring authority or an unfinished execution. The detailed
contract, migration, provider mapping, security rules, test matrix, and delivery
order live in [Structured Session History and Resume Implementation
Plan](history/v0.3.3/STRUCTURED_SESSION_HISTORY.md).

- [x] Introduce canonical user, assistant, tool-call, and paired tool-result
  content blocks in `@forge/core`
- [x] Build canonical deltas directly at model-visible runtime commit boundaries
  instead of deriving normal session writes from UI events
- [x] Add strict session schema v3, checkpoint v2, and lossless v1/v2 migration
  with all-or-nothing trace-assisted tool-history backfill
- [x] Project canonical history through OpenAI, DeepSeek, compatible Responses,
  compatible Chat Completions, and Codex App Server paths
- [x] Keep trace-first UI replay and provide a structured canonical fallback
  when traces are missing, without duplicating answers
- [x] Make context selection, compaction, hashing, and cache diagnostics preserve
  closed tool-call/result boundaries
- [x] Prove redaction, fresh approvals, no dangling calls, cross-provider
  fallback, old-session readability, and interrupted-write recovery
- [x] Update current-product English/Chinese and packaged documentation only in
  the release that implements and verifies the behavior

Acceptance criteria:

- Resume gives the model the same portable completed tool history as an
  equivalent uninterrupted session.
- No snapshot, migration, compaction, or provider projection can create an
  orphan result, dangling call, restored approval, or executable pending state.
- Missing traces reduce display detail but do not erase canonical structured
  history or block a safe continuation.
- All native providers and the Codex Engine pass offline projection and resume
  contracts; live-provider checks remain explicit opt-in.

## Later extensions

These items are intentionally unordered and are not part of the current v0.3.3
release:

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
