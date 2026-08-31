# Forge v0.3.4 Implementation Plan

[简体中文](zh-CN/V0_3_4_IMPLEMENTATION_PLAN.md) · [Roadmap](ROADMAP.md)

> **Document role: current development plan.** This document defines the
> proposed v0.3.4 implementation and acceptance contract. It does not describe
> shipped behavior or prove release, package, or live-provider status. Current
> source and tests remain authoritative until each stage is implemented.

## Status and decision summary

v0.3.4 will focus on four observed product problems rather than add a new
provider or broaden Forge's authority:

1. Replace the model-facing `create_file` and `apply_patch` choice with one
   `edit_file` contract supporting safe create, exact replacement, and guarded
   whole-file rewrite operations.
2. Split the 4,646-line `apps/cli/src/interactive-ui.tsx` by responsibility
   while preserving terminal behavior and keeping one compatibility facade.
3. Make `/context` mode changes reversible: users must be able to move between
   `warn` and automatic compaction for the current session and save either as
   their user default.
4. Reproduce and eliminate the `MaxListenersExceededWarning` observed after an
   interactive resume instead of hiding it by raising the listener limit.

The automatic-compaction product default remains `warn` at the start of this
work. v0.3.4 may change that default only if the recorded deterministic and
explicit opt-in live quality gates in this plan pass. The other three work
streams do not depend on that default changing.

## Evidence that motivates the release

### File-edit selection failure

The current built-ins expose two write tools:

- `create_file` accepts `{ path, content }`, creates with exclusive `wx`
  semantics, and returns `already_exists` instead of replacing a path.
- `apply_patch` accepts `{ path, edits: [{ oldText, newText }] }`, requires each
  `oldText` to match exactly once, and returns `stale_patch` for missing,
  ambiguous, or concurrently changed content.

The registered descriptions already mention "new" versus "existing" files,
but the field schemas have no model-facing descriptions and the name
`apply_patch` suggests a conventional patch grammar that Forge does not accept.
In an observed DeepSeek session, the model read `style.css`, successfully
updated two other existing files with `apply_patch`, then called `create_file`
for the already-read stylesheet. The call failed with `already_exists`, and the
model recovered by retrying `apply_patch`. This proves that missing file-state
knowledge is not the only cause; the current choice itself introduces a wasted
model step, approval interaction, and tool failure.

### Context control is one-way

The current persistence surface exposes `enableAutoForSession()`,
`saveAutoDefault()`, and `pauseAuto()`. The `/context` panel wires only the first
two plus compact/preview actions. `saveAutoDefault()` always persists
`context.mode: "compact"`; there is no UI action to set the active session back
to `warn` or save `warn` as the user default. `pauseAuto()` is not wired to the
panel and represents a circuit-breaker state, not a durable `warn` preference.

The configuration writer already accepts `off`, `warn`, or `compact`, so the
missing behavior belongs to the interactive session and presentation contract,
not to a new configuration file format.

### Interactive lifecycle warning

An observed cross-process resume printed:

```text
MaxListenersExceededWarning: Possible EventEmitter memory leak detected.
11 resize listeners added to [WriteStream].
```

This is current reproduction evidence, not yet a root-cause diagnosis. The
implementation must capture `--trace-warnings` evidence and listener counts
before deciding whether the leak is in Forge lifecycle ownership, Ink render
cleanup, a terminal-size hook, or another dependency path. Calling
`setMaxListeners()` is explicitly not an acceptable fix.

## Design references and lessons

Forge will borrow principles, not blindly copy a provider-specific wire format:

- OpenAI's Apply Patch tool exposes one trained operation family for create,
  update, and delete using V4A diffs. It is a provider-native tool without a
  custom input schema; Forge cannot assume DeepSeek or compatible endpoints
  have received the same training.
- Aider selects among whole-file, SEARCH/REPLACE, fenced, and simplified
  unified-diff formats because model families have different editing
  reliability.
- OpenCode exposes exact `edit`, overwrite-capable `write`, and patch-text
  `apply_patch` paths under one permission class.
- Gemini CLI exposes overwrite-capable `write_file` plus exact `replace`, and
  requires a diff confirmation for writes.

References:

- [OpenAI Apply Patch](https://developers.openai.com/api/docs/guides/tools-apply-patch)
- [Aider edit formats](https://aider.chat/docs/more/edit-formats.html)
- [OpenCode tools](https://dev.opencode.ai/docs/tools/)
- [Gemini CLI file-system tools](https://google-gemini.github.io/gemini-cli/docs/tools/file-system.html)

The v0.3.4 default must remain a provider-neutral JSON function tool because
all current native and compatible Forge adapters already project that contract.
A raw unified-diff or provider-native V4A path may be added later behind an
adapter capability only after it outperforms the structured contract on the
same tasks.

## Release goals

1. Remove the model's need to choose between separate create and update tool
   names for normal text-file editing.
2. Support efficient full-file restyling or regeneration without silently
   overwriting an unseen or concurrently changed file.
3. Preserve existing workspace boundaries, write approval, diff preview,
   cancellation, output bounds, trace, and session-history invariants.
4. Keep old session snapshots readable without rewriting canonical history or
   restoring historical tool authority.
5. Give the interactive CLI explicit module boundaries and one render owner.
6. Let the user enter and leave automatic compaction without editing JSON or
   restarting the process.
7. Prove that every interactive render/unmount path releases terminal
   listeners and shared clients.
8. Decide the automatic-compaction default from recorded quality evidence, not
   from deterministic token reclamation alone.

## Non-goals

- Adding file deletion to `edit_file`
- Allowing writes outside the canonical workspace
- Making arbitrary whole-file overwrite approval-free
- Replacing exact matching with fuzzy, semantic, or model-repaired edits in the
  default executor
- Implementing OpenAI V4A or a general GNU patch parser in v0.3.4
- Rewriting historical `create_file` or `apply_patch` calls in session v3
- Changing session, checkpoint, or trace schema versions solely for tool names
- Moving every `apps/cli/src` file into a new directory in one release
- Hiding listener growth with `EventEmitter.setMaxListeners()`
- Claiming live DeepSeek selection quality from scripted/fake-model tests
- Enabling automatic compaction by default before the quality gate passes
- Treating compaction checkpoints as trusted instructions, approvals, current
  verification, or canonical transcript replacement

## Cross-cutting invariants

### Authority and safety

- `edit_file` remains a `write` risk tool and every call follows the existing
  core policy, approval, execution, event, and trace path.
- Previewing an edit does not grant approval for a different path, operation,
  content, or workspace.
- Project instructions, Skills, checkpoints, resumed history, and tool results
  cannot enable writes or select a permission scope.
- Create never replaces an existing path; rewrite never creates a missing path.
- Replace and rewrite never discard a concurrent user edit.
- Cancellation before commit leaves the original file unchanged.
- Tool errors remain bounded structured results with no raw filesystem detail.

### History and migration

- Canonical session history keeps historical tool names and inputs exactly as
  the model saw them; it is not rewritten to make the new tool look older.
- A resumed model receives current tool definitions plus historical completed
  call/result blocks. Historical availability never makes an old tool
  executable.
- No migration restores a pending file write or approval.
- Display fallback must render both legacy and new tool events without
  fabricating a successful edit.

### Context and configuration

- `warn` and automatic compaction are user-selectable behavior modes;
  `paused` is a runtime safety state after cancellation, invalid output,
  repeated failure, or insufficient reclamation.
- A session-only selection is not serialized into the session snapshot and is
  not restored by `/resume`.
- Saving a user default writes only the context mode field and preserves all
  unrelated user configuration.
- An explicit session action may temporarily stop auto compaction even when
  the loaded effective configuration is `compact`; a new process reloads normal
  user/project precedence.
- If project configuration makes the effective mode stricter than the saved
  user default, the UI reports both the saved value and effective provenance.

## Work stream A: unified model-facing file editing

### A.1 Semantic contract

The stable semantic input is a discriminated operation family:

```ts
export type EditFileInput =
  | {
      readonly operation: "create";
      readonly path: string;
      readonly content: string;
    }
  | {
      readonly operation: "replace";
      readonly path: string;
      readonly edits: readonly {
        readonly oldText: string;
        readonly newText: string;
      }[];
    }
  | {
      readonly operation: "rewrite";
      readonly path: string;
      readonly content: string;
      readonly expectedSha256: string;
    };
```

The model-visible tool is:

```ts
const editFileTool: ForgeTool = {
  name: "edit_file",
  description:
    "Create a new text file, replace exact text in an existing file, or rewrite an existing file that was read at the supplied version. Never use create for an existing path.",
  inputSchema: editFileInputSchema,
  risk: "write",
  execute: editFile,
};
```

Every property receives a concise model-facing description. The semantic union
is fixed, but Phase A0 will compare two JSON Schema encodings before freezing
the wire representation:

1. A Zod discriminated union, which expresses branch requirements but may emit
   `anyOf`/`oneOf` that some compatible endpoints follow poorly.
2. A flat object with an `operation` enum and optional branch fields plus strict
   runtime cross-field validation, which is simpler for some models but less
   expressive in JSON Schema.

The same prompts, model settings, and executor are used for both candidates.
Selection is based on valid-call rate and first-call operation accuracy for
DeepSeek, then confirmed against deterministic schema projection for OpenAI and
compatible adapters. TypeScript elegance alone is not the selection criterion.

### A.2 Operation semantics

#### `create`

- Reuse `resolveNewToolPath()` and exclusive `open(..., "wx")` behavior.
- Require a non-empty workspace-relative path and at most 65,536 UTF-8 bytes of
  content, matching the current tool limit.
- Fail with `already_exists` if any path already exists.
- Preserve cleanup of partially created files on cancellation or write failure.
- Preview as `/dev/null` to `b/<path>`.

#### `replace`

- Reuse exact `oldText` to `newText` replacement behavior.
- Require 1-50 edits; each `oldText` is non-empty and must occur exactly once in
  the progressively updated content.
- Apply all edits to one file or apply none.
- Re-read immediately before writing and return `stale_patch` if the file
  changed after preparation.
- Preserve the current bounded unified-diff preview as presentation output;
  the model does not submit that diff grammar.

#### `rewrite`

- Require the target to be an existing regular UTF-8 file.
- Require `expectedSha256` from a prior `read_file` result.
- Extend `ReadFileOutput` with a stable lowercase SHA-256 digest of the exact
  returned full file content. A truncated read cannot authorize rewrite; its
  result marks the version unavailable for rewrite.
- Before preview and again immediately before commit, hash the current bytes
  and compare them with `expectedSha256`.
- Return `stale_file` if the version differs; instruct the model to read the
  file again before retrying.
- Generate a complete old-to-new diff for approval, bounded for display without
  weakening the underlying comparison.
- Never create a missing file and never reuse the create path as fallback.

`rewrite` exists for deliberate whole-file changes such as replacing a
stylesheet or generated configuration. It is not a generic blind `write_file`.
The content-version precondition prevents an already-read file from being
silently replaced after a user or another process changes it.

### A.3 Output and error contract

Successful calls return a shared envelope:

```ts
interface EditFileOutput {
  readonly operation: "create" | "replace" | "rewrite";
  readonly path: string;
  readonly bytes: number;
  readonly replacements?: number;
  readonly sha256: string;
  readonly diff: string;
}
```

The executor may use narrower internal results, but preview, trace summaries,
and tests use stable operation/path metadata. Expected failure codes are:

| Code | Meaning | Retry guidance |
| --- | --- | --- |
| `invalid_input` | Operation fields do not match the selected branch | Correct the call shape |
| `already_exists` | `create` targeted an existing path | Use `replace` or guarded `rewrite` |
| `not_found` | Existing-file operation targeted a missing path | Inspect workspace state |
| `not_file` | Target is not a regular file | Select a regular text file |
| `stale_patch` | Exact replacement context is missing, ambiguous, or changed | Re-read and use exact text |
| `stale_file` | Rewrite digest no longer matches | Re-read and pass the new digest |
| `outside_workspace` | Canonical path escapes the workspace | Choose an in-workspace path |
| `cancelled` | User or runtime cancelled before commit | Do not claim success |
| `io_error` | Bounded filesystem failure | Inspect/retry without exposing internals |

### A.4 Registry and compatibility strategy

- Register only `edit_file` in the model-facing built-in definition list.
- Keep `createFile()`, `applyPatch()`, and their schemas as internal/exported
  compatibility primitives during v0.3.4; do not duplicate their execution
  logic inside the new dispatcher.
- Stop advertising `create_file` and `apply_patch` to new model requests.
- Reserve all three names during the transition so a plugin cannot silently
  occupy a legacy built-in name and reinterpret resumed history.
- If a current model nevertheless calls an unadvertised legacy name, return a
  bounded `unknown_tool` result that says to use `edit_file`; do not execute it
  through a hidden alias.
- Do not mutate canonical historical calls. Trace and resume renderers continue
  understanding the legacy names.
- Increment `FORGE_PROMPT_SCHEMA_VERSION` because the stable tool name and
  schema change invalidate prompt-cache prefixes.

### A.5 Approval and presentation integration

Replace name-specific preview branches in `apps/cli/src/run.ts` with an
operation-aware `edit_file` preview. The approval descriptor remains derived by
the host from validated input.

TUI activity labels become:

```text
Preparing file creation · path
Creating file · path
Preparing file edit · path
Editing file · path
Preparing file rewrite · path
Rewriting file · path
```

The visible proposal may include the operation without requiring the user to
understand the wire schema:

```text
○ Proposed edit_file · rewrite style.css
◇ CONFIRM edit_file — The first workspace write requires approval.
✓ Completed edit_file · rewrite style.css
```

Diff styling remains structured Ink rendering with `ADD`/`DEL`, `+/-`, and
line-number cues. Raw ANSI strings are not injected into Ink components.

### A.6 Tool-choice evaluation

Add a deterministic evaluation contract and an explicit opt-in live runner.
The deterministic suite proves schemas, execution, errors, previews, cache
invalidation, and recovery; it cannot prove model selection quality.

The live DeepSeek matrix includes at least these tasks:

1. Create one explicitly absent file.
2. Make a small exact edit to a file the model read.
3. Rewrite most of an existing stylesheet after reading it.
4. Attempt create against an existing file and recover.
5. Change a file between read and rewrite and recover from `stale_file`.
6. Edit multiple existing files and create one new file in one task.

Compare current two-tool baseline, union-schema candidate, and flat-schema
candidate with the same model ID, thinking setting, effort, prompt, workspace,
and limits. Record:

- task success
- first write-call operation accuracy
- schema-valid call rate
- unnecessary failed write calls
- model steps and approvals before first successful write
- input/output/reasoning tokens when reported
- final filesystem grader result

Raw credentials and complete private traces are not checked in. A bounded,
redacted report belongs under `evals/reports/v0.3.4/` only when the evaluation
is actually run and reviewed.

## Work stream B: interactive CLI decomposition

### B.1 Target layout

Keep `apps/cli/src/interactive-ui.tsx` as a small compatibility facade so
`session.ts`, `resume.ts`, and external imports do not change in the first move.
Create:

```text
apps/cli/src/interactive/
  app.tsx                 # top-level state composition and phase routing
  lifecycle.tsx           # one Ink render owner and terminal cleanup
  types.ts                # shared interactive-only state types
  providers.tsx           # provider/model/login/logout selectors
  prompt.tsx              # editor, cursor, completion, footer
  transcript.tsx          # canonical/run-event mapping and rendering
  context.tsx             # context panel, mode selector, indicator
  approvals.tsx           # approval, permissions, diff presentation
  resources.tsx           # plugin/resource/trust panels
  activity.ts             # run activity derivation and formatting
```

Existing focused modules such as `interactive-model.ts`, `markdown.tsx`,
`persistent-session.ts`, `provider-setup.tsx`, `run.ts`, and `update.ts` keep
their current locations during this release. Moving every CLI file would create
large path-only diffs without improving the four release outcomes.

### B.2 Dependency direction

```text
interactive-ui.tsx facade
          |
          v
interactive/lifecycle.tsx ---> interactive/app.tsx
                                      |
                 +--------------------+--------------------+
                 v                    v                    v
          pure UI panels       domain hooks/state     existing CLI services
                                                            |
                                  run.ts / persistent-session.ts / update.ts
```

- Panel modules may import Ink, React types, interactive types, and pure
  formatters.
- Panels do not load configuration, create model clients, execute tools, or
  persist sessions.
- `app.tsx` coordinates domains but does not own the process-level render.
- `lifecycle.tsx` owns exactly one `render()` instance and all process stream
  cleanup for one interactive invocation.
- `packages/core`, `packages/persistence`, and `packages/tools` never import the
  interactive directory.

### B.3 Extraction order

1. Move pure types and formatter functions with their focused tests.
2. Move leaf panels without changing props or snapshots.
3. Move transcript and run-activity derivation.
4. Move provider/resource/context/approval state into domain hooks or
   controllers only after render parity is established.
5. Move the `InteractiveApp` shell and leave re-exports in the facade.
6. Isolate lifecycle/render ownership and add repeated mount/unmount tests.

Each extraction commit must pass focused UI tests and `git diff --check`. Do not
combine the mechanical move with new context behavior or tool UI semantics.

### B.4 Maintainability acceptance

- `interactive-ui.tsx` becomes a facade containing exports and CLI entry
  wiring, not thousands of lines of state/render logic.
- No extracted leaf panel imports `runTask`, configuration loaders, session
  stores, or provider clients.
- One module owns process-level Ink render/unmount.
- Existing exports (`InteractiveApp`, `runInkInteractiveFromCli`, keyboard-mode
  helpers, panels used by tests) remain available through the facade for the
  transition.
- Wide and narrow render snapshots preserve meaningful content, semantic
  colors, Enter/newline/Ctrl+C behavior, approvals, completion navigation, and
  screen-reader-visible text.

## Work stream C: reversible context-mode controls

### C.1 State model

Separate three concepts that the current UI partially conflates:

```ts
type ConfiguredContextMode = "off" | "warn" | "compact";
type SessionContextOverride = "warn" | "compact" | undefined;
type AutoCompactionState = "inactive" | "armed" | "compacting" | "paused";
```

The existing public pressure labels may remain `warn`, `auto-session`,
`auto-default`, and `paused`, but they are derived from the configured mode,
session override, and safety state instead of serving as the mutable source of
truth.

Replace one-way persistence methods with symmetric intent methods:

```ts
interface InteractiveSessionPersistence {
  setContextModeForSession?(mode: "warn" | "compact"): void;
  saveContextModeDefault?(mode: "warn" | "compact"): Promise<{
    readonly path: string;
    readonly savedMode: "warn" | "compact";
    readonly effectiveMode: "off" | "warn" | "compact";
    readonly effectiveSource: string;
  }>;
  compact?(dryRun: boolean): Promise<string>;
}
```

`pauseAuto()` remains an internal failure/cancellation transition or is renamed
to make that role explicit. Selecting `warn` is not represented as `paused`.

### C.2 `/context` interaction

Replace the one-way shortcut row with:

```text
m change mode · c compact now · p preview · Esc close
```

`m` opens a selector whose choices depend on effective state:

```text
Context mode

› Warn for this session
  Auto for this session
  Save warn as user default
  Save auto as user default
```

When auto is paused by the no-progress guard, also offer `Resume auto for this
session`. Saving a default is never implied by selecting a session mode.

After every action, refresh the same `ContextStatus` snapshot used by the footer
and panel. Render explicit confirmation:

```text
Context mode · warn for this session
Context mode · auto for this session
Saved context mode "warn" in /…/.forge/config.json
```

If a project-level `compact` setting remains effective after saving the user
default `warn`, render:

```text
Saved user default: warn
Effective mode: auto · project .forge/config.json
```

Do not claim that the effective mode changed when precedence prevented it.

### C.3 Session and resume behavior

- `Warn for this session` immediately prevents pressure-driven checkpoint
  generation but keeps manual `/compact` available.
- `Auto for this session` arms pressure-driven compaction until exit, explicit
  warn selection, or a safety pause.
- Neither session choice is serialized or restored.
- Saving a user default updates `$FORGE_HOME/config.json` while preserving all
  other fields.
- A new process loads the saved user default and applies normal project/CLI
  precedence.
- `/clear`, `/new`, and `/resume` reset transient activity and safety state but
  do not silently rewrite the saved preference.

### C.4 Automatic-default release gate

Changing `DEFAULT_CONTEXT_CONFIGURATION.mode` and the config-schema default
from `warn` to `compact` is the final optional stage, not a prerequisite.

Required evidence:

- deterministic safety and resume suites have zero invariant regressions
- no request exceeds the declared input budget
- median projected input reclamation is at least 30% on the long-session matrix
- task pass rate regresses by no more than 5 percentage points versus `warn`
- explicitly seeded durable-constraint recall is at least 95%
- edited-file tracking, unresolved work, and verification provenance survive
- no duplicated user request or tool side effect occurs during recovery
- repeated low-value compaction pauses rather than loops
- a bounded opt-in live DeepSeek report passes the same task-quality criteria

Because the observed DeepSeek model advertises a very large context window, the
live harness may use an isolated lower activation threshold and synthetic
completed history. The report must disclose that configuration and must not
present it as naturally reaching 78% of a 1M-token session.

If any quality gate fails, v0.3.4 ships reversible controls and keeps the
product default `warn`. That outcome is a successful scoped release, not a
reason to block the file editor or CLI lifecycle work.

## Work stream D: terminal listener lifecycle

### D.1 Reproduction before repair

Add a diagnostic path that runs only in tests or explicit local diagnosis:

1. Record `process.stdout.listenerCount("resize")` and relevant stream event
   names before render.
2. Start and exit/resume the interactive UI repeatedly with controlled TTY-like
   streams.
3. Record counts after `waitUntilExit()`, explicit unmount, and client cleanup.
4. Run the observed path with `node --trace-warnings` to capture the listener
   registration stack.
5. Separate same-process repeated render behavior from a true cross-process
   resume; listeners cannot cross an operating-system process boundary.

The warning text alone does not prove the exact owner. The trace and count
delta determine whether Forge, Ink, `useWindowSize`, or test/render reuse needs
the fix.

### D.2 Lifecycle contract

- One `runInkInteractiveFromCli()` invocation owns one Ink instance.
- Every exit path—normal `/exit`, double Ctrl+C, initialization failure,
  rejected resume, thrown task error, and process cancellation—unmounts that
  instance exactly once.
- Shared Codex App Server clients close after UI exit and are not recreated by
  component re-render.
- Effects that subscribe to streams, timers, signals, update services, or
  model events return cleanup functions.
- Cleanup is idempotent so an error followed by `finally` does not remove
  another invocation's listener.
- Listener counts return to their pre-render baseline after each completed
  invocation.

### D.3 Regression tests

- Mount/unmount the real interactive shell at least 12 times against one
  controlled output stream and assert no warning plus baseline listener count.
- Exercise resize delivery while mounted and verify the UI still updates.
- Exercise resume, `/new`, `/clear`, normal exit, and cancellation.
- Assert no leaked timers, signal handlers, Codex clients, or update-service
  subscriptions.
- Keep an actual Ghostty manual smoke in the release checklist because mocked
  streams cannot prove terminal reflow behavior.

## Module change map

| Area | Current files | Planned responsibility |
| --- | --- | --- |
| Tool schema/execution | `packages/tools/src/create-file.ts`, `apply-patch.ts`, `read-file.ts`, `registry.ts` | Add `edit-file.ts`, digest/version output, dispatcher, model registry transition |
| Core runtime/policy | `packages/core/src/runtime.ts`, `approval.ts`, `cache.ts` | Preserve generic tool path; update prompt schema version and fixtures, no provider-name branches |
| Native adapters | `packages/model-deepseek`, `packages/model-openai`, `packages/model-compat` | Verify the same model definition projects correctly; no edit semantics in adapters |
| CLI approval | `apps/cli/src/run.ts` | Operation-aware edit preview and output |
| Interactive UI | `apps/cli/src/interactive-ui.tsx` | Compatibility facade; move behavior into `apps/cli/src/interactive/` |
| Context persistence | `apps/cli/src/persistent-session.ts` | Symmetric session/default mode methods and provenance-aware result |
| Configuration | `packages/config/src/loader.ts`, `schema.ts` | Reuse mode writer; change default only after gate |
| Persistence/resume | `packages/persistence`, `apps/cli/src/resume.ts` | Keep schemas; render legacy/new completed history safely |
| Evaluations | `evals/src`, `evals/reports/v0.3.4/` | Deterministic contracts plus explicit opt-in reviewed reports |
| Documentation | Roadmap and current product guides | Keep this plan separate from shipped behavior until implementation lands |

## Test matrix

### Tools

- create new empty/non-empty UTF-8 files
- reject existing path, traversal, symlink-parent escape, directory target, and
  missing parent according to current semantics
- exact single/multiple replacements and ordered edit application
- missing and ambiguous `oldText`
- rewrite with matching digest
- rewrite after external modification
- rewrite with truncated/unavailable read version
- cancellation before preparation and before commit
- bounded diff/output, multibyte UTF-8, final newline, and 65,536-byte limits
- model schema exports only `edit_file` and contains no execute callback

### Runtime, policy, and history

- first workspace write confirms; approved session scope remains narrow
- failed edit does not widen or reuse approval incorrectly
- canonical call/result pairs remain closed for every operation and failure
- legacy session history resumes without schema migration
- current model definitions do not advertise legacy tools
- cache-prefix reason records the tool-schema change
- plugin reserved-name collision is deterministic and actionable

### CLI and Ink

- create/replace/rewrite diff preview in color and `NO_COLOR`
- narrow/wide panels retain `ADD`/`DEL` cues
- activity target and completion/failure labels include operation/path
- existing keyboard submission/newline/Ctrl+C behavior is unchanged
- context mode selector handles arrows, Enter, Escape, and narrow terminals
- saved/effective provenance messages are accurate
- 12 repeated mount/unmount cycles leave listener counts unchanged

### Context

- warn → auto-session → warn in one process
- warn → save auto default → save warn default
- auto-default → warn session without mutating disk
- project compact + saved user warn reports effective project compact
- safety pause is distinguishable from selected warn
- resume does not restore a session override
- manual compact remains available in warn
- cancellation/low reclamation pauses auto without corrupting the session

### Provider and evaluation

- DeepSeek mocked tool round trip for every edit operation
- OpenAI and compatible schema projection without provider-specific execution
- fake-model deterministic recovery from `already_exists`, `stale_patch`, and
  `stale_file`
- explicit opt-in DeepSeek selection matrix and compaction quality matrix
- no paid provider request in `pnpm test` or `eval:deterministic`

## Delivery sequence

### Phase 0: baselines and decisions

- Check in deterministic tool-contract fixtures.
- Add the opt-in tool-choice evaluator without claiming a result.
- Capture current two-tool DeepSeek baseline when explicitly authorized.
- Reproduce listener growth with traces and counts.
- Freeze the semantic `edit_file` union and select its JSON Schema encoding.

Exit gate: baseline artifacts distinguish deterministic behavior, live model
selection, and terminal lifecycle evidence.

### Phase 1: `edit_file` executor

- Add read digest/version metadata.
- Implement create/replace/rewrite preparation and execution by reusing current
  primitives.
- Add focused tool tests, failure codes, and previews.
- Keep the existing model registry unchanged during this phase.

Exit gate: executor contracts pass without changing model behavior.

### Phase 2: model registry and CLI migration

- Advertise `edit_file`; remove legacy names from current model definitions.
- Update prompt-schema version/cache diagnostics.
- Update approval preview, activity labels, reserved names, runtime/history
  fixtures, and adapter projections.
- Run the opt-in DeepSeek comparison when authorized.

Exit gate: offline cross-provider contracts pass; reviewed live evidence shows
the candidate is not worse than baseline before deleting transition code.

### Phase 3: behavior-preserving UI extraction

- Extract pure panels, formatters, and types.
- Move state domains and top-level app behind the facade.
- Preserve snapshots and keyboard semantics at every commit.

Exit gate: facade remains compatible and focused/full UI tests pass with no
intended product-output change.

### Phase 4: context mode selector

- Add symmetric session and persisted mode methods.
- Add selector, confirmation messages, and provenance display.
- Add transition, resume, and configuration-preservation tests.

Exit gate: every auto state has a visible route back to warn, and saving either
default is verified on disk.

### Phase 5: lifecycle repair

- Apply the smallest fix supported by the captured listener stack.
- Centralize render/unmount ownership.
- Add repeated lifecycle regression and Ghostty smoke.

Exit gate: listener counts return to baseline without increasing max listeners.

### Phase 6: compaction quality decision

- Run deterministic warn/compact matrix on final code.
- Run explicitly authorized live DeepSeek quality trial.
- Publish a bounded redacted report.
- Change the default only if every gate passes; otherwise record why it remains
  `warn`.

### Phase 7: release hardening

- Update current-product English and Chinese guides to actual behavior.
- Move this plan to `docs/history/v0.3.4/` only after implementation status is
  final and update `docs/catalog.json` in the same change.
- Create release evidence only from exact candidate HEAD.
- Run all gates below before tag, push, npm publication, or GitHub Release.

## Validation commands

Focused checks during implementation:

```bash
CI=true pnpm exec vitest run packages/tools/src/tools.test.ts
CI=true pnpm exec vitest run packages/tools/src/recovery.test.ts
CI=true pnpm exec vitest run apps/cli/src/run.test.ts
CI=true pnpm exec vitest run apps/cli/src/persistent-session.test.ts
CI=true pnpm exec vitest run apps/cli/src/interactive-ui.test.tsx
```

Candidate gates:

```bash
CI=true pnpm check
CI=true pnpm test
CI=true pnpm eval:deterministic
node scripts/build-doc-index.mjs
CI=true pnpm check:docs
CI=true pnpm package:verify
git diff --check
```

Live-provider evaluations remain explicit opt-in and must never be added to the
default test command. Loopback provider-route tests may require permission to
bind `127.0.0.1`; a sandbox `EPERM` is reported as an environment limitation,
not silently classified as a product regression.

## Release acceptance criteria

### Required for v0.3.4

- New model requests advertise one `edit_file`, not separate create/update
  names.
- Create, exact replace, and guarded rewrite preserve workspace and concurrency
  safety.
- Existing v0.3.3 sessions resume without mutation or restored authority.
- DeepSeek live selection evidence, when claimed, is current, bounded, and
  compared against baseline; otherwise the release states that only offline
  behavior was validated.
- `interactive-ui.tsx` is a compatibility facade and interactive domains have
  explicit module boundaries.
- Users can select warn or auto for the session and save warn or auto as their
  user default entirely from `/context`.
- Saved preference and effective project/CLI precedence are not conflated.
- Repeated interactive lifecycle tests and a Ghostty resume smoke produce no
  listener warning or listener-count growth.
- Full offline, deterministic, documentation, package, and installed CLI gates
  pass on exact candidate HEAD.

### Conditional default change

- Automatic compaction becomes the product default only if every Phase 6
  threshold passes and the report is reviewed before the code default changes.
- If it remains `warn`, release notes say so explicitly and document the fully
  reversible `/context` controls.

## Rollback strategy

### File editor

- Keep old execution primitives for one release so the model registry can be
  reverted without recovering user data.
- No session schema migration means rollback does not rewrite snapshots.
- If live selection regresses, re-advertise the two legacy definitions while
  retaining `edit_file` behind a disabled experiment; do not alias unsafe
  overwrite behavior.

### Interactive decomposition

- Preserve the facade and public exports so individual extraction commits can
  be reverted independently.
- Do not mix module moves with behavior changes, making regression bisection
  and rollback practical.

### Context controls

- Both `warn` and `compact` already belong to config schema v1. A rollback can
  read either saved value without migration.
- Never remove unrelated user configuration while reverting a mode selection.
- If a new default is rolled back, change only the code/config default; do not
  overwrite users who explicitly saved `compact`.

### Listener repair

- Revert only the lifecycle change if terminal compatibility regresses.
- Retain the reproduction test and trace evidence even if the first fix is
  withdrawn.
- Never replace the repair with a higher listener ceiling.

## Documentation scope

This plan is `current-development` and is not packaged as product help. During
implementation, update current-product pages only when their described behavior
exists and is verified:

- `ARCHITECTURE.md`: built-in tool table and interactive module boundary
- `CLI_UI.md`: edit activity, `/context` selector, and mode labels
- `CONFIGURATION.md`: reversible user default and effective precedence
- `CONTEXT_MANAGEMENT.md`: selected/default/paused distinction and final rollout
- `SESSIONS.md`: legacy tool-history compatibility if user-visible
- `SECURITY_MODEL.md`: rewrite precondition and unchanged authority boundary
- `TROUBLESHOOTING.md`: stale-file recovery and terminal listener diagnosis
- `PRODUCT.md`: only if the default compaction policy changes

Every English change has a mutually linked Simplified Chinese equivalent. Any
add, delete, move, or role change updates `docs/catalog.json`; product-help
resources are regenerated only from `currentProduct`. Release reports belong in
`evals/reports/v0.3.4/`, not in this plan.
