# Forge Desktop Productization Implementation

[简体中文](../zh-CN/development/DESKTOP_PRODUCT_IMPLEMENTATION.md) · [PRD](DESKTOP_PRODUCT_PRD.md) · [Roadmap](ROADMAP.md) · [Documentation index](../README.md)

Updated: 2026-10-27. Status: core product flows implemented incrementally; full product acceptance remains pending. This is a layered development
contract and task list, not shipped behavior. New filenames, types, fields, and
configuration below are proposed; section 2 separately identifies existing code.
Resolve PRD/implementation disagreements in both documents before implementing.

## Remaining acceptance work (2026-10-27)

Use this table for the next action; the chronological increments below are scoped
development records, not a claim that every T00–T14 gate is complete.

| ID | State | Remaining outcome and acceptance condition |
| --- | --- | --- |
| U01 | Local implementation/UI/install verified | Local builds skip startup checks even with saved preferences; explicit public switching warns about replacement. Stable/preview ordering remains intact. Host/renderer regressions and installed `e819783` checks pass. |
| V01 | Bounded round complete; semantics partial | Run E01 coding and F03 budget recovery through the real Desktop; preserve attempts, approvals, exact changes, independent boundary checks and raw answers. Review source facts versus explanation, draft preservation and read-only history. No whole-task retry to chase success. |
| V02 / T00,T13 | Pending full gate | Score all 24 fixed tasks in two independent rounds with pinned model/config/seed and predeclared rubric. Existing partial diagnostic samples do not satisfy this gate. |
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
Native summarize/continue/retry, delivery, browsing and setup follow-ups are recorded below.
The first six real-provider pilot runs are recorded separately; the complete two-round
24-task evaluation and five-user trial remain pending. Deterministic reproductions
do not substitute for those gates.

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

## T13 bounded live pilot preparation (2026-10-26)

The setup/failure increment is committed as `684d5ce`. Two independent 24-task
rounds have been prepared with the same frozen model and fixture hashes. A new
[opt-in pilot launcher](../../apps/desktop/scripts/product-live.mjs) and
[Desktop execution path](../../apps/desktop/src/main/product-live-acceptance.ts)
prepare Q02/E01/F03 in each round (six runs), not a completed 48-task baseline.
The T12 manual gates and five-user trial are still pending.

Run from `apps/desktop` after building:

```bash
node scripts/product-live.mjs --check --round /tmp/forge-t13-round-1 --round /tmp/forge-t13-round-2
# Requires explicit authorization to send the named fixture data to DeepSeek:
node scripts/product-live.mjs --live --round /tmp/forge-t13-round-1 --round /tmp/forge-t13-round-2
```

`--check` makes no provider calls and reads no credential. Both modes verify the
fixed task prompts, exact file inventory and original seed hashes, refusing extra
files and changed inputs. Live mode uses an isolated home/Chromium profile and
passes only the selected DeepSeek key for authentication; reports redact it.
Q02/E01 allow at most six model steps each, F03 two; per-run tool caps are 8/16/8.
A 150-second cancel request and 175-second wall-clock bound apply, followed by a
200-second parent-process cutoff. No existing attempt is overwritten or retried.
The narrow [approval policy](../../apps/desktop/src/main/product-live-policy.ts)
only allows E01's `workflow.mjs` edits and exact `node --test fixture.test.mjs`;
other effects are denied. These application controls are not an OS sandbox.

Evidence includes real Desktop screenshots, protocol events, durable runtime
records, before/after file hashes, approval decisions and independent port-boundary
assertions. Run outcomes and assertion results remain separate from rubric review;
a fault that does not trigger cannot be claimed as covered. Usability/user trials
are not inferred from an automatically operated renderer. The initial preparation did not establish source/runtime coverage by a live run;
the limited executed pilot is recorded below.

Local preparation validation: 39 main/evaluation tests, root check and Desktop
build passed; both `--check` rounds passed. Live execution was rejected by automatic
approval review before the launcher ran because specific fixture-data transmission
to DeepSeek had not yet been explicitly confirmed. At that preparation point,
external calls were zero and all assessments were pending. The user subsequently
authorized the named data/destination; see the executed pilot below. Original
review plan: `/tmp/forge-t13-plan/report.md`. Preparation is not a scored baseline
or release evidence.

## T13 first live pilot observations (2026-10-26)

After explicit authorization, six real DeepSeek trials (two rounds of Q02/E01/F03)
ran through the Desktop renderer, adapter, Agent and recording path. Requested
configuration was `deepseek-flash`/high. Completion accounting totals 25 model steps
and 32 tool calls (including denied/invalid calls); exact HTTP retries, tokens and
billing were not measured. This is a three-case pilot, not a 48-task baseline,
independent five-user trial or provider success-rate estimate.

- Q02: both answers identify the fixture's main call path, preserve read-only scope,
  and terminate on tool budget. Both broaden investigation to product resources;
  the second makes an incorrect unrelated claim about the seed's busy flag.
  The prompt also leaves fixture/product scope ambiguous, so do not attribute
  all overhead to the model/runtime alone.
- E01: both patches change only `workflow.mjs`; independent post-run 22-case port
  checks pass. However, the pilot allowlist mistakenly rejected the intended
  command because the tool supplied default `cwd: "."`. Therefore the Agent's
  verification loop is **not validly assessed**. Both answers truthfully state
  their tests did not run. The seed leaves leading-zero behavior unspecified;
  the two implementations differ on it.
- F03: both runs obey two model steps and have no new action execution after
  finalizing. The first answer displays DSML tool-call protocol text instead of
  a summary; the second is readable but miscounts the listed files. Mechanical
  budget checks passing does not establish summary correctness or usability.
  Provider/adapter/finalization root cause remains unresolved.

All six outcomes are `limit_reached`, with explicit partial status. F03 intentionally
exhausts its budget; the lower pilot caps and E01 harness defect preclude treating
this as six ordinary-task failures or as six passes. No source/product logic was
changed between the six sampled trials. A pre-admission UI timeout created no
session/run record; its original evidence was retained separately, and the runner
wait was corrected to await the selected workspace state before the live batch.

After sampling, the pilot cwd allowlist was corrected and regression-tested,
without additional external calls. Live validation of that correction remains
pending. The original screenshots, model outputs/events and code patches are
retained. A post-run assistant review is distinct from independent human grading.
Local evidence: `/tmp/forge-t13-results/report.md`, `/tmp/forge-t13-results/summary.json`,
`/tmp/forge-t13-round-{1,2}/`, and build hashes in
`/tmp/forge-t13-plan/live-build-sha256.json`. The build includes an uncommitted pilot
executor on baseline `684d5ce`; that commit alone does not identify every executed
file. 39 main/evaluation tests, root check, docs check and Desktop build passed.

Next: reject or clearly report invalid summary output without executing protocol
text; tighten evidence-to-answer convergence; then sample a new batch with the
corrected pilot policy. Each round's other 21 cases, fault injections, five-user
trial and T12 manual accessibility/IME gates remain pending.

## Tool-free output validation follow-up (2026-10-26)

The first T13 F03 answer exposed a provider-specific gap: raw DSML invocation
syntax arrived as text, so the runtime's existing structural-call, stop-reason
and nonempty-answer checks accepted it. This establishes an acceptance gap, not
why the remote provider generated that response.

DeepSeek's adapter now rejects a tool-free response beginning with a raw DSML
`calls` or `invoke` envelope, including markers split across text deltas. Detection
is limited to a bounded opening prefix; prose and fenced protocol examples remain
unchanged. The adapter reports a non-retryable provider error, and core's existing
reserved-finalization path replaces buffered text with an evidence-based partial
result. It neither parses textual calls nor executes them nor adds a model retry.
This is a narrow protocol-shape guard, not a general factual-quality grader;
miscounts and over-investigation remain separate work.

The checked-in synthetic raw-answer fixture is copied from the authorized F03
trial. An offline HTTP/SSE replay exercises the actual SDK, adapter and core path,
asserting one observed read, two total requests, retained partial/budget metadata,
a diagnostic warning, no raw protocol in delivered text/canonical history, and
preserved normal/quoted answers. The replay joins `eval:deterministic`.
Validation: 41 focused adapter/transport/finalization tests, 140 deterministic
checks, root check, documentation check and Desktop build passed. Existing root
lint warnings remain. No additional live provider calls or installed-app
verification were performed.

## Investigation convergence follow-up (2026-10-26)

Opt-in reserved-final-step runs now receive their actual total model/tool allowance
and guidance to finish when requested evidence is sufficient without claiming
unexecuted verification or skipping necessary checks. Application instructions
separate current-workspace implementation questions from host product help and
limit additional Skill use to the requested workflow. Explicit Skill selection
and existing permissions remain intact. Direct CLI/gateway defaults are unchanged.

The run-local read-progress tracker retains the three-identical-read threshold
and also stops after three successive already-observed read batches, catching
alternating unchanged reads. It observes only successful `read_file` batches with
known resource versions and identical bounded results/inputs. A changed result
for the same scope, failed/unknown-version read, search, process, write or mixed
batch clears cycle evidence. Tracking is bounded to 64 batch signatures and 256
read scopes; capacity exhaustion forgets evidence rather than inferring a loop.
The next admitted step remains a tool-free partial summary inside the total
budget. This does not detect semantically irrelevant new reads or prove answer
correctness, and it never caches tool results or grants execution authority.

Validation: 337 affected core/application/DeepSeek/Desktop/pilot tests passed;
six opt-in live tests skipped. 151 deterministic checks and root check passed.
Regressions cover alternating loops, changed/reverted versions, new scopes,
intervening effects, unknown/failing observations, bounded tracking, early answers
and unchanged direct-policy instructions. No additional paid provider trials ran;
real-model convergence improvement remains unmeasured. T06/T13 remain partial.

## Second live pilot review (2026-10-26, source 37304fb)

A separate six-run Q02/E01/F03 batch used the same frozen model, task prompts,
seed inventory and per-task limits, with no mid-batch source edits or extra live
retries. It used 24 model steps and 32 tool-call accounting entries (including
denied/failed calls). This remains three distinct tasks sampled twice, not the
48-task baseline or an independent user trial.

| Task | Round 1 | Round 2 |
| --- | --- | --- |
| Q02 | Tool limit; raw DSML rejected; generic fallback, no call-path answer | Tool limit; main chain/missing connection identified, several renderer line citations wrong |
| E01 | Completed; one scoped edit, fixture tests exit 0 (2/2), independent 22 assertions pass | Model-step limit; same edit/test checks pass, DSML summary rejected and fallback delivered |
| F03 | Expected step limit; readable but overly long Chinese summary of directory evidence | Expected step limit; DSML rejected, minimal factual fallback |

The DSML guard triggered three times; no raw protocol was delivered and no
textual invocation was executed. This validates containment, not reliable model
summary generation. Both exact fixture test commands were allowed with `cwd: "."`;
extra node eval remained denied. Hidden assertions ran only after model completion.
Leading-zero interpretation remains unspecified by the frozen prompt/rubric.

Both investigation runs still exhausted the tool allowance; one searched host
product documentation. The alternating-read detector did not trigger on these
new/different reads, so live convergence improvement is not established. The two
small batches are not a controlled A/B comparison: pilot policy changed as well
as source instructions, and outputs are stochastic. Do not infer a general
success rate or latency improvement. Six saved Electron screenshots were inspected;
the English fallback collapses into a dense paragraph in the Chinese UI. Marking
it partial is correct but does not make it a useful task-specific delivery.

Local reviewed report: `/tmp/forge-t13-followup-37304fb-results/report.md`;
machine summary/build hashes: `summary.json` / `build.json` in that directory;
raw results/events/screenshots: `/tmp/forge-t13-followup-37304fb-round-{1,2}/`.
The original batch remains at `/tmp/forge-t13-round-{1,2}/`. Reviews are by the
assistant, not independent humans. The initial prepared `round.json`/pilot plans
are input snapshots, not outcome manifests. Desktop build and no-call prechecks
passed before execution; no runtime source was changed during this review.

Next: present localized, explicitly system-generated fallback with actual edit
and test evidence; improve workspace-vs-product-help tool selection and investigate
continued final-step tool attempts. Broader fault/installation/user-trial gates
remain pending. No product-release gate is advanced by this small sample alone.

## Factual system-fallback presentation (2026-10-26)

Native fallback answers are now identified by their host-generated canonical
message identity, not by matching English prose. Application completion exposes
an optional `answerSource: system-fallback` presentation fact; completion storage
and wire schemas validate it. Saved messages from recorded runs project a separate
`system-fallback` kind, including zero-admitted-step context failures. Ordinary
answers and user-quoted fallback text retain their existing presentation. No
canonical text, permissions or execution defaults are rewritten.

Desktop renders a labelled bilingual system result instead of a model avatar and
raw Markdown paragraph. It shows up to five recorded file writes, command results
with exit/timeout/unknown status, expandable captured output and unresolved actions.
Nonzero/unknown command results retain an attention notice; exit code zero is not
promoted to task verification. Missing details, truncation and incomplete records
remain explicit. When another run's delivery has not been loaded, the view points
to the Activity tab rather than guessing that nothing happened. Original system
text stays available in a collapsed diagnostic region. Recovery-summary runs show
their own execution records, not fresh execution of the source run's effects.

Validation: 251 affected application/persistence/Desktop tests passed, six live
opt-in tests skipped; 151 deterministic checks passed. Root check and Desktop
build passed. Local Electron acceptance adds a scripted file edit, a command with
exit code 1 and an intentionally incomplete final model stream, followed by EN/ZH
and 1100/840 layouts and a reload/reselect check with no extra model requests.
Artifacts are `/tmp/forge-system-fallback-ui-verified/`. This is isolated loopback
acceptance, not new paid-model, installed-app, Windows or release evidence.
The prior two real-pilot batches remain unchanged; investigation scope and reliable
provider finalization still need work. T10/T13 remain partial.

## Host-help routing scope follow-up (2026-10-26)

Shared resource selection no longer forces the built-in `forge-product-help` or
`forge-plugin-creator` workflow from generic description-word overlap. Common
workspace terms such as tools, commands or configuration were previously eligible
for host selection, which then required loading the selected Skill. These two
specialized builtins now require their Skill name in the request for deterministic
host selection. `$skill-name` selection remains authoritative; both descriptors
stay in the catalog and remain model-loadable for contextually relevant work.
User/project overrides and other builtins keep their existing routing. This is a
shared resource-layer change, not a Desktop-only intent classifier or permission
change; it does not hide product-help tools or categorically forbid model choices.

The packaged host-help tool descriptions and both builtin Skills distinguish
product operation/help from workspace source, functions and call paths. Source
inspection does not mandate searching packaged product docs even when the current
workspace is Forge. A generic tools directory/function/manifest is not proof of
Forge plugin integration and does not mandate inspecting host plugin templates.

Validation: 19 resource/application tests and 151 deterministic checks passed;
root check, Desktop build and packed-install verification passed. Regressions
include generic EN/ZH questions, the frozen Q02/E01 prompts, named selection,
model loading, project overrides and unrelated builtin routing. Packaged resources
were rebuilt and verified. No paid-model trial ran; the prior live batches remain
unchanged. This removes a deterministic false-routing mechanism and sharpens
model-facing scope, but does not establish that the model's own irrelevant tool
choices or investigation duration have improved. T06/T13 remain partial.

## Two-run investigation retest and remaining-allowance follow-up (2026-10-26)

The pilot launcher now accepts a validated unique `--task` subset of Q02/E01/F03;
`--task Q02` runs only that frozen task, with the original limits and seed checks.
The default three-task batch is unchanged. Unknown or duplicate task IDs fail
before credential access. A no-call regression verifies selection and preserves
the extra-workspace-file rejection.

Two independent Q02 runs at source `04a5390` (including `4f6e2b2`) both ended at
the tool-call limit: round 1 used 4 model steps/7 tool calls, round 2 used 4/5.
Neither called host product-help tools nor loaded Skills, and both preserved all
workspace files. Both still failed the reviewed task gate: renderer.tsx remained
unread, the first invented a busy-lock consequence despite no read of busy, and
the second over-constrained untyped requestId data. Keyword-reference checks
passing does not establish semantic correctness. No installation trial package
was prepared under the proposed investigation-pass gate.

The last batches requested 3 calls with 1 remaining and 4 with 3 remaining;
existing core behavior refused each whole batch and finalized without execution.
After retaining those results, reserved-final-step runs gained a low-allowance
instruction when at most 3 tool calls remain, stating the current remaining count
and whole-batch refusal rule. It asks for essential evidence or an answer without
skipping required verification. Limits, approvals, all-or-nothing batch refusal
and direct-policy defaults remain unchanged. Instructions flow through existing
context admission/cache-prefix accounting. This is planning guidance, not a new
permission or proof of improved model behavior.

Validation after the change: 19 finalization regressions, 153 deterministic checks,
root check and Desktop build passed. The new regression updates hints across
3→2→1 and verifies that an oversized batch still has zero extra effects. No paid
calls occurred after this change; the two real runs are pre-change evidence only.
No additional live retries were made. Raw results/screenshots are under
`/tmp/forge-t13-scope-q02-round-{1,2}/`; reviewed report, machine summary and actual
executed build hashes are `/tmp/forge-t13-scope-q02-results/`. Reviews remain
assistant assessments, not independent user trials; T06/T13 remain partial.

## Model-input chain audit and continuation-budget correction (2026-10-26)

A local SSE replay now exercises both direct core and application entry points,
real workspace reads, the DeepSeek adapter and installed SDK serialization with
intercepted fetch. It verifies exact fixture content, full/ranged line metadata,
the updated 3-call allowance on continuation, replacement with the finalization
instruction, and one current system message per request. Partial reads retain
null full-file hashes and cannot authorize whole-file rewrites. No external API,
real credentials or model-generated answer is involved.

The audit reproduced a separate context-budget defect: current system instructions
are sent alongside continuation, but both the breakdown and conservative total
estimate excluded them when continuation existed. They now count current
instructions on every request, while still avoiding duplicate prompt/history that
continuation owns. A regression rejects mandatory overflow from long current
instructions even with tiny continuation. The same core replay changed instruction
estimates from 131/0/0 to 131/246/135; these are conservative estimates, not provider
usage or measured cost. Existing policy, tools, history and provider protocol are
unchanged; corrected admission may reject or project an oversized context earlier.

Two executable fixture counterexamples confirm that busy assignments do not block
a second submit, and untyped requestId accepts an object through dispatch. The
previous Q02 claims therefore cannot be defended from the source. This replay
found no content/line loss on the tested chain, but cannot reconstruct historical
remote HTTP bodies that were not captured. Nor does it establish why the remote
model made its mistakes or that better budgeting fixes semantic correctness.

Validation: 202 affected core/application/DeepSeek/OpenAI/compatibility tests,
158 deterministic checks, root check and Desktop build passed. The new replay and
counterexamples join `eval:deterministic`. Local report and captured synthetic
request bodies are `/tmp/forge-request-evidence/README.md` and its before/after/
verified directories. No paid calls or installation updates occurred. Prior live
failures, frozen corpus and product acceptance gates remain unchanged.

## Fixed-evidence comprehension diagnostic (2026-10-26)

After the input-chain audit, a separate opt-in diagnostic supplied the original
Q02 question and complete main.mjs/workflow.mjs/renderer.tsx/package.json snapshots
at source `1274d84`. It used the same deepseek-flash/high model with no tools,
history, Skills or product-help context. The local driver first verified request
serialization without credentials; live mode permitted at most two independent
network requests, one per sample, with requested max_tokens 4096 and a 90-second
timeout. Extra network requests and redirects were refused. It is a temporary
analysis driver, not a new product execution mode or benchmark revision.

Both live samples stopped normally with one request each and explained the main
receive → handle → dispatch → tool chain, UI send callback and missing wiring.
Neither repeated the busy-lock or string-only requestId errors. Assistant review
found useful main explanations with minor wording/citation caveats: sample 1
called the package entry an Electron main entry too strongly and placed handle
at its body line in a diagram; sample 2 blurred state initialization and update.
This is not a perfect-answer or independent human pass claim.

Provider-reported usage summed to 1,872 input / 4,958 output / 6,830 total tokens;
reasoning is not added again to total. No price or general performance inference
is made. The diagnostic changed evidence availability, instructions, history, tool
catalog and output limits together, so it is not controlled A/B evidence for a
single root cause. It shows that these supplied-evidence samples can yield a
usable explanation, while autonomous Desktop investigation still fails its gate.
Next implementation should prioritize relevant-file discovery, read ordering and
bounded evidence delivery. Full-corpus, installation and user-trial gates remain.

The original fixture and live Desktop failures are unchanged; no runtime or
installed app was modified in this diagnostic increment. Local plan, synthetic
request bodies, answers, reviews, script and hashes are retained under
`/tmp/forge-comprehension-diagnostic-1274d84/README.md`. Authentication headers and
reasoning text were not saved. Documentation checks passed.

## Bounded grouped source discovery (2026-10-26)

`search` now accepts up to three optional `additionalQueries` alongside its
existing primary literal query. Distinct terms share one file traversal, the
existing 16 MiB scan cap, 1 MiB per-file cap, entry count, global matching-line
count and output budget. A line matching several terms consumes one match;
`matchedQueries` identifies the terms and the column points to the earliest hit.
Overlapping contexts merge across terms. Regex remains unsupported. Omitting
additional terms or repeating the primary term preserves single-query output.

An explicit `scope: source` skips nested .git/node_modules/.next/dist/build/
coverage/.venv/__pycache__ directories before their contents consume the entry
budget. The result reports source scope and skipped-directory count; it is not
an exhaustive workspace search. An explicitly targeted directory root is still
searched under normal workspace restrictions, and default `scope: all` retains
existing behavior. Include/exclude filters, cancellation, symlink boundaries and
all I/O/output limits remain enforced. This is a read filter, not new authority.

Native bounded-run instructions now suggest locating relevant entry/call sites
with source-scoped grouped literals and small context windows, then reading only
ranges needed to establish actual calls/imports. A name match alone is not wiring;
missing connections remain unknown. It does not automatically infer a dependency
graph or guarantee that a model chooses useful terms or stops at the right time.

Validation: 65 tool/application tests and 166 deterministic checks passed; root
check, Desktop build and packed-install verification passed. A frozen-fixture
regression collects main.mjs, renderer.tsx and workflow.mjs context in one search,
including send(draft), dispatch and the actual tool call. Another reproduces a
small entry budget consumed by dependency/build trees in all scope and confirms
source scope reaches src while explicit dependency-path lookup still works.
The discovery regression joins `eval:deterministic`; the task corpus itself is
unchanged. Local demonstration: `/tmp/forge-grouped-search-evidence/README.md`.
Its query terms are test-specified, not independently chosen by a real model.
No paid calls, installation update or new UI acceptance occurred; T05/T13 remain
partial until real investigation and the other existing gates pass.

## Grouped-search retest and numbered read support (2026-10-26)

Two real isolated Desktop Q02 runs at be0cb0c both used grouped source search,
but neither passes assistant review. Round 1 completed with 5 model steps / 7
tool calls but misquoted workflow line positions, never read renderer.tsx and
inferred that other request fields had been lost without proof of input type.
Round 2 read the relevant UI and backend files, then hit the 8-call limit; its
tool-free response contained raw DSML and was replaced by the factual system
fallback. Both preserved the workspace. No retries or user trials occurred.
Raw evidence and separate assistant assessments:
`/tmp/forge-t13-grouped-be0cb0c-results/report.md`. Completion is not correctness.

`read_file` now accepts optional `format: numbered`, prefixing each returned
source line with its absolute 1-based position. Default/explicit raw reads retain
original content and hash behavior. Number labels count against the existing
content byte cap, preserve UTF-8 and CRLF, and cannot create a phantom trailing
line; omitted presentation content reports output_limit. `bytes` measures the
returned content, and line metadata describes source lines actually represented.
Numbered output is explicitly marked contentFormat=numbered and never provides
a whole-file rewrite hash, even if the entire source was read. It does not alter
files or grant authority. Ranged/scan/cancellation/workspace restrictions remain
unchanged. Native bounded-run guidance suggests numbered reads for citations
and raw reads before full rewrites. This is evidence presentation, not automatic
citation validation or proof of improved model accuracy. T05/T13 remain partial.

Validation: 50 focused tool/application/SDK serialization tests passed before
one additional rewrite-boundary test; the final 36 tool tests and all 175
deterministic checks passed. Root checks (existing 8 warnings / 48 infos),
documentation checks, packed-install verification and Desktop build passed.
The SDK fixture confirms numbered positions 24–29 reach the actual next model
request while full raw reads remain unchanged; these are offline tests.

## Numbered-read real-model retest (2026-10-26)

Two isolated Q02 runs at 871806e used the unchanged frozen prompt, model and
6-step/8-call caps. Both chose numbered reads. Round 1 quoted the key backend
chain at correct positions (dispatch 24–26, handle 27–29, tool call 28), but with
one call remaining requested two; the whole batch was refused and renderer was
not read. The partial answer acknowledged missing evidence, but broadened into
unrelated defects. Round 2 exhausted eight tools without reading renderer, then
returned raw DSML during tool-free finalization; the guard produced an explicit
factual system fallback. Both fail assistant review, despite preserved files.
Together: 10 model steps / 15 executed tools, 24,522 ms summed recorded duration.
No billing/token totals captured, retries, installation replacement or release
claim. These sequential samples do not establish a causal accuracy improvement
or independent human/user acceptance. Raw evidence and separate assessments:
`/tmp/forge-t13-numbered-results/report.md`. The remaining gate is evidence
prioritization, batch allowance compliance and reliable useful finalization;
T05/T13 remain partial. Numbered output alone does not resolve that gate.

## Explicit answer-stage transition (2026-10-26)

A bounded headless application diagnostic at 42ce526 made four runtime requests
and four explicit, nonexecuting comparison requests (8 HTTP calls total, each
capped at 4096 output tokens). Exact-final-request and no-tool-schema replays
both returned raw DSML; appending a final-answer turn and a fresh evidence-only
request produced prose once each. The latter approaches did not establish task
success: the appended-turn answer still speculated about a joined UI path before
clarifying its missing bridge. Raw request hashes, redacted reasoning bodies,
usage where available and results remain at
`/tmp/forge-finalization-diagnostic-42ce526/`. Exact replay reconstruction was
verified against the captured request hash before comparison. This is an
application/adapter diagnostic, not Desktop acceptance or a controlled success rate.

Core now adds an explicit, budgeted answer-stage directive inside the existing
reserved step. All three native adapters append it after observed tool results
only under none, keeping history and schemas. It is host control rather than
canonical human history or restored authority. Context admission counts it even
with continuation. A pinned SDK patch preserves reasoning for deepseek-flash at
this new boundary without changing the model sent to the API. Native guidance
also prioritizes the question's requested boundaries before peripheral registries.
See [ADR-0006](../decisions/0006-explicit-answer-stage-message.md). No automatic
retry, extra steps, partial batch execution, or installation update is introduced.
T05/T13 remain partial pending real Desktop retests and existing product gates.

Offline validation: 77 focused core/adapter/SDK transport tests, 177 deterministic
checks, root checks (existing 8 warnings / 48 infos), documentation checks, packed
installation verification and Desktop build passed. No new UI layout was changed.

## Answer-stage real Desktop retest (2026-10-26)

Two new Q02 runs at 22263a2 kept the frozen prompt/model and 6-step/8-call caps.
Both read renderer/main/workflow, used numbered source, and produced final prose
without raw DSML warnings or system fallback. Both preserved the workspace and
remain limit_reached/tool_call_limit/partial (4 steps and 8 tools each); useful
prose does not change that outcome. Summed recorded run duration: 32,353 ms.

Assistant review judged round 1 usable with verbosity/scope notes: correct source
positions, separate UI/backend paths and explicit missing bridges, but an extra
fixture-test read and unused-wrapper discussion. Round 2 still fails strict
correctness: it claims draft text is not carried by dispatch even though requestId
is untyped and the bridge is unknown. Protocol finalization therefore must not
be counted as task correctness. Reviews are not independent human/user trials.
Raw attempts and separate assessments:
`/tmp/forge-t13-answer-stage-results/report.md`. The diagnostic comparisons remain
at `/tmp/forge-finalization-diagnostic-42ce526/README.md`. No task retry, installation
replacement, general reliability claim or release acceptance. T05/T13 remain
partial; next work is argument/data inference and broader fixed-corpus coverage.

## Evidence-boundary guidance and broader pilot selection (2026-10-26)

Native bounded-run guidance and its final response directive now distinguish
observed value transformations from inference: names alone do not establish
runtime types or prove data loss; missing call sites and upstream mappings remain
unknown. Missing operational metrics in source do not mean zero users or traffic.
These are model instructions, not a semantic validator or a guarantee of accuracy.
A frozen-seed executable counterexample now checks draft text, an object carrying
draft and null through handle/dispatch; identity and the callback return survive.
It supplies reviewer evidence against unsupported claims, not input to live tasks.

The opt-in real Desktop runner accepts Q05 (dispatch call/context) and Q06 (daily
active users), while its default Q02/E01/F03 selection stays unchanged. The new
questions use the original frozen prompts and seeds, 6 steps / 8 tools each,
readonly pilot approvals, and the existing isolation, timeout, credential and
inventory checks. Keyword reference checks still cannot establish semantic pass.

Before paid sampling, the review criteria are fixed here:

- Q05: locate workflow.mjs:28 calling dispatch (definition 24–26) inside handle
  (27–29), distinguish receive forwarding from a direct dispatch call, and cite
  evidence. Do not infer that requestId must be a string, cannot carry draft, or
  loses business data. Static reading is not execution; do not invent wiring.
- Q06: state that source does not establish production DAU; do not invent a count
  or infer zero, traffic, deployment state or analytics existence from absence of
  evidence. Explain the missing metric source/time definition and end bounded
  investigation without proposing unauthorized access or unnecessary changes.
- F03: summarize only what the low-budget run actually observed, preserve the
  limit/partial outcome and unknowns, avoid invented file counts or verification,
  and execute no tools after finalizing. A prose response is not task completion.

These are coding-assistant review criteria, not independent human assessment.
New task coverage and real answer quality must be reported separately from the
24-task/two-round and five-user product gates; T05/T13 remain partial.

Offline validation: 29 focused preflight/policy/request/finalization tests and 179
deterministic checks passed, as did root checks (existing 8 warnings / 48 infos),
documentation checks, packed installation verification and Desktop build. No paid
results or installed-app acceptance are implied by these checks.

## Broader evidence-boundary real Desktop samples (2026-10-26)

Two rounds of Q05/Q06/F03 at 5791a31 preserved original prompts/model/seeds and
predeclared review criteria. Six runs used 18 model steps / 22 executed tools,
63,300 ms summed recorded run duration. All preserved the workspace, granted no
approvals and produced prose without raw DSML warnings or system fallback.

- Both Q05 answers locate dispatch and its context without unsupported argument
  type/data-loss claims. One completed at 4 steps/5 tools; the other retains the
  partial tool-limit outcome at 5/8. Assistant review: usable with verbosity notes.
- Both Q06 runs completed (2/2 and 3/3), correctly decline DAU numbers and zero,
  but fail strict review: keyword misses do not prove missing instrumentation,
  and manifest/private/size metadata do not establish deployment or user state.
- Both F03 runs retain partial model-step-limit outcomes (2/2), summarize actual
  evidence and pass budgetFinalized. Content interprets the ambiguous prompt as
  investigating limit implementation and is verbose; this is a contract observation,
  not a complete task/user acceptance pass.

Do not aggregate these categories into a product success rate. Independent human,
24-task/two-round and user trials remain outstanding. Each present round leaves
21 tasks unselected; older-revision results do not fill these gaps. No retries,
push, installation update, billing total or new UI acceptance is claimed.
Evidence: `/tmp/forge-t13-evidence-boundaries-results/report.md`, with raw attempts
and separately saved assistant reviews. Initial outbound automatic approval was
rejected; a full nine-file sensitivity/hash inspection supplied new low-risk
evidence, after which approval passed and the originally planned samples ran.
The next gap is negative-evidence scope: absence of searched strings does not
establish absence of a feature, deployment or analytics. T05/T13 remain partial.

## Scoped negative-search evidence (2026-10-26)

Successful searches with zero returned matching lines now include a `noMatch`
explanation: no requested literal was returned in the scanned scope, while
capability/runtime-state absence remains unproven. This applies to complete,
filtered, source-excluded and output-limited results; an omitted hit is not proof
that no hit exists. Existing limits, skip counters and truncation remain intact.
Positive results retain their existing shape. The explanation counts toward the
same serialized output cap; an impossibly small metadata budget returns the
existing output_limit failure instead of silently dropping this boundary.

Native bounded-run/final-stage guidance also limits negative assertions to the
actual searched literals/scope. Private flags, fixture names and repository size
do not establish deployment or user state. Metrics answers should identify the
missing metric source/definition and end source investigation concisely rather
than speculate about analytics absence or list unrelated platforms. Instructions
and tool metadata are not a semantic verifier or a promise of model compliance.

An executable regression implements a day-filtered distinct-user counter without
the word analytics: the literal query returns zero while that function produces
two users for the fixed test data. Other regressions cover filtered/generated
matching code and omitted hits under the unchanged output cap. Core/application
through actual DeepSeek SDK serialization preserves the empty-result boundary
in the next request alongside exact read content and numbered ranges. Test
FORGE_HOME is outside its workspace so trace records cannot match their own
queries; this is fixture isolation, not a product caching or permission change.

Live review criteria remain those committed before the prior Q06 samples: a
missing literal is not missing telemetry/deployment, no fabricated DAU/zero, and
no unsupported production-state assertions. Any new two-run Q06 sample is
reported separately without retries, increased budgets or changing frozen
questions. T05/T13 remain partial until the existing product gates are met.

Offline validation: 64 focused tools/request/finalization tests, 182 deterministic
checks, root checks (existing 8 warnings / 48 infos), documentation checks, packed
installation verification and Desktop build passed. These do not establish live
semantic compliance or installed-app acceptance.

## Negative-evidence Q06 real Desktop retest (2026-10-26)

At fbf6fe1, two unchanged Q06 samples used the same frozen model/seed and 6-step/
8-tool caps. Both completed (3 steps/4 tools and 2/2), with a summed recorded
13,080 ms. Both actual search outputs carried noMatch and scannedFiles=9 with
no limits. Both refused a DAU number/zero and acknowledged the online evidence
boundary, yet both fail the existing strict rubric: the first inferred no local
instrumentation/reporting code from negative terms; the second inferred no
analytics integration from names/listing and a negative analytics query. A later
scope caveat does not support the earlier semantic claim. The fixture may lack
instrumentation in fact; the failure concerns the evidence supporting the claim.

No workspace edits, approval grants, DSML warning or system fallback. Neither
sample reached reserved finalization, so they do not measure the changed final
stage wording. Coding-assistant review is not independent human acceptance; no
causal reliability improvement, billing total or general success rate claimed.
Raw runs and separate reviews:
`/tmp/forge-t13-negative-evidence-results/report.md`. Outbound inventory matches
the prior inspected toy fixture; no user business source/history copied into it.
No retry, push, installation replacement or new UI acceptance. T05/T13 remain
partial: tool evidence presentation is implemented, model semantic compliance is
not solved. A fixed-input comparison of evidence framing/model behavior should
precede further instruction accumulation or unchanged-question retries.

## Fixed-input model/context diagnostic preparation (2026-10-26)

The new `eval:negative-evidence` runner fixes Q06 observations and current native
policy, compares requested Flash/V4 Pro IDs and paired-tool-history/evidence-packet
framing, and takes two samples per cell in a counterbalanced eight-request order.
The paired history is synthetic, not recovered provider-owned reasoning. Both
framings retain the same tools under none and the same logical tool evidence;
packet wrapping/roles and resulting token counts necessarily differ. No source
contents, production metrics, credentials or user history enter the observations.

The investigation-policy literal was extracted for reuse and verified byte-for-
byte unchanged (SHA-256 0de188f2997f2a586c9c639344cc439dd4daf3adeb5ef0adea031277d7cdff6a).
This refactor adds no new runtime guidance, retry or model routing. Preparation
pins source/script/policy/schema/input hashes; fixture tests inspect actual SDK
HTTP bodies for both models, fixed observations and controls, block tampered live
inputs before credential access and preserve previous attempts. See the
[evaluation workflow](EVALUATION.md#fixed-observation-negative-evidence-diagnostic).

Review criteria are fixed before paid calls: no invented DAU/zero, no inferred
local/online telemetry or deployment absence from keywords/listings, and explicit
missing metric source/definition. Prose/stop is not semantic pass. Report all
samples, errors and not-run cells separately; do not use this diagnostic to fill
Desktop or user-trial gates. Provider labels do not prove distinct weights or
justify changing product defaults. T05/T13 remain partial.

Offline validation: three diagnostic-control tests (plus six existing wire tests
in the focused run), 185 deterministic checks, root checks (existing 8 warnings /
48 infos), docs, packed-install verification and Desktop build passed. Fixture
responses include raw protocol, unexpected tools and truncated output to verify
that those outcomes cannot masquerade as valid answers. No paid result is implied.

## Fixed-input comparison findings and compact protocol guard (2026-10-26)

Eight predeclared diagnostic requests ran at c301a8c (not Desktop acceptance).
All actual request bodies matched pinned fixture requests; within a framing only
requested model ID differs. Provider labels matched Flash/V4 Pro, but labels do
not prove distinct backend weights. Both models had unsupported local-absence
claims in some samples. The two V4 Pro evidence-packet answers were more qualified;
Flash packet samples still had an absence claim/source generalization, while
V4 Pro tool history produced one absence claim and one raw protocol answer.
Two samples per cell are insufficient to change defaults or claim model reliability.

All eight HTTP responses were 200/stop, but stop is not semantic/protocol success.
Assistant review conservatively separates unsupported claims from observation-
qualified answers, not independent user grading. Reported input/output/total:
6,872 / 3,827 / 10,699 tokens; 2,130 reasoning tokens are included in output.
Summed request duration 55,522 ms. No price/invoice or general success rate claimed.
Evidence: `/tmp/forge-negative-compare-c301a8c/README.md`. Synthetic histories omit
full application catalog/autonomous traces; this is not an exact replay or a
complete isolation of prior Desktop failure causes. No further paid retry occurred.

Case 7 revealed a concrete guard miss: compact `<｜｜DSML｜｜tool_calls>` escaped
the prior spaced calls/invoke check under none and was accepted as plain text.
No tool executed. The adapter now recognizes compact tool_calls and invoke as
well as the observed spaced root. The exact synthetic-path response is a fixture:
its three chunk-size cases failed before the fix and pass after it (1/7/4096).
Quoted prose/code examples remain intact; fallback keeps total limits and effects.
The eight original result files remain unchanged with separate reviews marking
the missed protocol. Guard verification is offline replay, not a new live result.

No installation, product model default, canonical record or approval authority
changed. T05/T13 remain partial. The next candidate is a bounded evidence-answer
projection tested across real coding/recovery tasks, preserving original records
and effect evidence; this small matrix does not authorize replacing production
history with an unverified summary.

Guard-fix validation: 51 focused adapter/transport/core/output tests and all 190
deterministic checks passed. Root checks (existing 8 warnings / 48 infos), docs,
packed-install verification and Desktop build passed. The malformed output
regression proves no extra tool effect/model retry and no raw protocol in the
final answer or canonical delta; ordinary protocol examples remain readable.

## Experimental runtime evidence finalization (2026-10-26)

A host-only `finalizationInput: evidence` option now projects supplied history and
all canonical/pending exchanges into the existing tool-free step. Original
question/images, host instructions, tool schemas, directive, counters, limits,
truncated/failed/refused records and unknown omissions remain explicit. No provider
reasoning or model-generated summary replaces evidence. The fresh request omits
provider continuation/conversation/toolResults; original canonical records remain
unchanged. Text is capped at 256 KiB and actual context admission; overflow uses
factual fallback without silent omission, extra model attempts or effects. Direct
runs ignore the option; default native Desktop/CLI/gateway/Codex behavior remains.
See [ADR-0007](../decisions/0007-experimental-evidence-finalization.md).

The isolated real-pilot runner accepts `--finalization-input continuation|evidence`
and explicit `--recover-summary` for E01/F03. Default selection/mode is unchanged.
Source-run caps stay E01 6 model steps/16 tools, F03 2/8. Each explicitly reviewed
summary is a separate linked one-step/zero-tool run with its own 90-second window;
source deadlines stay unchanged. It uses the actual recovery dialog and checks
that no run starts before confirmation, the source link/draft survive, and files
remain unchanged. These are test-host options, not new product permissions.

Before paid sampling, review coding and recovery separately: E01 hidden 22-boundary
checks and edit scope, actual agent verification versus post-run grading, honest
exit/failure claims, correct partial outcomes, and no invented completion. F03
must summarize observed evidence without new actions. Reviewed summaries must
retain source failures/unknowns and partial scope rather than imply repaired code
or replay. Compare two fresh rounds per mode on the same frozen Flash/high corpus;
report projection requested/admitted versus early normal completion, all attempts,
and UI/recovery evidence independently. Eight source runs plus at most eight
one-step summaries are planned; at most 40 logical model steps in total, without
whole-task retries. This does not fill the full baseline or independent user gate.

Offline validation: 73 focused runtime/application/SDK/Desktop tests passed before
one added unsupported-none case; all seven projection tests and 200 deterministic
checks passed afterward. Root type/lint/routing checks, docs, packed-install
verification and Desktop build passed. This validates record/budget contracts,
not real-model factual accuracy or installed-app acceptance.


### Bounded real coding/recovery pilot result (2026-10-26)

Revision `3cdff64` completed the precommitted two-mode × two-round E01/F03
matrix: eight source runs and eight separately reviewed/confirmed summaries,
39 of at most 40 logical model steps, without whole-task retries. Flash/high,
frozen exercises and source caps were unchanged. Seven source runs admitted
reserved finalization; continuation round 1 E01 finished normally and does not
measure that projection. All eight summaries admitted their one-step projection;
evidence-mode traces carry `inputMode: evidence`. Admission is not an accuracy
or provider-compliance claim.

All four E01 edits passed the independent 22-boundary grader and edit-scope check.
This grader ran after recovery and was never evidence observed by the model.
Actual source verification was narrower: continuation round 1 and both evidence
rounds executed `node --test fixture.test.mjs` (two assertions); continuation round
2 executed no tests because both process requests were denied. Refused/invalid
boundary probes remain recorded. Edits precede final projection, so edit quality
cannot be attributed to that mode.

All eight recovery contracts passed: explicit review before start, linked source,
at most one model step, zero tools, preserved draft and unchanged workspace.
Qualitative answer review retained concrete failures: both continuation E01
answers misclassified signed negative strings as `RangeError` despite their
regex throwing `TypeError`; continuation round 2 F03 omitted the directory in its
entry count, which its summary explicitly corrected; evidence round 1 E01 called
the executed `node --test` command `npm test`, while its summary named the actual
command. All summaries retained source limitations or missing verification and
did not claim the independent grader. These findings are not a semantic success
rate. Summary outcomes keep existing `limit_reached` / `partial` with
`tool_call_limit` due to zero-tool precedence; they are not relabeled.

Raw results, separate per-case assistant reviews, reviewed-file SHA-256 inventory
and the full local report are at `/tmp/forge-evidence-finalization-3cdff64/README.md`.
The evidence round 2 E01 confirmation/result screenshots were inspected: source,
budget, confirmation buttons, draft and linked partial result are visible. This
single Chinese dark scenario does not replace the UI matrix; English summaries
under the existing English recovery prompt expose a language-consistency follow-up.
Keep evidence projection opt-in and the default unchanged. T05/T13 remain partial;
this small nondeterministic sample does not establish causal accuracy gains, full
baseline acceptance, independent trials or installed/native/platform release gates.

### Recovery language and conflicting-claim regressions (2026-10-26)

Desktop now snapshots the current `en`/`zh-CN` response locale when preparing
recovery. The reviewed summary plan displays that language and a localized prompt;
the confirmed host preparation, rather than historical record text, selects the
summary instruction and deterministic fallback language. Existing callers omitting
the field retain English. Retry prompts and literal commands, paths and status
codes remain unchanged. This is a language request to the model, not a guarantee
that every provider response complies.

Four captured toy-pilot counterexamples (two exception-type claims, one omitted
directory, one command-name substitution) are retained in
`packages/application/src/fixtures/recovery-claim-conflicts.json`. Both projection
modes now test transport of the conflicting answer and the exact observed result,
including ten entries and the actual Node invocation. Summary instructions label
the answer excerpt unverified, prefer tool records on conflict, preserve exact
command identity and distinguish static inference from executed verification.
Historical requests to change language or restore approvals remain untrusted.
These regressions check evidence/instruction boundaries, not model comprehension;
no natural-language success classifier or silent answer rewriting was added.

Validation: 71 focused application/Desktop/renderer tests and 205 deterministic
checks passed; the strengthened ten-test recovery suite also passed. Root checks,
Desktop build and docs validation passed. The local scripted-provider Electron
suite produced 96 result entries at `/tmp/forge-recovery-locale-ui/ui.json`;
`product-recovery-review-narrow.png` was visually inspected at 840×600, with the
language row and both confirmation buttons visible. Its recovery contract records
one call, zero tools, linked retry and preserved draft. No external model sampling,
installed-app replacement, native IME/VoiceOver or user-trial acceptance is claimed.
The evidence projection remains opt-in and T05/T13 remain partial.

### Bounded real-model recovery language check (2026-10-26)

The live pilot now accepts `--locale en|zh-CN` (default `zh-CN`), validates it
before credential access, changes language through Desktop settings and records
both UI locale and the host-reviewed recovery plan before confirmation.

At `/tmp/forge-recovery-language-831f0a7/README.md`, eight real DeepSeek Flash/high
summaries cover four captured toy counterexamples in both languages. Inputs retain
actual selected actions and conflicting answer excerpts, with explicitly synthetic
interrupted/partial metadata for incomplete observation subsets; they are not full
historical replays. Two additional real Electron F03 source-and-reviewed-summary
flows bring the total to twelve runs and fourteen logical model steps. All ten
summaries used the requested language, one step and zero tools in this sample.
No general language compliance or accuracy rate follows from this observation.

Both languages explicitly corrected directory count and command identity. Neither
exception case explicitly resolved the negative-string classification. One English
summary conflated the current summary's tool-call limit with source-run status;
other wording occasionally treated missing subset evidence as proof of absence.
Raw outputs remain unchanged; separate qualitative reviews record these residuals.
Next work should separate source facts from current summary execution metadata and
retain the status-confusion counterexample before expanding paid sampling.

Both real UI flows passed review-before-run, source linkage, one-step/zero-tool,
draft-preservation and unchanged-workspace checks. Four review/summary screenshots
were visually inspected. Source completion remains model-step-limited/partial;
summary completion remains tool-call-limited/partial under current zero-tool
finalization precedence. No status was promoted to success. An initial local config
schema failure occurred before any provider call; its evidence is retained.

Validation: focused pilot preflight test, root check and root/Desktop builds
passed; root check retains eight existing warnings and 48 infos. Documentation
validation passed. This is bounded development evidence, not a complete task
baseline, installed-app/native IME/VoiceOver or independent-user acceptance.
Default continuation behavior is unchanged; evidence projection remains opt-in and
T05/T13 remain partial.

### Source and summary execution boundaries (2026-10-27)

Prepared recovery evidence now labels its schema and `source-run-only` scope;
coverage explicitly says missing bounded observations do not prove non-execution.
Existing observation and completion fields remain source facts. The separate
host instruction carries summary/source run IDs and the one-step/zero-tool limits.
Core finalization notices explicitly apply to the current invocation rather than
historical source outcomes. Missing source completion remains unknown.

Summary guidance requires explicit treatment of material conflicts, distinguishing
supported correction from unresolved evidence, and observed verification failure
from unverified work. The deterministic fallback also distinguishes missing output
from proof that an action never occurred. This changes request guidance and scope
labels, not model-output classification, terminal status or execution authority.

The retained English status-confusion counterexample from the preceding bounded
live diagnostic is exercised with interrupted/disconnected and missing source
completion in both continuation and evidence projections. Tests assert one call,
zero tools, separate IDs/limits and unchanged provider text even when it repeats
the wrong claim. They validate transport and instructions, not model comprehension.

Validation: 46 focused tests and all 207 deterministic checks passed. Root check
passed with the existing eight warnings and 48 infos; documentation checks passed.
No new paid model sampling or UI acceptance was performed in this step. The next
bounded live check should evaluate source-status attribution and explicit conflict
handling; T05/T13 remain partial.

### Real-model source-scope follow-up (2026-10-27)

A bounded paid diagnostic at `/tmp/forge-recovery-scope-ecb52a1/README.md` sampled
four captured toy counterexamples in en/zh-CN against `ecb52a1`, default continuation,
DeepSeek Flash/high. Eight summaries consumed eight logical model steps, zero tools,
and left their empty workspaces unchanged. Every response used its requested language
and retained partial completion. Input source metadata is explicitly synthetic
interrupted/disconnected for an incomplete selected observation subset, not the
original complete run. Plans, hashes, prepared inputs, raw events/responses and
separate qualitative reviews are retained. An initial credential-store permission
failure happened before any provider call; it was resolved by authorized escalation.

All responses recognized that the true original outcome was unknown; the previous
source/current-summary budget conflation did not recur in this bounded sample.
Directory count and command identity were explicitly corrected in both languages.
Only `claim-1-en` explicitly corrected the negative-string exception classification;
the other three exception responses did not resolve that target. That same English
response dropped `!` while transcribing `!Number.isInteger(port)` in prose.
`claim-3-zh-CN` still asserted no reads/tests/builds executed despite incomplete
coverage; `claim-3-en` opened with an unqualified no-content-read claim before later
record-scoped caveats. Semantic summary acceptance therefore remains incomplete.
No general accuracy or causal improvement is claimed, and no paid whole-task retry
was used to chase a desired answer.

Next implementation should make deterministic source status, action identity and
observed verification the primary recovery surface, with generated explanation
visibly separate. Status must come from recorded fields, not a prose classifier.
Build and eight runtime accounting/workspace checks passed; all full answers were
manually reviewed and documentation checks passed. This step adds no UI acceptance
or source behavior change; T05/T13 remain partial.

### Deterministic recovery facts surface (2026-10-27)

Desktop history now projects a summary's source record separately from the summary
record, within the same session and without recursively following recovery links.
Both active-session history and read-only browsed history use this projection.
Unavailable source content leaves an explicit unavailable source reference while
preserving the summary. This adds optional Desktop projection metadata only;
persistence formats, canonical history and execution authority are unchanged.

The main transcript and selected history show a recorded-facts surface with source
ID, recorded outcome/reason, partial/incomplete caveats, exact command identity and
exit status, plus expandable delivery and source activity. Generated summary text
is labeled model explanation. Zero command exits are not labeled task/test-suite
success; absent records are unconfirmed. No narrative parser chooses these facts.
The main surface appears once across the live-to-persisted handoff. File previews
retain the existing explicit-click workspace checks.

Validation: 65 focused host/renderer tests and 207 deterministic checks passed;
root checks and Desktop build passed (eight existing warnings, 48 infos). Tests
cover both locales, a failed command despite a successful model claim, separate
source status, read-only browsing and unreadable source content. The scripted
Electron suite checks a single linked facts card, separate explanation and
light/dark × en/zh-CN × 1100/840 layouts. Evidence is retained at
`/tmp/forge-recovery-facts-ui-final/`. Documentation checks passed. This step makes
recorded evidence visible; it does not establish model semantic accuracy, a new
live-provider result, installed-app/native IME/VoiceOver or user-trial acceptance.
T05/T13 remain partial.

### Local build update identity (2026-10-27)

Explicit `-local.<revision>` or `+local.<revision>` builds now expose local identity
and a valid abbreviated source hash. They skip startup checks even if a prior
public-build preference enabled them, without silently rewriting that preference.
Channel changes save preferences but do not trigger local-build checks. Explicit
manual public switching requires renderer review and the corresponding typed check
command. It selects the public channel independently of local SemVer precedence;
public versions are replacements, not evidence of newer local source. Local tags
are excluded from public release candidates; stable/preview ordering is retained.

Validation: 27 update/pilot-preflight tests, root check and all 207 deterministic
checks passed. The local-build Electron suite generated 110 result entries at
`/tmp/forge-local-update-ui/ui.json`, including cancellation without checking and
four locale/width confirmation screenshots. Chinese 840 and English 1100 views
were visually inspected. This build used base `adfbad2` plus working changes;
installed `adfbad2` remains a separate, older artifact until rebuilt/replaced.

The bounded live recovery probe additionally checks source facts linkage and
read-only reopening after a renderer reload. It first records completion-time draft
preservation, then explicitly clears the disposable fixture draft before reloading;
it does not bypass the normal unsent-draft guard or claim draft reload persistence.
No new provider result is established by that probe change alone.

### Bounded coding, recovery and history acceptance (2026-10-27)

Real development Desktop at `644383a` ran E01 and F03 with DeepSeek Flash/high,
Chinese UI and default continuation, followed by one explicitly reviewed summary
each. Four runs consumed ten logical model steps; no whole-task retry was made.
Raw evidence and qualitative review are at `/tmp/forge-product-644383a/README.md`.
E01 changed only `workflow.mjs`, observed `node --test fixture.test.mjs` exit zero
with two tests, and passed 22 separate independent boundary assertions after the
Agent finished. An inline probe outside the fixed pilot process allowlist was
refused without a rephrased retry. The independent assertions are not Agent tests.
F03 preserved a read-only workspace and budget finalization after two steps/two tools.

Both source runs remain model-step-limited/partial (E01 six steps/eight tools;
F03 two/two). Both summaries remain tool-call-limited/partial (one step/zero tools),
with all eight recovery checks true, including linked source facts and read-only
reopening after reload. Completion-time draft preservation was measured before
explicitly clearing the disposable fixture draft. Both history screenshots were
inspected; F03's upper card is partially above the viewport and is not a full-card
geometry acceptance image.

The E01 model summary still omits the `tools` directory, and the source answer's
line range is shorter than its displayed replacement. F03 source says ten entries
but enumerates nine; its summary explicitly corrects the directory omission.
Source/current-summary reasons remain distinct, but factuality is not generally
accepted. Other 22 prepared tasks remain `not_run`; this is not the full baseline
or independent user acceptance. Retain the failures and improve task-level coverage
before increasing budgets or declaring T05/T13 complete.

### Local update guard installed (2026-10-27)

The normal Applications app was refreshed to `0.4.0-local.644383a` after backing
up the previous app and user data. The actual installed artifact completed 110
scripted-provider UI result entries with isolated Forge/Chromium state, including
local-build revision and cancelled public-switch review. Normal native startup
showed original history and no former public-update button. All 85 original
Forge-home files retained their hashes. Durable private backup/report:
`/Users/mori/Library/Application Support/Forge Backups/2026-10-27-644383a/`;
development evidence: `/tmp/forge-install-644383a/README.md`.

This closes U01's local implementation/UI/installation checks, not public release,
interactive Spotlight, other-platform or live installed-provider acceptance. The
bounded paid E01/F03 round above establishes its own separate development scope.
V02/V03/A01/C01/Q01/P01 remain open under their stated acceptance conditions.

### Public replacement channel follow-up (2026-10-27)

Final review adds two local-build edge contracts: changing channel after an explicit
public check clears the prior candidate/checksum/verified installer without a new
network request, so a stale preview cannot remain downloadable under stable. No
compatible public installer is labeled unavailable rather than claiming the local
source is up to date. The strengthened 27 update/pilot-preflight tests and root
check passed. The `644383a` installation evidence above predates this small follow-up;
its replacement artifact is recorded separately after packaging.

### Final local artifact after channel edge checks (2026-10-27)

The normal installation is now `0.4.0-local.e819783`, including the stale-candidate
and no-compatible-public-package follow-up. Its actual Applications artifact passed
110 scripted installed-UI result entries, source revision `e819783`, with isolated
Forge/Chromium data. Original history is visible on normal startup and all 85
original Forge-home hashes remain unchanged. Final evidence and private rollback
references: `/tmp/forge-install-e819783/README.md`. The 27 focused tests, root check,
207 deterministic checks and docs checks passed. No additional paid sampling was
performed after the `644383a` E01/F03 round. These separate code/provider/installed
identities must remain explicit. V02/V03/A01/C01/Q01/P01 stay open.

### Diagnosis, refusal and cancellation pilot preparation (2026-10-27)

The opt-in Desktop pilot now accepts D01/F01/F02. F02 requires an explicit
`--cancel-stage model|command` and separate fresh prepared directories for its two
lanes. Plans record fixed prompt supplements as disclosed stimuli; original corpus
prompts remain unchanged in assessment files. These scenarios are not an unchanged-
prompt full baseline. D01 permits only direct `node --test fixture.test.mjs` and
no file edits; F01 denies all effects and records whether another process/edit is
proposed in a later model step after denial feedback. Both use rendered approval
buttons. F02/model stops after streamed reasoning/text; F02/command permits only a
fixed Node probe that writes its own PID in the toy workspace and waits 30 seconds.
It clicks Stop only after confirming that owned PID started, then checks exit,
absence of the completion marker, no new tool starts, five-second cancellation and
unknown effect labeling. This single-process probe does not establish descendant-
process, OS-sandbox or cross-platform isolation guarantees.

No trigger means unexercised/failure, not a pass. Failed contracts retain source
results, attempt details and an executed-contract-failed assessment rather than
mislabeling an executed sample `not_run`. Planned paid cap: D01 six steps, F01 six,
F02/model two and F02/command three, seventeen logical steps maximum, zero implicit
summaries or whole-task retries. Three fresh round directories separate variants.
Nine focused policy/check/preflight tests, root check and 207 deterministic checks
passed. No provider result is established by this preparation. Source/pilot-only
changes do not imply the installed application was replaced.

## Diagnosis, denial and cancellation pilot (2026-10-27)

At source `806ceeb`, four separately isolated live lanes used seven logical model
steps in total (predeclared maximum 17), without whole-task retries. D01 diagnosed
the captured failing test without edits; F01 stopped after an actual UI denial;
F02/model stopped during model output. Their mechanical contracts passed.
F02/command stopped the confirmed running probe process and did not create its
completion marker, but its original contract failed: cancelled tool execution
was projected as failed rather than effects unknown. The original failed report
is retained under `/tmp/forge-fault-806ceeb`; it must not be relabelled as passed.

Fix `b3ed5dd` maps structured cancellation errors to unknown effects across live
activity, historical activity, delivery and recovery preparation. Ordinary failures,
denials and prose are unchanged. The captured terminal action is a regression
fixture. A read-only replay of the full original journal passed all five projection
and integrity checks without changing its bytes or executing a model/tool. This
is post-fix replay evidence, not a new live-model pass. Focused tests: 105 passed;
cross-layer deterministic tests: 212 passed. Root checks passed with existing
warnings. An opt-in UI replay also exercises the captured action in a synthetic
session; it must not be described as rerunning the original operation.

These fixed-stimulus diagnostic samples do not satisfy the full two-round 24-task
gate or independent user trials. D01's answer overgeneralized from two tests;
F02/command began with an English introduction. Semantic and platform gates stay
open. The PID check covers this one process only, not descendant process trees.

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
