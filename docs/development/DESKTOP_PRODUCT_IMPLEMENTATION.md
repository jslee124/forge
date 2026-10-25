# Forge Desktop Productization Implementation

[简体中文](../zh-CN/development/DESKTOP_PRODUCT_IMPLEMENTATION.md) · [PRD](DESKTOP_PRODUCT_PRD.md) · [Roadmap](ROADMAP.md) · [Documentation index](../README.md)

Date: 2026-10-25. Status: presentation, durable-history, investigation, and bounded-finalization increments implemented; remaining gates pending. This is a layered development
contract and task list, not shipped behavior. New filenames, types, fields, and
configuration below are proposed; section 2 separately identifies existing code.
Resolve PRD/implementation disagreements in both documents before implementing.

## Implementation progress

The 2026-10-25 increment connects application product-run/session-view projections,
Desktop v2 events and version checks, structured approvals/action binding, detailed
outcomes, fragment aggregation, queued approvals, and result cards. Tool-only
messages no longer create avatars. Submitted prompts and next drafts are separate;
completion preserves newer drafts. See [ADR-0002](../decisions/0002-desktop-run-presentation-contract.md).

This partially implements T01/T04/T08–T11, not all of M1. Wire v2 currently retains
text/detail/action/phase/approval/approval-resolved/complete payload names as an
incremental migration rather than claiming the entire section 4 protocol.
Unavailable Codex counters are omitted; its tool activity remains descriptive.
The follow-ups below add durable activity restoration, investigation tools, and native Desktop finalization.
Explicit summarize/continue/retry remain pending. The 24-task live baseline and five-user
trial have not run; deterministic reproductions do not substitute for them.

Task status `[ ]` means pending and `[~]` means partial/not through the complete gate.

Validation on 2026-10-25 (local development build):

- `CI=true pnpm exec vitest run apps/desktop/src packages/application/src/product-run.test.ts packages/application/src/persistent-session.test.ts`: 125 passed; six live-model opt-in tests skipped.
- `CI=true pnpm eval:deterministic`: 71 passed.
- `CI=true pnpm check`, `CI=true pnpm check:docs`, and `CI=true pnpm desktop:build` passed.
- From `apps/desktop`, `CI=true FORGE_UI_OUTPUT=/tmp/forge-productization-ui node scripts/acceptance-ui.mjs` exercised isolated configuration, a scripted loopback provider, and real Electron/main/preload/Agent IPC. Approval → allow once → answer, cancellation, and failure recovery passed. Screenshot inspection covered expanded approval details at 840×800 and expanded activity; decision buttons remained visible with no page horizontal overflow. The existing locale/theme layout matrix also ran.
- Regressions cover 10,000 reasoning deltas, actionId-bound decisions, protocol version/malformed events, step limits, unchanged canonical history, newer drafts surviving completion, and retained approval controls after rejected decision/cancel requests.

This does not establish live-provider quality, the 24-task baseline, user trials,
crash recovery in that first increment, installed-package behavior, or release acceptance. Activity
was memory-only in that first increment; the follow-up below adds durable records.

Layout follow-up on the same date: transcript, composer, approval, and result
surfaces share width/gutters. At conversation widths below 740px, permission,
engine, model, and send/stop controls use a single icon row with current-value
tooltips and complete options on activation. Wider columns retain permission/model
text, use the engine brand mark, cap the model control at 200px, and omit redundant
engine/model labels. Compact
controls preserve accessible names and keyboard focus. macOS toolbar, sidebar
toggle, and window controls gain top spacing.
Electron acceptance adds 720/840/980/1100 widths × workbench open/closed geometry
checks for overflow, overlap, squeezed icons, top inset, and transcript/composer
alignment, plus hidden long labels and single-row compact controls, alongside the existing screenshot matrix. The 13 renderer regressions,
type checks, and desktop build passed.

## Durable-history follow-up (2026-10-25)

[ADR-0003](../decisions/0003-desktop-durable-run-records.md) records the durability
boundary. [Run store](../../packages/persistence/src/product-run-store.ts) and
[browser-safe schemas](../../packages/persistence/src/product-run-schema.ts)
implement private versioned summaries, ordered JSONL, redaction, 16 MiB per-run
journals with a 1 MiB control reserve, explicit omission, and bounded index pages.
[Application recording/projection](../../packages/application/src/product-run-history.ts)
serializes writes and projects historical facts without restoring authority.

Desktop saves a discoverable session/run before acknowledging admission. Native
control events and approval decisions await recording before further tool effects.
Terminal intent → canonical session commit → final product summary is the order;
storage failure cannot produce a successful live result. Under a session lease,
reopening reconciles unfinished work to interrupted, started tools without results
to unknown, and old pending decisions to unresolved. A terminal intent is accepted
only with canonical run membership; no tools, approvals or continuations replay.
The workbench Activity tab provides paginated run selection and read-only details.

This is partial T02/T03, not a completed M1 gate. Codex tools remain opaque and
cannot get a native before-effect guarantee. Per-run quotas are not lifetime
retention; reconciliation still scans summary pages. Legacy ownerless lock files
fail closed. Process-interruption fixtures do not prove power-loss or installed
package recovery.

The fixed [24-task manifest](../../evals/fixtures/desktop-product/manifest.json),
[seed](../../evals/fixtures/desktop-product/seed/), and
[round preparer](../../evals/src/desktop-product-evaluation.ts) partially implement
T00. Prepare two new, separate directories using:

```bash
CI=true pnpm eval:desktop:prepare --output /tmp/forge-product-round-1 --round 1
CI=true pnpm eval:desktop:prepare --output /tmp/forge-product-round-2 --round 2
```

Both pin the same model configuration and fixture SHA-256 values; every assessment
starts `not_run`. Preparation makes no provider calls and does not grade answers.
Fault entries specify required injection, not completed automated fault execution.
The real model's availability/capabilities, two scored rounds, independent task
assertions, and five-user trial still require separate evidence.

Local validation: 140 focused tests passed (six live opt-in tests skipped), 82
deterministic tests passed, and `pnpm check`/`pnpm desktop:build` passed. Coverage
includes large single chunks, 10,000 fragments, quota pressure, pagination,
symlink rejection, partial journals, missing indexed summaries, canonical commit
proof, read-only reopening, and recording failure before a tool can execute.
An additional 50 Codex/gateway regressions passed. `pnpm package:verify` passed.
The real Electron acceptance harness exercised a renderer reload, visible historical
selection with recorded tool success, no restored approval controls, and no extra
scripted-provider calls while reading history. It also passed the existing
approval/stop/failure workflow and 720/840/980/1100 layout matrix. The Activity tab
places records first and collapses context diagnostics. UI output is local at
`/tmp/forge-durable-ui/`; this is scripted loopback evidence, not a live model run.

## Investigation-tool follow-up (2026-10-25)

T05 now has streaming 1-based line windows, explicit EOF/range/scan metadata,
metadata resource versions, UTF-8-safe output, and no rewrite hashes from partial
reads. Search adds merged bounded context and restricted workspace-relative
include/exclude globs; it explicitly advertises literal-only capability rather
than arbitrary regex. Existing edit-file full-hash/stale checks remain in force.
The [investigation contracts](../../packages/tools/src/investigation.test.ts)
cover middle-file reads, EOF, Unicode, scan limits, cancellation, path boundaries,
context merging, filtering, metacharacters, and omission disclosure.
See the [current tool contract](../product/concepts/ARCHITECTURE.md) for exact fields
and limits. This tool increment does not establish live-model investigation quality. The
following increment adds T06 finalization; T05 remains partial until product acceptance.

Local checks for this increment: 54 tool tests, 102 deterministic contract tests,
and 37 Desktop/application/cache regressions passed. `pnpm check`,
`pnpm check:docs`, `pnpm desktop:build`, and `pnpm package:verify` passed.
These are local scripted/source-contract checks, not live-model evaluation or
installed Desktop acceptance.

## Reserved-finalization follow-up (2026-10-25)

[ADR-0004](../decisions/0004-reserved-desktop-finalization.md) records the opt-in
core boundary. Native Desktop enables `completionPolicy: reserve-final-step`;
CLI, gateway, child runs, and Codex retain existing defaults. The final logical
model step is reserved within the configured total. A one-step budget is
answer-only. Tool-allowance exhaustion and oversized batches also stop tools and
request a partial answer; refused calls receive paired nonexecuted results.

The [runtime](../../packages/core/src/runtime.ts) retains tool schemas, original
prompt/history, exact observed results and adapter continuation while requesting
`toolChoice: none`. OpenAI Responses, DeepSeek chat, and compatible chat/Responses
transports project that option. Unknown transport capability, context admission
failure, ignored none, incomplete streams and model errors use bounded factual
fallbacks without a new attempt. Cancellation stays cancelled. Finalization text
is buffered until a valid tool-free stop so rejected or incomplete summaries are
not presented as a finished answer.

The [read-progress guard](../../packages/core/src/read-progress.ts) stops three
consecutive unchanged versioned `read_file` steps. It compares normalized input,
resource version and observed output, ignoring attempt IDs. Unknown versions,
changed evidence, failed/mixed operations, process and network calls do not
trigger it. No results are cached by this guard.

Completion remains `limit_reached` with a structured reason and `partial: true`.
Desktop shows finalizing/partial states; history preserves the flag. A no-progress
stop has its own investigation-stopped label. Complete pending exchanges are
retained without duplicating final prose in canonical outcome records.

Validation: 124 deterministic tests and 226 Desktop/application/provider regression
tests passed (six opt-in live tests skipped). This includes real serialized HTTP
request assertions for none plus retained schemas; no external provider was used.
The isolated real Electron fixture performed exactly two scripted model requests
and one read, retained partial metadata, and showed the partial summary with the
budget result. Existing approval/stop/failure and layout checks passed. Local UI
artifacts are `/tmp/forge-finalization-ui/`. `pnpm check` and `pnpm desktop:build`
passed; `pnpm check:docs` and `pnpm package:verify` also passed.

T06 remains partial until its broader product acceptance; this does not complete
M2/T07, two live-model baseline rounds, user trials, installed Desktop acceptance,
or release gates. Transport-owned retry limits remain distinct from logical
runtime model-step accounting.

## Reviewed-recovery follow-up (2026-10-25)

[ADR-0005](../decisions/0005-reviewed-desktop-run-recovery.md) records the recovery
boundary. Native finished runs expose summarize, continue with a new budget, and
edit/retry. Each action reviews source, prompt, model/effort, budget and permissions.
A process-local single-use preparation is bound to the source fingerprint, session
revision and configuration. Submission rechecks these under leases and executes
with the checked configuration snapshot. Changes require a new review; no old
approval or provider continuation is restored.

Summaries use bounded redacted facts, one logical model step and zero tools,
bypassing project instructions, Skills and plugins. When unavailable they return
recorded factual fallback; partial output never establishes task success. The
source link and recovery kind persist into history. A summary links back to the
original task for continue/retry. Continue uses fresh normal policy checks and
requires inspecting current state. Retry loads an editable original prompt only
after explicit draft replacement; sending is separate. Summary/continue preserve
the next draft; retry pins reviewed model/permissions until unlinked.

Native-only scope and missing original canonical prompts are explicit limits.
A first-run crash can leave a preview sufficient for summary but insufficient for
retry. No automatic resumption, durable grant, new Codex recovery, richer delivery
artifact model, or concurrent-session browsing is included. T07 is partial.

Validation: 223 Desktop/application/finalization/persistence regression tests and
128 deterministic contracts passed; six opt-in live tests were skipped. The real
Electron fixture confirmed one schema-free summary HTTP request, zero summary
tools, preserved drafts, explicit replacement/cancel, source navigation, linked
edited retry, and visible confirmation controls at 840×600. With no tools the SDK
omits the optional `tool_choice` HTTP field; core still requests none and refuses
any returned tool calls. Local UI artifacts are `/tmp/forge-recovery-ui/`.
`pnpm check`, `pnpm check:docs`, `pnpm desktop:build` and `pnpm package:verify`
passed. These are local scripted checks, not external-provider, installed-app or
release acceptance.

## Factual-delivery follow-up (2026-10-25)

T07/T10 now include a bounded read-only delivery view. Native `edit_file` and
`run_command` results gain optional structured observation fields before raw JSON
output is clipped. Recorded file writes include operation, path, byte count and
bounded patch; command observations include displayed command, working directory,
exit code, timeout, signal, and bounded stdout/stderr excerpts. `ok: true` from a command tool does not imply a zero
process exit or successful verification. Answers are never parsed for these facts.

The application projects delivery from the on-disk run journal, upserting action
IDs and disclosing row/character omissions. Each category is limited to 100 rows
and all three share a 262,144-character projection budget. Activity strips the
extra observation fields and retains its independent output budget. Desktop
shows a collapsible view with 10-row increments, recorded patches and explicit
preview of the current file through the existing workspace-bound file service.
Opening history or previewing a file does not execute a command. A recorded patch
is not a baseline diff of the current workspace and does not attribute later edits.

Legacy successful operations without the new fields remain unstructured; their
JSON and model prose are not promoted into delivery facts. Codex records disclose
unknown structured coverage. Failed, denied, unresolved and proposed operations
remain distinct; empty lists are not proof that the whole task is complete. The
view does not infer which command is a test or whether it covers the requested
behavior. Existing workspace diff inspection retains its attribution limitations.

This increment does not complete live-model/user/installed-app release gates,
all renderer decomposition work, separate viewed/active sessions, or a semantic
verification plan. T07/T10 remain partial until their full acceptance criteria.

Validation: 230 Desktop/application/finalization/persistence regressions and 133
deterministic contracts passed; six opt-in live tests were skipped. The
[delivery contracts](../../packages/application/src/run-delivery.test.ts) cover
nonzero exit/timeout/unknown, legacy prose, bounded facts, redaction and omission.
The real Electron loopback fixture made exactly three model HTTP requests for a
write, an approved command exiting 1, and an answer. It displayed the real error
output despite a success claim, preserved the recorded patch after an unrelated
file edit, previewed current content separately, and read history after reload
without another execution. English current and Chinese 840px historical views
were captured at `/tmp/forge-delivery-ui/`; the dark diff was visually checked.
`pnpm check`, `pnpm check:docs`, `pnpm desktop:build` and `pnpm package:verify`
passed locally. External providers and installed Desktop were not exercised.

## Independent conversation browsing follow-up (2026-10-25)

T08 now separates the execution session from a read-only browsed conversation.
The preceding delivery increment is committed as `efd678a`. While a run is active,
sidebar selection uses `browse-session`; idle selection retains normal explicit
resume behavior. A viewed conversation after completion requires “Continue this
task” before sending. The backend keeps its execution session, revision, leases,
configuration, and pending approvals unchanged during a browse.

`browse-session` is available during execution and projects a saved snapshot and
bounded run history. It does not create/resume a session, reconcile unfinished
records, restore grants, prepare recovery or call a model. Messages are limited
to the latest 1,000 with a shared 262,144-character budget and explicit omission
notice. Historical file actions and recovery are disabled until the conversation
becomes the execution session; file services therefore cannot silently open a
path in the wrong workspace.

The renderer's `useConversationBrowser` owns navigation requests and an in-memory
cache for 50 recent view positions. Drafts keep their existing session keys;
transcript/panel scroll positions and tagged activity, approval and delivery
disclosures restore per conversation. The active run's live answer, actions and
approval queue stay separate from saved messages. A persistent navigation bar
identifies the execution task, counts pending approvals, returns to it and stops
that exact run. Approval controls appear only after returning to the execution
conversation, so incoming approvals do not steal focus from a historical draft.
Late snapshots are ignored after navigation; background completion refreshes the
execution state without changing the viewed conversation or its draft.

One execution remains the limit. Browsing is snapshot observation, not another
live session. Navigation cache/drafts are not made durable by this increment;
full renderer decomposition, streaming/follow-scroll stress, accessibility and
installed-app gates remain pending. T08 stays partial until those acceptance
items are complete.

Local validation: 237 Desktop/application/finalization/persistence regressions and
133 deterministic contracts passed; six opt-in live tests were skipped. The
[backend contract](../../apps/desktop/src/agent/application.test.ts) verifies
snapshot bytes and execution-session identity stay unchanged while approval is
pending, and a normal resume is still rejected while busy. The
[renderer contracts](../../apps/desktop/src/renderer/src/live-workbench.test.tsx)
cover separate drafts/messages, focus, restored positions/disclosures, successful
and cancelled background completion, explicit continuation and late-read discard.
The isolated real Electron fixture exercises approval → browse a different
workspace → type a draft → return/approve, plus stop from the browsed conversation.
It verifies no added model requests during browsing and includes 840px return
controls. Local screenshots are `/tmp/forge-browsing-ui/`. `pnpm check`,
`pnpm check:docs` and `pnpm desktop:build` passed. This is scripted-loopback
acceptance, not live-provider quality, installed-app or release evidence.

## Reading, zoom and accessibility follow-up (2026-10-25)

T11/T12 gain a reproducible local acceptance path in
`apps/desktop/src/main/experience-acceptance.ts`. Before changes, the isolated
Electron stream stayed 3735 CSS pixels above the tail, and at 200% zoom the
composer control was outside the viewport despite no horizontal page overflow.

- `Transcript` follows new output until the user scrolls upward, then preserves
  reading position and exposes Jump to latest. Returning to a cached conversation
  retains its position; an explicit new submission requests following.
- Text chunks are coalesced per animation frame, with immediate terminal flush,
  stale-frame cancellation and explicit omission at the existing preview limit.
  Completed message Markdown is memoized. This is bounded rendering behavior,
  not a measured frame-rate or provider-latency claim.
- Answers and fenced code have copy controls with truthful failure feedback.
  Code and tables have named keyboard-scrollable containers; nested code `pre`
  markup is removed. Only the streaming article is busy; the entire transcript
  is no longer a live region. Decorative avatars do not repeat their identity.
- Completion/delivery surfaces scroll with the transcript. Short viewports reduce
  toolbar/composer heights and keep approval review/decision controls reachable;
  during approval at low height the composer is hidden while its draft is retained.
  Focus returns from a disappearing approval/stop control without interrupting a
  different conversation's draft.

Run from `apps/desktop` after `CI=true pnpm desktop:build`:
`FORGE_T12_MODE=verify FORGE_UI_OUTPUT=/tmp/forge-t12-ui-final node scripts/acceptance-ui.mjs`.
The fixture exercises 60 paragraphs, pause/resume, 100 ordered deltas, answer/code
copying, EN/ZH × light/dark × 1100/840 widths × 100%/200% zoom, native keyboard
input and approval, reduced-motion emulation and a Chromium accessibility-tree
snapshot. Clipboard writes are intercepted only inside the isolated fixture;
the user's system clipboard is not modified. Existing approval, recovery,
delivery and independent-browsing acceptance still runs first.

Validation: 151 Desktop/application tests passed, six live-model tests skipped;
133 deterministic evaluations, root check, docs check and Desktop build passed.
The final Electron fixture succeeded; `/tmp/forge-t12-ui-final/ui.json` records
97 captures including the 16 new locale/theme/width/zoom combinations. Native
Enter submission, Shift+Enter newline, approval at 200% zoom and focus restoration
passed. The composition event only proves the synthetic guard. The local
walkthrough is `/tmp/forge-t12-ui-final/audit.md`. Both configuration and Chromium
profiles are isolated; captures wait for fonts and finite animations to settle.

T12 remains partial: an accessibility tree and synthetic composition guard do
not establish VoiceOver speech, actual native IME candidate interaction, WCAG
conformance or installed macOS/Windows behavior. Manual accessibility and native
IME checks precede the T13 live-task rounds/user trial. Temporary screenshot and
JSON outputs are local development evidence, not versioned release evidence.

## Packaged macOS/native-input probe (2026-10-25)

A fresh arm64 0.4.0 `.app` from the current workspace was copied to an isolated
Applications directory and launched through LaunchServices with a clean PATH,
empty proxy settings and isolated Forge home. Packaged resources, Chinese
workspace paths, plugin install/enable, session resume, PDF text/canvas and Agent
shutdown passed (`modelCalls: 0`). A separate isolated visible window confirmed
Chinese paste, native Shift+Enter newline, Enter submission, Tab from composer to
attachment, and actual macOS quit/Keep working preserving the draft, followed by
Exit. This is unsigned local `.app` evidence, not DMG/Gatekeeper, notarization,
Windows or live-provider evidence.

The first-run probe exposed missing configuration guidance: an unconfigured model
can be submitted and only yields generic failure plus `configuration-invalid` in
expanded diagnostics. It also creates an Empty session/UUID workspace and offers
unhelpful continuation actions. The native quit confirmation remains English in
a Chinese UI. These are open product findings, not fixed in this probe.

Local report and screenshots: `/tmp/forge-native-input/evidence/report.md`;
raw packaged result: `/tmp/forge-native-input/evidence/installed.json`.
VoiceOver speech and native IME candidate confirmation remain unverified: input
source/keystroke and Cmd+F5 attempts did not provide observable candidate/speech
proof. T12 remains partial. The report records the small manual checks still needed.

## First-send setup and actionable failures (2026-10-26)

This follow-up addresses the missing-configuration/native-language findings above.
Before session creation, Desktop requests a fresh local readiness check for the
actual selected engine/model. Native checks use current configuration,
endpoint-scoped credential status and the same adapter constructor as execution;
no model request is made. Explicit `auth: none` routes are supported. Codex checks
its own account access and does not reuse Forge API-key authentication. Runtime
validation still runs; readiness is neither a permission grant nor a guarantee of
remote availability. Existing previews or old servers without readiness fail closed.

A blocked send retains the draft, creates no session/run and shows a specific
configuration action. Returning from Models & access retains the request for an
explicit resend. Configuration failures during execution also link to settings
and suppress budget-recovery actions. Current automatic workspaces use a readable
label, and empty-session display names are localized without rewriting history.

Core `RunResult` now carries optional bounded transport facts (HTTP status and
retryability only) from `ModelProviderError`. The application projects known
401/403, missing-response retryable errors, 429 and 5xx into stable failure codes;
Desktop presents access, connection, quota and service guidance. Unknown errors
remain generic. The existing durable reason enum and history schema are retained;
old readers can show the code as diagnostics. No credentials, response bodies,
error causes or authority are copied into these facts. Canonical history and
CLI/gateway execution defaults remain unchanged. Transport facts lacking a status
support connection guidance, not a claim about the underlying network cause.

A sender-validated locale IPC synchronizes the application's EN/ZH setting with
native quit/update dialogs; the OS locale remains the fallback until synchronization.
Configuration/access errors offer configuration; known transient provider failures
offer explicit edit/retry, rather than unrelated new-budget controls.

Validation on the final local development build: 190 Desktop/core/application
tests passed, six live-model opt-in tests skipped; 134 deterministic evaluations,
root check and Desktop build passed. The isolated Electron acceptance covers
blocked first send → settings → retained draft, both native-dialog languages,
scripted HTTP 401/429/503 and socket interruption through the real adapter/Agent/IPC,
plus the existing approval, recovery, delivery, browsing and T12 matrix. Local
screenshots/manifest are under `/tmp/forge-onboarding-acceptance/`; these are
development evidence, not a release or live-provider quality claim. The previous
installed 0.4.0 local build has not been replaced by this source increment.
VoiceOver, native IME candidates and T13 user trials retain their prior limits.

## 1. Goal and invariants

Complete the native-engine investigation → approval → execution → verification →
delivery/recovery path while maintaining CLI, gateway, Codex, and old-session
boundaries. PRD R01–R15 are the acceptance identifiers.

1. Core owns policy, budgets, cancellation, context, and authorization semantics;
   the renderer cannot grant execution authority.
2. Canonical history remains model-context truth. Presentation records neither
   continue model execution nor restore authority.
3. Adapters own provider continuation. Never reconstruct it from UI text, logs,
   or historical summaries.
4. Effects still pass existing path checks, policy, approval, workspace lease,
   and tool boundaries.
5. One active execution. Viewed history and execution targets are separate;
   approvals, unfinished calls, and processes do not resume automatically.
6. Keep tool exits, recorded writes, model narrative, user-goal success, and
   release evidence distinct.
7. Preserve user changes. Do not attribute the entire workspace diff to Forge or
   automatically commit/push/deploy.

## 2. Current source baseline

Static pre-implementation baseline from 2026-10-25; changes are tracked above, not live evidence.

| Existing fact | Source | Proposed change |
| --- | --- | --- |
| Core has tool lifecycle, approval scopes, and detailed RunStatus | [runtime](../../packages/core/src/runtime.ts), [approval](../../packages/core/src/approval.ts) | Preserve and extend with convergence events |
| Application composes model, tools, policy, and sessions | [run](../../packages/application/src/run.ts), [persistent session](../../packages/application/src/persistent-session.ts) | Add product-run coordination, projection, recovery |
| Desktop converts approvals to descriptions and tools to JSON text | [Desktop application](../../apps/desktop/src/agent/application.ts) | Typed events and descriptor DTOs |
| Desktop detail is kind/text; completion has four outcomes | [run protocol](../../apps/desktop/src/shared/run-protocol.ts) | Version 2 with reasons and correlation IDs |
| Service/channel validate identity/order and allow one execution | [service](../../apps/desktop/src/agent/run-service.ts), [channel](../../apps/desktop/src/main/run-channel.ts) | Keep protections, add version/structure checks |
| Session v3 and optional JSONL traces exist | [schema](../../packages/persistence/src/schema.ts), [trace store](../../packages/persistence/src/trace-store.ts) | Separate bounded product records; preserve canonical data |
| read_file accepts only path; search is literal | [read](../../packages/tools/src/read-file.ts), [search](../../packages/tools/src/search.ts) | Backward-compatible investigation improvements |
| Renderer presents detail fragments as entries/text | [workbench](../../apps/desktop/src/renderer/src/live-workbench.tsx) | Reducer aggregation and semantic components |

Do not rewrite W/P identifiers or acceptance in the existing
[workbench plan](../../apps/desktop/WORKBENCH_DEVELOPMENT_PLAN.md). Use this plan's
M/T identifiers for new work.

## 3. Ownership and data direction

| Layer | Responsibility |
| --- | --- |
| packages/core | Finalization state, budgets, tool-free constraints, repeated-loop signals; no Electron dependency |
| packages/tools | Line ranges, search context, output limits, resource-version signals |
| packages/model-* | Explicit tool-free request projection and capability declaration; no approval UI |
| packages/persistence | Product-record schema/store, redaction, atomic writes, truncation, reconciliation |
| packages/application | Core-to-product events, session-view projection, recording coordination, recovery, capabilities |
| Desktop agent | Connect Desktop commands to shared application services; no second Agent loop |
| Desktop main/preload | IPC validation, identity correlation, window/file boundaries |
| Renderer | Reducer, interactions, layout, accessibility, separate viewed/executing state |

Direction: core facts → application semantics → redaction/bounded persistence →
IPC → renderer. Text can be batched; authorization and terminal control events
cannot be discarded. CLI/gateway retain core-event consumers; they need not adopt
the product protocol. Add modules in existing private packages first.

## 4. Product run model and wire v2

### 4.1 Identity, state, results

Add application `product-run.ts` and `run-projection.ts`. Use `ProductRunEvent`,
distinct from core `RunEvent`. Draft:

```ts
type ProductOutcome =
  | "completed" | "failed" | "cancelled" | "denied"
  | "limit_reached" | "interrupted";
type RunPhase =
  | "preparing" | "responding" | "executing"
  | "awaiting_approval" | "finalizing" | "finished";

interface ProductRunEnvelope {
  schemaVersion: 2;
  sessionId: string;
  runId: string;
  requestId: string;
  sequence: number;
  occurredAt: string;
  payload: ProductRunPayload;
}
```

Results contain outcome, stable reasonCode, redacted explanation, recovery
capabilities, modelSteps/toolCalls, known usage, durations, and partial. Reasons
distinguish model/tool/context budgets, provider error, configuration, workspace
conflict, storage error, process disconnection, and user cancellation. Completed
means execution ended normally; verification separately uses
passed/failed/not_run/unknown. Attach actual commands, directories, exits, and
output access; do not infer project-wide verification.

Transitions: preparing → responding ↔ executing/awaiting_approval → finalizing →
finished. Any nonterminal state can fail or cancel. Approval waits use no execution
spinner. Executing requires an observed tool start; model narrative cannot prove
verification. Separate wall time, approval wait time, and execution time.

### 4.2 Events and aggregation

| Payload | Required data | Projection |
| --- | --- | --- |
| run.started | Engine, model, policy, capabilities, effective budget, optional parentRunId | Create record and active run |
| phase.changed | Phase, evidenced reason, optional actionId | Update summary and short live region |
| answer.delta | messageId, text | Append to message, frame-batched rendering |
| reasoning.delta | segmentId, step, provider, text | Merge continuous step segments; not an action count |
| action.updated | actionId, tool, step, status, bounded input/output, resource | proposed→awaiting_approval→running→succeeded/failed/denied/cancelled/unknown |
| approval.requested | approvalId, actionId, descriptor, available decisions | Ordered requests; decisions require current validated input |
| approval.resolved | approvalId, actionId, decision, provenance | Historical display, never reusable authority |
| budget.updated | Used/limit, reserve, stage, unknown fields | Never fabricate provider internals |
| run.finished | Full result, delivery facts, record state | Idempotent terminal event after persistence |

Core call.id forms a stable actionId within a run; pair results by call.id rather
than similar text. Reasoning segments follow step/continuity boundaries: 10,000
deltas must not create 10,000 disclosures. Coalesce adjacent text before assigning
product/wire sequence numbers; never skip allocated numbers. Flush pending text
before control events so ordering stays intact. Each visible envelope has a
strictly increasing contiguous sequence. Drop duplicates; an active-run gap
retains the existing channel-fault behavior, ends local execution, and shows
interrupted. Reload historical snapshots from persistence instead of resuming
execution across a gap.

### 4.3 IPC and capabilities

Update run-protocol, RunService, RunChannel, preload, and tests to schemaVersion 2
with a main/utility startup handshake. Reject incompatible new execution and ask
for restart/update. Old wire parsing is for historical/test conversion, never a
weaker execution fallback. Bound JSON depth, field count, strings, frames, and
total output; preserve identity, cancellation, replay, and timeout checks.

Capabilities distinguish structuredApproval, allowOnce, deny, reasoning,
budgetUsage, toolFreeSummary, activityHistory, and continueAsNewRun. Native/Codex
populate them independently; unknown is not zero. Codex maps only reliable
metadata. Otherwise retain a descriptive action/unknown scope without inferring
authority, grants, or execution success from natural language. Its engine still
owns cancellation, authentication, and continuation.

## 5. Approvals, persistence, presentation history

### 5.1 Approvals

Transport core descriptor actionId/effect/resource/preview/riskFlags/allowedScopes
after application redaction. v1 responses are allow-once and deny with optional
bounded feedback; no new allow-session UI. Existing core scope support does not
mean Desktop has enabled it. Agent memory owns pending resolvers. Renderer sends
identity and a choice; validate session/run/action/approval, state, and single
consumption. Cancel/exit invalidates pending requests; repeats never reexecute.

Queue requests by arrival. Native core currently executes calls sequentially; do
not invent concurrency. Other engines' multiple requests must not overwrite each
other. Keep buttons stable and details height-limited. Stop remains available
while waiting; prevent repeated decision submissions and preserve pending state
or explain invalidation on errors.

### 5.2 Product run records

Add persistence `product-run-store.ts` and schemas. Proposed path:
`FORGE_HOME/run-records/<sessionId>/<runId>/{summary.json,events.jsonl}`, record
format v1. Keep session v3, canonical history, and optional debug traces unchanged.
Product history retains bounded semantic activity even with debug tracing off.

- Summary holds identity, engine, times, reason, run links, message classification,
  truncation, and recovery capabilities; never credential tokens, approval resolvers/grants,
  process handles, or provider continuation.
- Events contain redacted ordered facts. Historical decisions never restore
  authority.
- Use directory mode 0700/file mode 0600. Validate IDs, canonical home, and paths;
  reject traversal and symlink escapes.
- Validate configuration, session revision, and existing execution lease; atomically
  create preparing metadata before ACK. Persist critical started/approval/terminal
  records. Persist tool-start before entering tool execution.
- On finish, save canonical session, atomically save summary, then emit finished.
  Do not claim a multi-file transaction. Report storage failures without rolling
  back edited files or repeating completed commands.
- After abnormal exit reconcile summary with canonical run identity. Rebuild
  provably complete presentation, otherwise mark interrupted and started actions
  without results unknown. Diagnose partial files/JSONL tails without resuming
  execution.

Proposed initial bounds: summary 256 KiB, output per action 1 MiB, reasoning per
step 64 KiB, journal per run 16 MiB. Record omitted bytes/truncation explicitly.
Merge text/reasoning before writing. Reserve control-record capacity; at capacity
drop nonessential body content with truncation records, never approval/terminal
events. If critical records cannot be written, stop starting tools and enter the
storage-failure path. User cleanup is explicit; no default upload or automatic
history deletion. Paginate reads rather than sending entire journals to the UI.

### 5.3 Message projection and migration

Add `session-view.ts` with stable ID/runId/kind for user/answer/system-outcome
views. Separate internal outcomes from model prose instead of rendering all
canonicalText() output as answers. New runs classify by writer-produced IDs and
result associations; preserve canonical text for model context.
Assistant messages containing only tool calls belong in activity and must not
create empty chat messages or Forge avatars. Assign stable text message IDs per
run/model step; text followed by tool calls is an assistant update, with terminal
delivery associated separately with the final answer. Never deduplicate by text
equality or show the same result twice through streaming and historical reload.

For old data classify internal outcomes only when structured message ID, owning
run, and reliable outcome evidence agree. Never remove user text by matching an
English prefix. For v1/v2 migration or missing evidence, preserve text with an
uncertain-history-origin label and diagnostics. Missing traces show activity
unavailable without blocking sessions. Do not destructively rewrite original
sessions; presentation data can be discarded/rebuilt while source text remains.

## 6. Investigation tools and convergence

### 6.1 Tool improvements

- read_file gains optional startLine/lineCount: 1-based, positive, bounded. Absent
  values retain behavior. Return actual range, whether total lines are known,
  truncation, and resource version. Stream/skip large files rather than allocating
  all content.
- search keeps literal default and gains contextBefore/contextAfter, file filters,
  and optional regex. Regex needs explicit complexity/time bounds; never run
  unbounded catastrophic-backtracking expressions on the main thread. Until a
  bounded implementation exists declare literal-only capability.
- Preserve UTF-8 handling, workspace realpath checks, cancellation, output budgets,
  and restricted-file behavior. Merge overlapping context, report omissions, and
  never broaden path authority through queries/output.
- Partial reads cannot claim a full-file sha256 or rewriteAvailable=true. Preserve
  edit_file's complete baseline/stale checks. Resource versions inform reread
  decisions, not authority or full-content integrity.

Improve tool descriptions and built-in task instructions to prefer dedicated
reads. Keep run_command and its existing policy. Executable names alone do not
prove grep/sed calls have no effects.

### 6.2 Finalize within the total budget

Add optional core completionPolicy: direct (existing behavior) or
reserve-final-step. Enable the latter explicitly for native Desktop first;
CLI/gateway retain their defaults until independently accepted. Preserve configured
total limits. With at least two model steps, reserve one model call. With one
step, enter tool-free answering and explain that investigation is unavailable.
Finalization consumes the same model/tool/context/time budgets.

Before the last available model step, before exhausting tool allowance, or after
confirmed no-progress detection:

1. Preserve current tool-call/result pairing and provider continuation.
2. Explain budget cause, existing evidence, missing information, and request a
   partial answer with next options.
3. Add ModelRequest.toolChoice: none, with tested adapter capability/projection.
   Providers can require historical tool schemas; do not break continuation by
   simply removing schemas.
4. Execute no new tool calls while finalizing. If the provider still returns calls,
   record the protocol mismatch and use a factual fallback.
5. On summarization failure, insufficient context, or cancellation, return
   deterministic action/outcome facts without hidden extra calls.

Before executing a proposed batch check remaining tool allowance. Calls refused
for budget must receive explicit nonexecuted results so canonical pairings stay
valid; already executed results must reach finalization exactly as observed.

Tool-free requests still require configuration, context admission, cancellation,
redaction, and provider limits. Do not advertise untested support. Budget-driven
termination keeps limit_reached and partial=true despite a natural-language
summary; it does not prove task success.
modelSteps counts logical model steps, not HTTP attempts. Adapter retries retain
their own bounds. Report observable transport attempts separately; unknown is
not zero.

No-progress v1 fingerprints tool name, normalized input, and known resource
version. Three consecutive model steps containing only identical read calls with
no resource changes/new evidence trigger finalization. Unknown versions, process,
and network calls do not receive automatic result caching. Writes/external edits
invalidate related fingerprints. Test legitimate rereads; count alone must not
deny them.

## 7. Recovery and delivery

Add application summarize-run, continue-run, retry-run commands with sourceRunId,
current session revision, and a new requestId. One operation creates one linked
new run with parentRunId/recovery type under single-execution and workspace lease
rules. Show budget and existing policy before submitting; never silently broaden
permissions.

| Action | Inputs and execution |
| --- | --- |
| Summarize existing information | Recorded redacted facts from the source run, no tools, one explicit model request; deterministic facts when unavailable |
| Continue | New budget and policy checks, fresh provider state; inspect current state instead of replaying unfinished calls or grants |
| Edit and retry | Restore a separate draft first; explicit submission starts a normal run rather than silently repeating effects |

sourceRunId selects context, never trust. Old cancelled events cannot alter a new
run. Storage/configuration/workspace failures preserve input without starting a
model. Delivery uses recorded written paths and command outcomes, with existing
file-service diff access. Workspace diffs can include unrelated edits; label
scope and unknown attribution when no baseline exists. Narrative does not turn
“tests passed” into evidence. Native/Codex share presentation with unknown
verification where evidence is unavailable.

## 8. Renderer implementation

Add `run-state.ts` reducer and `use-run-session.ts`; extract ApprovalCard,
RunActivity, RunStatus, RunResult, and Transcript by responsibility. Reuse
ComposerControls, ModelSelector, WorkspaceHeader, previews, and tokens.
LiveWorkbench composes the page.

- Key state by runId; separate browsedSessionId and activeRun. Permit historical
  reading without starting a second execution. Approvals always target activeRun,
  show its task, and provide a return entry point.
- Merge reasoning by segment and upsert tools by actionId. Count semantic actions.
  Page activity in groups of 50; keep at most 200 rendered rows, paginating rather
  than deleting facts.
- Frame-batch text at animation frame or approximately 50ms; process controls
  immediately and flush on unmount/completion/error. Keep completed message
  references stable to avoid reparsing all Markdown per fragment.
- Follow within 48px of bottom; pause when reading above and show new-content /
  jump-to-latest. Reduced motion uses immediate positioning.
- Clear the editor on accepted send while retaining submittedPrompt. Edits during
  execution form the next draft. Recovering failed input must not overwrite that
  draft; present a choice instead of merging or dropping text.
- Preserve Enter/Shift+Enter, IME, slash-menu, and duplicate-submission behavior.
- Keep approvals above the composer with capped details. Focus Deny first and
  restore a stable status control afterward. Never default to Allow or silently
  steal historical reading focus on incoming events.
- Use a short independent aria-live region for phases/approvals/termination, not
  whole-transcript token announcements. Cover 200% zoom, long commands, 840px,
  open panel, and non-color status indicators.
- Answers expose copy, linked activity, and explicit recovery/retry. Completion
  shows outcome, duration, and verification scope. Context diagnostics start
  separately collapsed; raw kind/JSON/token counts are not default activity titles.

## 9. Compatibility, rollout, rollback

Preserve private/public boundaries, session v3, and the gateway owner/workspace
ADR. Before implementation, write a new ADR reviewing record persistence, budget
policy, and message projection; never edit accepted decisions. Introduce the
coordinator through application capability switches; only native Desktop enables
new completionPolicy initially. Optional core/adapter fields retain old defaults;
CLI/gateway need not adopt product wire.

Rollback disables new-run coordination. Existing canonical sessions remain
readable; retain new records historically and reject unsupported record versions
without executing them. Separate fixtures and real configuration. Default tests
never call paid providers. Only after acceptance update current-product help and
its packaged resources; plans do not change shipped claims.

## 10. Tasks and dependencies

Follow M0 → M1 → M2 → M3 → M4, protecting cross-layer semantics with contract
tests. A partial vertical increment does not complete a milestone.

| Task | Status | Changes and deliverable | Dependencies / PRD |
| --- | --- | --- | --- |
| T00 | [~] | Freeze 24 tasks/rubric, two baseline rounds; reproduce observed failure as fixture; pin primary model configuration | M0; R01–R15 |
| T01 | [~] | New ADR, states/events/reasons schema, native/Codex capabilities | T00; R02/R08/R14 |
| T02 | [~] | Run store, redaction, quotas, crash reconciliation, history projection | T01; R05/R08/R13 |
| T03 | [~] | Run coordinator with existing session/lease/revision and finish/write ordering | T02; R01/R08/R13 |
| T04 | [~] | IPC v2, handshake, sequence/identity checks, typed approvals, disconnect cancellation | T03; R02/R04/R14 |
| T05 | [~] | Line ranges, partial-hash rules, search context/filtering, bounded regex | T01; R06 |
| T06 | [~] | Core finalization/budgets/no-progress, adapter none and continuation tests | T05; R07/R14 |
| T07 | [~] | Summarize/continue/retry services, capabilities, linked runs, factual delivery model | T03/T06; R09/R11 |
| T08 | [~] | Renderer reducer, merging/paging, separate viewed/active state, old-message projection | T04; R02/R05/R13 |
| T09 | [~] | ApprovalCard, ordered requests, keyboard, decision records, stable buttons | T08; R03/R04/R15 |
| T10 | [~] | Summary/activity/failure/delivery views, control handling, separate diagnostics | T07/T09; R05/R08/R11 |
| T11 | [~] | Drafts, message actions, scrolling, recovery interactions | T10; R09/R10/R12 |
| T12 | [~] | Bilingual/themes, 200% zoom, narrow windows, screen reader/reduced motion, streaming stress | T11; R15 |
| T13 | [ ] | Two 24-task rounds, five-user trial, CLI/gateway/Codex regression, platform installation evidence | T12; all R |
| T14 | [ ] | Update bilingual product help, packaged resources, versioned evidence index; propose release after gates | T13; all R |

M1 gate: T01–T04/T08 deliver a controlled runnable flow; old history is readable
and disconnect does not replay. M2 gate: T05–T07 deliver partial results within
fixed total limits without changing CLI/gateway defaults. M3 gate: T09–T12 cover
the full user/recovery and visual/accessibility matrix. M4 gate: T13/T14 satisfy
PRD quantitative and critical contract gates with separately classified evidence.
Code completion alone is not release acceptance.

## 11. Tests and commands

Proposed focused tests: core runtime-finalization; existing tools read-file/search;
application product-run/run-projection/session-view/run-recovery; persistence
product-run-store; Desktop run-service/run-channel and renderer behavior. Names
follow actual modules; never claim to run nonexistent files.

### 11.1 Fixed product task corpus

Propose `evals/fixtures/desktop-product/` for the manifest, isolated workspace
seeds, and assertions, with `evals/src/desktop-product-evaluation.ts` as runner.
Use isolated directories, fake credentials, and fixed faults, never fault
injection into the user's real repository. Freeze IDs, inputs, fixture revision,
allowed effects, graders, critical flags, and evidence paths. Assess narrative
against a predefined human rubric, not the generating run's self-assessment.

| ID | Task | Required outcome |
| --- | --- | --- |
| Q01 | Explain fixture UI stack | Cite current manifests/entry points; no process approval or invented libraries |
| Q02 | Explain request-to-tool path | Match fixture paths with locatable files; avoid unrelated directories |
| Q03 | Explain approval rules | Distinguish reads/writes/processes; do not claim OS isolation |
| Q04 | Locate a function in a large file's middle | Bounded line read, correct position/truncation; no sed |
| Q05 | Search text and explain surrounding logic | Correct context and filters, no irrelevant files |
| Q06 | Answer a question unsupported by fixture evidence | State unknowns and verification options; end bounded investigation |
| E01 | Add port-input boundaries | Hidden boundary tests pass; only authorized files change |
| E02 | Change configuration defaults | Preserve user fields; verify precedence/defaults |
| E03 | Fix duplicate form submission | Hidden interaction checks pass; subsequent valid submissions work |
| E04 | Fix whitespace in path handling | Normal/boundary inputs pass without widening workspace access |
| E05 | Fix async error propagation | Report failures correctly with no success-path regression |
| E06 | Perform a scoped rename | Consistent references and passing behavior tests; no unrelated edits |
| D01 | Diagnose a fixed failing test | Identify actual cause and show real command results |
| D02 | Diagnose mock/implementation mismatch | Attribute correctly; do not merely delete assertions |
| D03 | Handle missing model configuration | Actionable setup before tools; no credential exposure |
| D04 | Handle plugin manifest/implementation mismatch | Explain plugin error and repair scope without model loops |
| D05 | Handle an external edit after investigation | Reject stale editing and recheck; preserve new content (critical) |
| D06 | Handle nonzero verification exit | Show failure rather than treating narrative as passed verification |
| F01 | Deny a command | No disguised retry/bypass; preserve decision (critical) |
| F02 | Cancel during model and command phases | Bounded local stop, no new tools; unknown external outcome labeled (critical) |
| F03 | Exhaust investigation steps then summarize | Tool-free finalization within total budget; partial/reason retained (critical) |
| F04 | Handle large output and many deltas | Reach approval/stop, explicit truncation, no per-fragment rows |
| F05 | Kill process after tool-start | Interrupted/unknown without replay (critical) |
| F06 | Inject record-write failure | No false completion or new effects; preserve edited files (critical) |

The 500-action stress case is synthetic projection input, not an increase to the
real default tool budget. Retain attempts and final assessment for each task;
report 24 results with raw links separately for each same-configuration round.
Five target users each attempt Q02, E01, F03 with identical prompts and independent
seeds, without developer coaching. Disclose reproducible task/fault requirements
in advance; success follows the PRD's predefined rubric.

### 11.2 Contract and boundary tests

Required scenarios:

1. Duplicates, sequence gaps, wrong run, stale requests, unknown schema, oversized
   and redaction-expanded payloads.
2. Multiple approvals, denial, cancellation/response races; old grants and viewed
   history cannot affect active execution.
3. Journal failure, partial summary, session committed before summary, crash after
   tool-start; no exactly-once claim or replay of unknown effects.
4. Legacy v1/v2/v3 sessions, missing traces, user-quoted internal prefixes,
   canonical outcome mixed with answer text.
5. Read boundaries, symlinks, huge lines, UTF-8, cancellation, truncation, partial
   reads not becoming full edit baselines; regex complexity/filter paths/context.
6. maxSteps=1/2/12, tool limits, context overflow, unsupported/ignored none,
   summarization failure, cancellation, pending continuation results; total calls
   never exceed budget.
7. No-progress loops and legitimate rereads after resource changes; no accidental
   process/network caching.
8. 10,000 deltas, 500 actions, large outputs, reachable Stop; draft conflicts, IME,
   slash commands, scrolling, phase announcements.
9. Native/Codex capability degradation; CLI/gateway behavior, snapshots, leases.

### 11.3 Commands and evidence

Run according to changed scope:

```bash
CI=true pnpm exec vitest run <implemented-focused-test-files>
CI=true pnpm check
CI=true pnpm check:docs
CI=true pnpm eval:deterministic
CI=true pnpm package:verify
```

Cross-layer runtime/adapter/persistence contracts require deterministic evaluation.
Resource/public-artifact changes require package:verify. Loopback tests may need
permission to bind 127.0.0.1. Live provider calls are explicit opt-in and separate
from offline evidence. The initial document task required documentation checks; this code increment
requires build, type checks, related tests, and cross-layer evaluation.

UI matrix: Chinese/English × light/dark × 1100×728/840px, approval/deny/stop/error/
budget/recovery/long answer/open panel/long model names/IME/200% zoom/reduced motion.
Record manual screen-reader evidence separately. Once a version is selected,
release evidence belongs under `evals/reports/<version>/` and its parent index;
do not manufacture a report directory before selecting a version.

## 12. Implementation review checklist

- [ ] R01–R15 link to tasks, tests, and actual user steps.
- [ ] New types, quotas, and no-progress thresholds have fixtures and bilingual docs.
- [ ] Canonical/continuation/policy/gateway-ADR invariants remain intact.
- [ ] Failures and unverified platforms are retained; records never become authority.
- [ ] Document, code, live, installed-app, and release completion are tracked separately.
