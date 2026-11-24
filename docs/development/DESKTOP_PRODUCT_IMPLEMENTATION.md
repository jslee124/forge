# Forge Desktop Productization Implementation

[简体中文](../zh-CN/development/DESKTOP_PRODUCT_IMPLEMENTATION.md) · [PRD](DESKTOP_PRODUCT_PRD.md) · [Roadmap](ROADMAP.md) · [Documentation index](../README.md)

Updated: 2026-10-30. Status: core product flows implemented incrementally; full product acceptance remains pending. This is a layered development
contract and task list, not shipped behavior. New filenames, types, fields, and
configuration below are proposed; section 2 separately identifies existing code.
Resolve PRD/implementation disagreements in both documents before implementing.

Historical chronological implementation increments and trial logs are archived in the [chronological acceptance log](../history/desktop-productization-log/ACCEPTANCE_LOG.md).

## Remaining acceptance work (2026-10-27)

Use this table for the next action; the chronological increments archived in the [chronological acceptance log](../history/desktop-productization-log/ACCEPTANCE_LOG.md) are scoped
development records, not a claim that every T00–T14 gate is complete.

| ID | State | Remaining outcome and acceptance condition |
| --- | --- | --- |
| U01 | Local implementation/UI/install verified | Local builds skip startup checks even with saved preferences; explicit public switching warns about replacement. Stable/preview ordering remains intact. Host/renderer regressions and installed `e819783` checks pass. |
| V01 | Bounded round complete; semantics partial | Run E01 coding and F03 budget recovery through the real Desktop; preserve attempts, approvals, exact changes, independent boundary checks and raw answers. Review source facts versus explanation, draft preservation and read-only history. No whole-task retry to chase success. |
| V04 | Bounded pilot and regression fix complete | D01/F01/F02 (model and command) used seven logical model steps at `806ceeb`. Original command-lane failure remains recorded; fix `b3ed5dd` passed deterministic projection replay and source `945582e` passed visible UI replay. These samples do not close V02 or V03. |
| V05 | Matrix stopped; live cancellation fixed locally | `ec18064` produced 17 complete lane reports and one disconnected command-cancel attempt in round 1. Original failure retained; `d2fbf0e` corrects live validation and passed 114 installed local UI entries. Round 2/F03 and six missing protocols remain unexecuted; no post-fix paid rerun. |
| V06 | Four protocol lanes verified twice; semantics partial | Source `50f8220`: D02/D03/D05/D06 mechanical checks passed in two fresh rounds. Six real tasks used 30 logical model steps; D03 made no model calls. Local scripted checks are separate. F04/F05/F06 remain unwired; prior matrix failures and unexecuted tasks stay unchanged. |
| V07 | Remaining control faults verified locally in two rounds | Source `e451d1b`: F06/F05/F04 passed six local scripted control checks with zero paid calls. All 24 IDs now have hooks, but scoped controls are not a complete primary-model baseline. Retained task title and record discovery are now implemented; their new F05 acceptance is separate from this earlier evidence. |
| V08 | Retained task discovery locally verified | `893b3d7`: canonical-empty sessions use saved request titles; explicit record entry replaces the welcome. Two isolated F05 rounds and 114 installed UI entries pass; no automatic replay or restored authority. |
| V09 | Focused repair diagnostic; original case still fails | `69947ec` adds bounded repair guidance and faults-v2 public path tests. `6cbdf94` preserves v1 and corrects containment/command scoring; the assisted artifact passes 14 v2 checks, while both original-prompt samples still fail. Three real samples used 18 steps; reassessment made no provider calls. |
| V10 | Model-authored regression path observed; repair loop pending | Two `2cb26da` faults-v3 E04 samples wrote their own tests and observed relevant failures, but neither repaired the source within six steps. Assertion errors remain. Early model-step guidance is locally tested only; the default twelve-step configuration has not been sampled here. |
| V11 | Product-default pilot complete; quality partial | `045b941`: E01/D05 scoped checks passed; E04 completed its own red/green loop but failed 7/14 independent checks. Three attempts used 26 steps/32 tools with no total caps or retry; requirements-derived tests and broader quality acceptance remain open. |
| V12 | Mapping guidance locally/live verified; quality gate open | `70fd951`/`f6f09b2`: both E02/E05 samples pass fixed probes and red/green observations. Four attempts total 37 steps/53 tools. No measured success-rate gain; E04 failure, language consistency and broader product gates remain open. |
| V13 | Native language policy/prefix samples verified; broad gate open | `9c73703` retained one failed explicit-English sample; `f4d7df7` passed two separately authorized targeted cases. Five one-response/zero-tool samples are not coding-task or Codex language acceptance. Current package verification passed after registry recovery. |
| V14 | Pilot boundary fixed locally; new isolated execution blocked | Two repository-nested E04 attempts are invalidated separately; launcher preflight now rejects ancestor Git roots before credential access across all selected rounds. Fresh outside-repository E04 and 50 bounded matrix lanes passed preflight; new paid execution did not start because automatic permission review timed out twice. |
| V15 | Isolated E04 rounds executed; quality failed | Explicit user confirmation resolved the prior timeout. Two fresh outside-repository faults-v3 rounds used 16 steps / 18 tools; both retained authored red/green tests but failed 7/14 independent checks. Roots/scope and original files were verified; no broader paid matrix or task retry. |
| V16 | Small cross-scenario check executed; full gate open | Q02/E01/D01, both F02 stages and F03 plus reviewed summary used 20 logical steps / 22 tools; F05 was local scripted. Critical stop/history checks passed; E01 passed 22 independent probes but remained partial under the six-step diagnostic/test-write restriction. No E04 retry or full matrix. |
| V17 | Versioned E01/E03 repair acceptance executed; scoped passes | Faults-v5 / repair-acceptance adds bounded authored tests with narrow permissions. One real attempt each used 16 steps / 18 tools total; authored red/green and independent 22/22 plus 4/4 probes passed, original tests/unrelated code preserved. Broader gates and answer concision remain open. |
| V02 / T00,T13 | Attempted; critical stop, full gate unmet | Frozen 9b1dae2 executed 46/50 lanes (44/48 task rows). Round 2 F02 command was rewritten and denied before start; F03–F06 unrun. Both E04 attempts failed 7/14 independent checks. Preserve rows, no retry; human review pending. |
| V03 / T13 | Pending | Five target users perform Q02/E01/F03 without developer coaching; record blockers and results. Agent-operated tests cannot substitute for independent users. |
| A01 / T12 | Partial | Native IME candidate confirmation must not send early; verify actual VoiceOver stage/error/approval announcements and keyboard recovery. AX/composition simulations are supporting evidence only. |
| C01 / T01–T04,T13 | Partial | Refresh CLI/gateway/Codex compatibility and platform-specific install/interrupt evidence. Current arm64 local install is verified separately; Windows/Intel/other macOS versions and real Codex coverage remain limited. |
| Q01 / T05–T07 | Partial | Retained exception, code-transcription and missing-evidence counterexamples must remain explicit. Recorded facts are authoritative display fields; model factuality requires separate task-level review, not prose-based success classification. |
| P01 / T14 | Pending release gate | Synchronize product help/resources and R01–R15 evidence mapping, verify distributable artifacts, and decide signing/notarization/platform scope before proposing publication. Development tests and local installation are not release acceptance. |

Completed local installation from `adfbad2` is recorded at
`/tmp/forge-install-adfbad2/README.md`: packaged smoke and 105 scripted installed-UI
entries; all 85 original Forge-home file hashes retained. Original history was
visible in the normal Applications app. Interactive Spotlight launching remained
unverified because native computer control failed; metadata had a single refreshed
Applications entry. No real-provider quality claim follows from that installation.


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
[workbench plan](../history/desktop-workbench/WORKBENCH_DEVELOPMENT_PLAN.md). Use this plan's
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
| T13 | [~] | Two 24-task rounds, five-user trial, CLI/gateway/Codex regression, platform installation evidence | T12; all R |
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

## 13. Optional native task ceilings (2026-10-28)

Ordinary native runs now default to `maxSteps: null` and `maxToolCalls: null`,
meaning no fixed total ceiling. Explicit positive limits remain supported; CLI
`--max-steps unlimited` and `--max-tool-calls unlimited` explicitly clear them.
Project configuration may tighten an unlimited parent or lower a finite ceiling,
but cannot relax a finite user ceiling with `null`. Recovery review displays the
effective nullable limits; answer-only recovery remains one model step, no tools.

Core retains cancellation, context/output bounds and command timeout. Repeated
unchanged versioned reads and three consecutive identical batches of permanent
refused/invalid actions trigger `no_progress`; normal nonzero test exits and
retryable errors do not establish that loop. These guards are conservative and
do not detect every possible loop or enforce a monetary spending limit. The
loop yields to the event loop so local fast adapters remain cancellable.
Delegation remains bounded: at most four children; absent parent ceilings use a
shared pool of 16 model steps and 32 tool calls, with per-child defaults of 4/8.

Regression coverage includes progressing direct/reserved tasks completing 46
model steps and 45 tool calls, cancellation without total caps, explicit finite
limits, nullable config precedence and recovery protocol. The desktop acceptance
scenario `default-unlimited-task` uses the actual renderer, IPC, utility adapter,
workspace tools and journal with 45 distinct local files, without external
provider calls. It verifies completion at 46/45 and no forced tool-free response.
This scripted case establishes transport/control behavior, not model quality,
cost, or completion of the remaining real-task/user acceptance gates.

### 13.1 Scoped verification

Source `c3aacb8`: full suite 834 passed / 6 skipped; deterministic contracts 221
passed; `check`, `check:docs`, and `package:verify` passed. Existing lint warnings
remain. Development UI produced 111 result entries; the first new scenario used
the wrong workspace management entry point, was rejected by the directory-picker
boundary, and was corrected without weakening that boundary. Installed macOS
arm64 `0.4.0-local.c3aacb8` produced 116 result entries, including completion at
46 model steps / 45 tool calls using only the local scripted provider.

The prior installed app and user data were backed up before replacement; all 85
original Forge-home files retained their hashes after normal reopen, with history
visible and an empty draft. Private local evidence is retained under
`evals/artifacts/default-unlimited-c3aacb8/` (`verification.json`, installed
`ui.json`, long-task screenshot and check logs). No paid/external provider calls
were made. This does not establish real-model repair quality, VoiceOver/native
IME acceptance, Windows/Intel coverage, signing or notarization.
