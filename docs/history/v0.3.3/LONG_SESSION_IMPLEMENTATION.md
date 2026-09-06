# Forge v0.3.3 Detailed Implementation Plan

[简体中文](../../zh-CN/history/v0.3.3/LONG_SESSION_IMPLEMENTATION.md) · [Roadmap](../../ROADMAP.md) · [Context management](../../CONTEXT_MANAGEMENT.md)

> **Document role: historical design record.** This preserves the Milestone 13
> design and delivery decisions. It cannot independently establish current
> implementation, release status, or live-provider quality.

## Status and purpose

This is the detailed design and implementation record for Roadmap Milestone 13. Stages 13.0–13.5 have been implemented on the development branch. Since the live semantic-quality gate has not yet run, automatic compaction remains opt-in; this document cannot establish that v0.3.3 has been released.

The release theme is **long-session efficiency and user control**. Four problems share the runtime, TUI, traces, and trust boundary and therefore need to be designed together:

1. Context pressure must remain visible and support automatic management at safe points.
2. Safe coding workflows should not repeatedly ask users to approve identical actions.
3. New versions should be announced inside the TUI without interrupting ongoing work.
4. Forge must measure prompt caching before claiming to optimize it.

## Agreed directions

- Keep the deterministic extractive checkpoint as a fallback and test oracle; it is insufficient to justify enabling automatic compaction by default.
- Keep `warn` as the default until deterministic evaluation and explicit opt-in live quality gates pass. Users must also be able to discover and enable automatic compaction in the TUI without editing JSON.
- Keep a segmented ring and percentage beside the input area; `/context` expands an interactive panel using the same state.
- The percentage represents projected next-request input divided by available input, not historical transcript size divided by the raw model window.
- Automatic compaction may be enabled for the current session only. Saving it as a user default must be a separate explicit action.
- Permission improvements use narrow, inspectable session grants. v0.3.3 does not add persistent unrestricted authorization or restore grants on resume.
- Update discovery is asynchronous and non-blocking. Installation remains explicit and respects the detected installation source.
- Deliver cache telemetry and stable-prefix hashing before changing defaults, so costs and latency can be compared with a baseline.

## Existing foundation and gaps

| Area | Implemented foundation | v0.3.3 gap |
| --- | --- | --- |
| Context | Per-step budgets, pressure snapshots/ring, interactive `/context`, session/default automatic controls, canonical transcripts, checkpoints, `/compact`, no-progress pause, and bounded overflow recovery | The extractive fallback has not passed the live production-quality gate, so the default remains `warn` |
| Permission | Structured allow-once/session/deny, canonical scopes, high-risk reconfirmation, `/permissions`, denial feedback, and plugin policy tightening | Grants deliberately exist only in memory and are not restored |
| Update | Structured state, live Ink banner, dismissal, bounded registry fetch, explicit npm/pnpm installation, and refusal for unknown sources | Installation remains explicit; the current process still requires a restart |
| Cache | Provider-specific read/write usage, per-step and aggregate ratios, stable-prefix hashes, invalidation reasons, and cache capability descriptors | Keyed/breakpoint controls remain disabled until the specific adapter endpoint explicitly declares support and passes tests |

Main implementation entry points:

- `packages/core/src/context.ts`, `runtime.ts`, `policy.ts`, `model.ts`
- `packages/persistence/src/session-store.ts`, `schema.ts`, `trace-store.ts`
- `apps/cli/src/persistent-session.ts`, `run.ts`, `interactive-ui.tsx`, `inspect.ts`, `update.ts`
- `packages/model-openai`, `packages/model-deepseek`, `packages/model-compat`

## Product and security invariants

- Preserve the canonical transcript without loss. Compaction may change only the active model view and checkpoint metadata.
- Never silently discard current instructions, the current request, mandatory tool schemas, pending protocol state, or required tool results.
- Checkpoints are untrusted historical memory. They cannot grant approvals, restore trust, change policy, or establish current verification status.
- Project files may tighten context behavior, but cannot persist user grants, expand permissions, select an update installer, or disable guards requested by the user.
- Provider-specific caching and compaction mechanisms belong in adapters; core consumes only capabilities and normalized events.
- Unknown telemetry must stay unknown. Missing cache usage cannot become zero, and conservative token estimates cannot masquerade as exact percentages.
- Update state does not enter model prompts, transcripts, or session memory.
- Checking for or displaying updates must not also modify existing credentials, configuration, sessions, traces, or plugins.

## Overall architecture

```text
editor draft + attachments
          |
          v
ContextProjectionService -----> ContextPressureSnapshot
          |                              |
          |                              +--> persistent footer ring
          |                              +--> interactive /context panel
          |                              +--> activation prompt
          v
preflight budget --> compaction coordinator --> active request view
                           |                         |
                           +--> checkpoint store    +--> model adapter

tool proposal --> core policy --> scope matcher --> approval channel --> execute
                                      |                    |
                                      +--> session grants  +--> TUI panel

model finish --> cache observation --> trace/inspect --> prefix diagnostics

update cache/fetch --> UpdateState store --> TUI banner --> explicit installer
```

The four features share structured events and presentation, but their authority must remain separate: a context choice cannot approve a tool; an update notification cannot take editor input; a cache key cannot become a permission identity.

## 1. Context pressure, automatic compaction, and TUI controls

### 1.1 Pressure definition

```text
pressure = projectedInputTokens / availableInputTokens
availableInputTokens = contextWindowTokens - max(outputReserve, safetyBuffer)
```

`projectedInputTokens` estimates what Forge will actually send next:

- Effective system and project instructions.
- Stable Skill/resource catalog metadata and selected resource bodies.
- Advertised tool schemas.
- Active checkpoint memory and retained verbatim turns.
- Provider continuation and protocol-required tool results.
- The current editor draft and estimated image attachments.

Idle estimates use a local conservative estimator; refreshing the ring must not call a provider. Actual usage from the previous step is only a calibration input, not the projection for the next request.

Suggested data shape:

```ts
interface ContextPressureSnapshot {
  readonly schemaVersion: 1;
  readonly modelId: string;
  readonly estimatedInputTokens: number;
  readonly availableInputTokens: number;
  readonly ratio: number;
  readonly confidence: "exact" | "estimated" | "unavailable";
  readonly mode: "warn" | "auto-session" | "auto-default" | "paused";
  readonly state:
    | "normal"
    | "elevated"
    | "compact-soon"
    | "compacting"
    | "compacted"
    | "critical"
    | "paused";
  readonly lastCompaction?: ContextCompactionSummary;
}
```

This is an illustrative contract. Any actual persistence or trace boundary requires versioning and schema validation.

### 1.2 Persistent context ring

The first line of the input area shows the model, effort, and context; the second preserves shortcuts:

```text
› Describe what you want Forge to do...

  gpt-5.x · high                              ◑ 58% context · warn
  Shift+Tab effort · Enter submit · Ctrl+C cancel
```

| Projected pressure | Glyph | State |
| --- | --- | --- |
| 0-24% | `○` | normal |
| 25-49% | `◔` | normal |
| 50-74% | `◑` | elevated |
| 75-89% | `◕` | warning / compact soon |
| 90%+ | `●` | critical |

Color is supplemental and cannot be the only signal. Show estimates as `~78%` and unavailable values as `?`. Responsive layout:

```text
Wide terminal    ◕ 78% context · auto
Narrow terminal  ◕ 78%
Very narrow      ◕
```

Draft changes update the projection through debouncing or inexpensive memoized calculation. The ring must not cause cursor jitter, take keyboard ownership, or trigger provider calls.

### 1.3 Interactive `/context` panel

```text
╭ Context management ─────────────────────────╮
│ Model          gpt-5.x                      │
│ Pressure       ◕ 78% · estimated            │
│ Mode           Warn only                    │
│ Strategy       Provider native -> summary   │
│ Recent tail    12K tokens                   │
│ Last compact   Never                        │
│                                             │
│ a  Enable auto compact                      │
│ c  Compact now                              │
│ p  Preview compaction                       │
│ Esc close                                   │
╰─────────────────────────────────────────────╯
```

Enabling automatic compaction presents another choice:

```text
1  Current session only
2  Save as my user default
3  Cancel
```

Session mode exists only in memory. User-default mode updates user configuration through the existing validation and atomic configuration path; project configuration cannot initiate either action.

### 1.4 Activation and compaction state machine

```text
warn
  | first threshold crossing
  v
offer compact once / auto-session / dismiss
  | auto enabled
  v
monitor pressure --> compact-soon --> compacting
                                      | success
                                      v
                                  compacted --> monitor
                                      |
                              failure or low yield
                                      v
                                    paused
```

Initial experiments use 75–80% projected pressure as the activation range. Final thresholds belong to model capabilities/configuration and evaluation evidence, not presentation code. The coordinator must also consider projected growth and minimum useful reclamation to avoid compacting every turn.

The initial no-progress hypothesis is to pause when reclamation is below the greater of 8,000 tokens or 20% of projected input. This is a tuning value, not a public compatibility promise.

### 1.5 Compaction pipeline

The coordinator runs only at safe boundaries:

1. Recompute the final request budget.
2. Preserve mandatory instructions, the current request, and protocol state.
3. Bound or replace stale, completed tool output.
4. Select only a completed historical prefix and preserve the configured recent tail.
5. Prefer provider-native opaque compaction when the adapter declares support and safe round-tripping is possible.
6. Otherwise generate a structured Forge summary and validate its size, safety label, provenance, source hash, and retained-tail hash.
7. Use a deterministic extractive checkpoint only as a fallback.
8. Rebudget and require meaningful reclamation.
9. Save the checkpoint atomically while preserving the canonical transcript.
10. Emit completed/failed/paused events and update the UI snapshot.

A structured summary retains only historical information that remains relevant:

```ts
interface ForgeConversationSummary {
  readonly userGoals: readonly string[];
  readonly constraints: readonly string[];
  readonly decisions: readonly { decision: string; reason?: string }[];
  readonly touchedFiles: readonly string[];
  readonly completedWork: readonly string[];
  readonly unresolvedWork: readonly string[];
  readonly historicalVerification: readonly string[];
}
```

Every field remains untrusted memory. `historicalVerification` must identify results as coming from an earlier run, not current evidence. The schema should prohibit approval and credential fields instead of relying only on prompt reminders.

### 1.6 User feedback

The transcript shows concise system status, not the summary body:

```text
✓ Context compacted · 86K -> 34K
  Provider-native · retained 6 recent turns
```

For low yield:

```text
⚠ Compaction reclaimed only 4%
  Automatic compaction paused to avoid a loop
```

Separately measured generation usage may be reported. Do not estimate monetary cost without current provider pricing and product support.

## 2. Scoped permission system

### 2.1 Core decision model

Change the approval channel from `boolean` to a structured response:

```ts
type ApprovalResponse =
  | { readonly decision: "allow-once" }
  | { readonly decision: "allow-session"; readonly scope: ApprovalScope }
  | { readonly decision: "deny"; readonly feedback?: string };
```

Policy still decides only `allow`, `confirm`, or `deny`. Only `confirm` enters the approval channel. Core determines which candidate scopes the UI may offer; the model cannot author grant scopes itself.

Each action provides an approval descriptor:

```ts
interface ApprovalDescriptor {
  readonly actionId: string;
  readonly title: string;
  readonly effect: "read" | "write" | "process" | "network" | "model";
  readonly target: Readonly<Record<string, string | number | boolean>>;
  readonly riskFlags: readonly string[];
  readonly preview: ApprovalPreview;
  readonly allowedSessionScopes: readonly ApprovalScope[];
}
```

### 2.2 Scope identity

| Action | Candidate session identity | Conditions requiring a new prompt |
| --- | --- | --- |
| Workspace write | Canonical workspace plus the displayed file/directory scope | Canonical path escapes the boundary, workspace changes, or the action becomes destructive |
| Process | Program, exact arguments or an explicitly supported prefix, cwd, environment class, and timeout ceiling | Arguments/cwd change, timeout increases, shell semantics appear, or risk flags change |
| Network | Tool identity, scheme, canonical host, and optional port | Redirect/destination/tool or private-network policy changes |
| Delegated model | Registered tool/subagent identity and bounded role | Task exceeds the displayed role, tool set changes, or budget expands |

Do not fingerprint unresolved globs, shell-rendered display strings, or natural-language explanations. Matching must use the same canonical values as execution.

### 2.3 Session grant lifecycle

- A grant belongs to one active session and canonical workspace.
- By default it is stored only in memory, never in a session snapshot.
- `/resume`, `/new`, process restart, workspace changes, and explicit revocation clear grants.
- Traces record scope IDs, decisions, provenance, and use counts for auditing, but replaying traces does not restore authority.
- Destructive, credential-sensitive, publish/install, broad external-effect, and policy-designated operations always require renewed confirmation or denial.
- Plugin policy hooks may only tighten decisions. They cannot add candidate scopes or turn deny/confirm into allow.

### 2.4 Approval and `/permissions` UI

```text
╭ Approval required ──────────────────────────╮
│ $ pnpm test                                 │
│ Working directory  /workspace               │
│ Scope offered      exact command this session│
│                                             │
│ 1  Allow once                              │
│ 2  Allow this scope for the session         │
│ 3  Deny                                    │
╰─────────────────────────────────────────────╯
```

`/permissions` shows the effective profile and provenance, active grants, use counts, high-risk overrides, and revocation controls. Denial may include bounded feedback such as “run only the targeted tests.” It returns as a denial result and never implies approval.

## 3. Prompt cache optimization

### 3.1 Measure first

Normalize each provider step when data is available:

```ts
interface PromptCacheObservation {
  readonly inputTokens?: number;
  readonly cacheReadTokens?: number;
  readonly cacheWriteTokens?: number;
  readonly uncachedInputTokens?: number;
  readonly hitRatio?: number;
  readonly stablePrefixHash: string;
  readonly capability: "automatic" | "keyed" | "breakpoints" | "unsupported";
  readonly invalidationReasons: readonly string[];
}
```

Produce `hitRatio` only when provider usage semantics support the calculation. `undefined` must remain unavailable in the trace schema, summaries, and UI.

### 3.2 Stable prefix layout

```text
stable prefix
  1. Forge core contract + prompt-schema version
  2. user/project instructions resolved in deterministic order
  3. stable Skill/resource catalog metadata
  4. stable tool definitions + JSON schema

dynamic suffix
  5. explicitly selected or loaded Skill bodies
  6. per-turn plugin prompt contributions
  7. context checkpoint memory
  8. retained conversation + continuation
  9. current request, images, and tool results
```

Provider serialization may constrain this layout. Adapters must expose which parts can actually remain stable; core cannot assume all wire formats are identical.

### 3.3 Cache keys and invalidation

When keyed caching is supported, derive a non-secret identifier from:

```text
provider + model + promptSchemaVersion + canonicalWorkspaceId
+ instructionHash + resourceCatalogHash + toolSchemaHash
```

The current user prompt is not part of the stable key. Use hashes; do not additionally send raw paths or prompt text in metadata.

| Change | Expected result |
| --- | --- |
| Only the user request changes | Preserve the stable prefix |
| Provider/model | Invalidate |
| Instruction content/order | Invalidate |
| Enabled Skill/plugin or tool schema | Invalidate |
| Reasoning/provider option that changes request semantics | Invalidate |
| New compaction checkpoint | Intentionally start a new prefix |
| Append a tool result to an unchanged continuation | Preserve the earlier prefix when the protocol permits |

`forge inspect` reports actual provider cache usage separately from local changes that may cause invalidation. A matching local hash does not establish a provider cache hit.

## 4. In-TUI update experience

### 4.1 Structured update service

Turn the existing checker into a state producer:

```ts
type UpdateState =
  | { readonly kind: "disabled" }
  | { readonly kind: "cached"; readonly latest: string; readonly checkedAt: string }
  | { readonly kind: "refreshing"; readonly previous?: string }
  | { readonly kind: "current"; readonly checkedAt: string }
  | { readonly kind: "available"; readonly latest: string; readonly checkedAt: string }
  | { readonly kind: "failed"; readonly retryAfter?: string };
```

Retain the 24-hour cache, bounded timeout, atomic owner-only cache file, CI suppression, and environment-variable disable mechanism. Expected background failures remain quiet; explicit `forge update check` continues to provide detailed, authoritative output.

### 4.2 TUI behavior

Render the available state inside Ink without adding it to model history:

```text
╭ Update available ───────────────────────────╮
│ Forge 0.3.3 -> 0.3.4                        │
│ Run `forge update` · Release notes · Dismiss│
╰─────────────────────────────────────────────╯
```

- Cached results may appear immediately; fresh results may asynchronously update the current TUI.
- The banner must not take input from the editor, approval, login, or another modal.
- Record dismissal per version; explicit commands remain available.
- Narrow terminals may wrap or abbreviate, but must not hide the version change.
- Update status is UI/application state, not a transcript message.

### 4.3 Installation provenance

Before installing or displaying an exact command, resolve supported provenance such as npm-global or pnpm-global from executable/package metadata and bounded environment evidence. Do not infer Homebrew or another manager from a path substring alone. For unknown sources, show only the version and documentation rather than guessing a global installation command.

Installation remains explicit and uses `program + args[]` with `shell: false`. Continue disabling lifecycle scripts where the supported installer permits, and explain the required restart. Tests verify that `$FORGE_HOME` data is unchanged before and after installation.

## 5. Events, persistence, and compatibility

Planned event families:

- `context.pressure.updated`, `context.auto.enabled`, `context.auto.paused`, and existing compaction events with richer results.
- `approval.scope.offered`, `approval.scope.granted`, `approval.scope.matched`, `approval.scope.revoked`.
- `model.cache.observed`, `model.cache.invalidated`.
- Application-level update state for the TUI. Passive startup noise does not enter traces; only explicit update commands record events.

Persistence rules:

- Context checkpoints remain versioned, hash-validated session data.
- Session automatic mode and permission grants remain ephemeral; only explicitly saved context defaults enter user configuration.
- Dismissed update versions belong to user-level application state, not project configuration.
- New optional trace fields must remain compatible with older summaries; missing fields mean unavailable, not zero.

## 6. Implementation file map

| Area | Likely files | Responsibility |
| --- | --- | --- |
| Context contract | `packages/core/src/context.ts`, `runtime.ts` | Pressure snapshots, triggers, compaction coordinator, events |
| Permission contract | `packages/core/src/policy.ts`, `tools.ts`, `runtime.ts` | Descriptors, candidate scopes, matching, structured responses |
| Usage/cache | `packages/core/src/model.ts`, provider adapters/transports | Normalized usage, capabilities, stable provider options |
| Persistence | `packages/persistence/src/schema.ts`, `session-store.ts`, `trace-store.ts` | Schema migration, checkpoint integrity, summaries |
| CLI assembly | `apps/cli/src/run.ts`, `persistent-session.ts` | Prefix composition, session context mode, dependency wiring |
| TUI | `apps/cli/src/interactive-ui.tsx`, `commands.ts` | Ring, panels, keyboard ownership, responsive rendering |
| Inspect | `apps/cli/src/inspect.ts`, `ask.ts` | Cache/context/approval reports and unavailable values |
| Update | `apps/cli/src/update.ts`, `program.ts` | State service, cache, provenance, explicit installation |
| Evaluation | `evals/` and package/CLI tests | Fixtures, metrics, release reports |

No new workspace package is needed initially. Extract a package only when implementation demonstrates a stable dependency boundary reused by multiple applications.

## 7. Testing and evaluation plan

### Deterministic unit and integration tests

- Exact pressure arithmetic, subtracting reserve only once, draft/image projection, unknown-model fallback, and percentage confidence.
- Threshold crossing, one-time activation offers, session/default choices, compaction success/failure/cancellation, and no-progress pause.
- Summary schema validation, redaction, source/tail hashes, resume equivalence, and canonical transcript preservation.
- Stable prefixes, every invalidation input, missing cache usage, aggregation, append-only continuation, and prefix changes after compaction.
- Approval once/session/deny, exact and near-match scopes, revocation, workspace changes, timeout ceilings, destructive overrides, plugin tightening, and resume.
- Cached/fresh update states, late delivery, malformed semver, timeout, CI/disabled behavior, dismissal, provenance, failed installation, and data protection.

### Visual and interaction tests

Render in representative narrow and wide terminals:

- The editor with every ring/state/confidence combination.
- A two-line footer that preserves Enter, Shift/Meta+Enter, Ctrl+J, and Ctrl+C behavior.
- `/context`, activation, approval, and `/permissions` panels.
- Update banners arriving during editing, streaming, and approval waits.
- Long paths, commands, versions, translated labels, and `NO_COLOR`.

String assertions are not visual acceptance. Inspect actual rendered frames for alignment, wrapping, contrast, cursor ownership, and scrollback.

### Long-session evaluation fixtures

Beyond task completion, each fixture checks whether Forge preserves:

- The current user goal and explicit constraints.
- Modified files and files that remain relevant.
- Completed and unresolved work.
- Decisions and their reasons.
- Historical verification provenance without claiming it as a current result.
- Safe behavior when old text requests approval or policy changes.

Compare `warn`, `auto-session`, and user-default automatic mode on identical inputs. Measure estimated/provider tokens, cache reads/writes, compaction count, reclaimed tokens, latency, approval count, time waiting for approval, and no-progress pauses.

Live provider trials require explicit opt-in and never belong to the default test suite. Provider-specific caching or compaction claims require current primary documentation and actual redacted usage evidence.

## 8. Suggested PR sequence

### PR 1: Contracts, baseline, and cache telemetry

- Add versioned events and optional usage fields.
- Establish the v0.3.2 fixture baseline.
- Add stable-prefix hashes and invalidation diagnostics without changing provider behavior.

### PR 2: Stable prefixes and adapter capabilities

- Refactor deterministic prompt composition.
- Add prompt-cache/native-compaction capability descriptors.
- Preserve provider continuation and verify cache accounting.

### PR 3: Scoped permission core

- Add descriptors, structured approval responses, a session scope store, matching, trace events, and compatibility adapters.
- Preserve existing UI behavior until contract tests pass.

### PR 4: Permission TUI

- Add numbered approval choices, denial feedback, `/permissions`, and revocation.
- Verify narrow/wide terminals and keyboard ownership.

### PR 5: Persistent context UI

- Add the projection service, ring, two-line footer, interactive `/context`, and activation prompts without changing the default mode.

### PR 6: Pressure-driven compaction

- Add staged reclamation, structured summary validation, provider-native paths, no-progress pause, feedback, persistence, and resume tests.

### PR 7: Update vertical slice

- Add structured update state, live banners, per-version dismissal, provenance, and protected-data tests.

### PR 8: Cross-feature evaluation and release

- Test cache invalidation after compaction, update arrival during approval, and resume restoring checkpoints without restoring grants.
- Update current product documentation only for behavior actually delivered.
- Run release verification and determine whether the gates permit changing the default from `warn` to automatic compaction.

## 9. Release gates

v0.3.3 may be released only when:

- Deterministic long-session fixtures preserve goals, constraints, touched files, unresolved work, resume behavior, and safety.
- The recorded live quality thresholds pass before any default change.
- Context indicators have truthful semantics, respond stably, and connect to actionable controls.
- Representative scoped grants reduce repeated approvals, while all near-match and high-risk fixtures still prompt again or deny.
- Cache accounting is correct and provider capabilities are explicit, without promising a universal hit rate.
- Update discovery is non-blocking, understands installation provenance, remains explicit, and demonstrates that existing `$FORGE_HOME` data is unchanged.
- The `0.3.3` build, checks, full offline tests, documentation/link checks, deterministic evaluation, packed artifacts, installed CLI smoke tests, and version consistency checks all pass.

If the compaction quality gate does not pass, v0.3.3 may still deliver the ring, interactive controls, session opt-in, scoped permissions, cache telemetry, and update banner, but must honestly retain `warn` as the default.

## 10. Open decisions requiring evidence

- Final pressure thresholds for different model capabilities, and whether a separate projected-growth trigger is needed.
- Which Forge/provider model generates the fallback structured summary, its cost ceiling, and cancellation semantics.
- Whether exact-command session grants suffice or a small set of audited structured command families is needed.
- Which installation provenance v0.3.3 can reliably identify on macOS, Linux, and Windows.
- Whether the current provider SDK exposes sufficiently stable prompt-cache controls, or a provider should initially deliver telemetry only.

When tests or current provider behavior resolve these questions, update this document and the Roadmap together.
