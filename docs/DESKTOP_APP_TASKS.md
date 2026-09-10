# Desktop development task checklist

[简体中文](zh-CN/DESKTOP_APP_TASKS.md) · [Design contract](DESKTOP_APP_PLAN.md) · [Documentation](README.md)

## Execution rules

Created 2026-09-06 as current-development. The design contract controls product
scope; current source/tests establish implemented behavior. Every task starts
**Not started**. This handoff only creates documentation, not implementation,
dependency installation, or publication.

Follow dependencies with independently reviewable and reversible changes. Verify
and record implementation details; request decisions only for unresolved scope or
new external costs. Do not reselect agreed technologies. Without explicit permission,
do not publish, upload user files, or use paid providers; continue independent
offline work. This checklist does not request multiple agents.

## Dependencies and status

| ID | Task | Depends on | Status |
| --- | --- | --- | --- |
| D01 | Baseline and technical verification | None | Complete |
| D02 | Electron scaffold and packaging smoke | D01 | Complete |
| D03 | Bilingual interactive prototype | D02 | Complete |
| D04 | Shared application services | D01 | Complete |
| D05 | Agent process and protocol | D02, D04 | Complete |
| D06 | Workspaces and sessions | D03, D05 | Complete; DeepSeek live two-turn check passed |
| D07 | Native Forge execution | D06 | Complete; DeepSeek execute/resume/deny/cancel passed |
| D08 | Codex execution and authentication | D06 | Complete; live Codex execute/resume/cancel passed |
| D09 | File operations and change review | D07, D08 | Complete |
| D10 | Content reading and previews | D09 | Complete |
| D11 | Search plugins and sourced reports | D07, D08, D10 | Not started |
| D12 | End-to-end and failure acceptance | D09, D10, D11 | Not started |
| D13 | macOS installer and handoff | D12 | Not started |

D04 can be prepared independently of prototype work. Real UI integration follows
an interactive, visually checked D03. Verify D07 and D08 separately. Dependencies
are not time estimates.

## D01 · Baseline and technical verification

**Deliver:** current SHA/worktree, actual TUI engine paths, dependencies, tests, and
compatibility matrix. Verify Electron's Node version, Agent build entry, dynamic
plugins/resources. Select versions, process API/IPC, minimum macOS and CPU coverage,
packaging tools and distribution approach. Define window-close/app-exit and
cross-engine continuation behavior without assuming background execution or lossless
engine switching. Validate react-diff-view on long/multiple files, Chinese paths,
and large changes before locking it.

**Accept:** supported decisions and reproducible checks, unknowns labeled, no loop rewrite.
**Verify:** current focused offline baseline, not old test counts.
**Entry points:** [run.ts](../apps/cli/src/run.ts), [TUI](../apps/cli/src/interactive/app.tsx),
[sessions](../apps/cli/src/persistent-session.ts), [Codex](../apps/cli/src/codex-command.ts).

**Completion record (2026-09-06, Complete):** baseline, engine paths, dependency
matrix, Electron 44.2.0 (bundled Node 24.20.0), dynamic plugin/resource checks,
react-diff-view sample validation, and all D01 decisions (process/IPC, macOS 13+,
arm64+x64, packaging and distribution, window-close/exit, cross-engine
continuation) are recorded in the [baseline document](DESKTOP_BASELINE.md).
Verification: `CI=true pnpm build && CI=true pnpm exec vitest run` (58 files /
360 tests passed), `CI=true pnpm check` passed; under Electron's Node the CLI,
a fake-adapter `runAgent` turn, session/trace round-trips, `web-tools` plugin
loading, and Skill/docs discovery all passed live checks. react-diff-view 3.3.3
matched expected rows exactly on all four sample classes; the git
`core.quotepath` octal-path limitation was found and recorded. Unverified items
(live providers, signing/notarization, GUI-launched environment) are labeled in
baseline section 7. One code change: `biome.json` now excludes vendored
`**/.agents` from Biome (pre-existing check failure unrelated to desktop work),
so `CI=true pnpm check` passes.

## D02 · Electron scaffold and packaging smoke

**Deliver:** desktop entry in the monorepo (suggested apps/desktop), selected stack,
main/preload/renderer/minimal Agent entries, shared TypeScript checks. Keep desktop
private and its commands separate from TUI commands.
**Accept:** window/process startup, communication and shutdown; no arbitrary Node/IPC
access in renderer. Both development and a local packaged artifact locate entries
and resources. Signing/publication is unnecessary for early packaging smoke.
**Verify:** build/types and offline lifecycle/error/listener checks.

**Completion record (2026-09-07, Complete):** added private
`apps/desktop` with Electron 44.2.0, electron-vite 5.0.0, React 19.2.8,
TypeScript project references, separate root `desktop:*` commands, and
electron-builder 26.15.3 DMG/zip configuration for macOS 13+ arm64/x64. Main
owns one `utilityProcess`; the bundled Agent supports only validated D02
health/shutdown messages, and shutdown waits for process exit with a kill
fallback. The sandboxed/context-isolated renderer has no Node integration;
preload exposes one fixed health method rather than raw IPC. The Agent and
builtin Skill/docs resources are outside ASAR. Verification: 2 focused files / 5
tests passed (invalid messages, missing/present resources, communication,
unexpected exit, listener cleanup); `CI=true pnpm check` passed; the final
electron-vite build passed. A development-mode hidden-window smoke and an
unsigned local arm64 packaged `.app` smoke both loaded the renderer, reached the
Agent, found resources, shut down, and exited 0. The package smoke reuses the
installed Electron distribution and therefore runs without downloading a second
runtime. Signing/notarization, x64 execution, DMG/zip artifact generation, and
publication remain unverified/deferred; D02 requires only one local packaged
artifact and does not establish those D13 outcomes.

## D03 · Bilingual interactive prototype

**Deliver:** Tailwind variables, selective shadcn/ui, Zustand views, translations,
Markdown/highlighting, home/workbench/settings and three visibly simulated workflows.
Use the final contract image rather than reopening style selection.
**Accept:** no avatars/agent bubbles, right-aligned user bubble, flowing long text;
folder/task navigation, drafts, panels, model/engine entries work. Language lives
in settings and covers menus/status/errors. Simulated approval/stop/failure makes
no real model calls or file changes.
**Verify:** rendered screenshots in both locales, long text/tables/code, narrow
windows, keyboard focus; record and correct visual differences.

**Completion record (2026-09-07, Complete):** implemented the D03 renderer in
`apps/desktop` with shared Tailwind CSS variables, a selective Radix-based Select,
Zustand view/draft/panel state, centralized i18next English and Simplified Chinese
resources, react-markdown/remark-gfm, and a TSX-only Shiki highlighter. Home,
workbench, and settings are interactive; task switching retains drafts, panels
collapse, folder/model/engine controls respond, and three simulated tasks cover
running/stop, approval, and failure/retry without model calls, commands, or file
operations. Browser checks covered both locales, the generated task flow, Markdown
table/code, 840 px narrow layout with no document overflow, visible keyboard focus,
and a 1486 × 1027 same-state comparison against the contract image. The comparison
history and intentional P3 differences are recorded in
[`apps/desktop/design-qa.md`](../apps/desktop/design-qa.md), whose final result is
`passed`. Verification: 3 desktop files / 9 tests passed; `CI=true pnpm check` and
the final electron-vite production build passed. This is still a display-only D03
prototype and does not establish any D05–D11 real execution capability.

## D04 · Shared application services

**Deliver:** extract non-presentation config/execution/session assembly into private
shared services, retaining thin compatible CLI entrypoints and injectable fakes.
**Accept:** no React/Ink in core, unchanged engine auth/policy/resources/context,
no string-derived protocol or parallel task entity. Revert without data migration.
**Verify:** focused CLI/session/provider tests, pnpm check, deterministic contracts.

**Completion record (2026-09-07, Complete):** extracted private
`@forge/application` in `packages/application`. It owns native run assembly,
Codex execution/auth/model discovery, model-adapter selection, image resolution,
and persistent session/context operations; its root also exposes the existing
configuration/instruction loaders. CLI paths retain compatible exports/wrappers.
Terminal event rendering, approval previews/questions, SIGINT, browser opening,
and terminal hyperlink formatting remain in CLI and are injected where needed.
The shared services have no CLI/React/Ink/Electron dependency or terminal stream
access. Native `RunEvent`/`RunResult`, existing Codex structured output, adapter/client
fakes, approvals and cancellation are retained; output sinks remain compatibility
interfaces, not a desktop wire protocol. No loop, session schema, authority, provider
credentials, resource policy, or task entity was added or migrated. D05 must define
and validate the actual process protocol, including existing Codex bridge limits.

Verification: focused application/CLI/session/config/provider regressions passed
14 files / 91 tests, including a direct terminal-free execution/save/restart test
and an application dependency-boundary test; `CI=true pnpm check` and
`CI=true pnpm eval:deterministic` (13 files / 71 tests) passed. Workspace references,
lockfile links, package bundling and version/tag manifest lists include the private
package. `CI=true pnpm package:verify` passed the packed-install checks
(336,459-byte tarball); a separate retry encountered registry HTTP 503.
Existing third-party lock versions are unchanged. Desktop real execution
and live-provider/auth checks are deferred to D05–D08. Reverting this extraction
requires no user-data migration.

## D05 · Agent process and protocol

**Deliver:** main-owned lifecycle and validated typed requests/events/approvals/cancel,
request/Session/Run IDs, sequence, subscription, completion/disconnection and stale
message rules. Bridge cancellation via messages, not serialized AbortSignal objects.
**Accept:** no cross-task events, reject invalid operations, narrow bridge, no renderer
credentials. Crashes release waiting UI without replaying effects; no process/listener leaks.
**Verify:** offline ordering/duplicate/late events, approval cancellation, disconnects
and termination. Do not describe process isolation as a sandbox.

**Completion record (2026-09-07)**: Added strictly validated start/cancel/approve
messages, request/session/run correlation, monotonic event sequences, disposable
subscriptions, and an injectable single-run executor. Duplicate requests and used
run IDs never replay; cross-run, duplicate and late events are ignored. Sequence
gaps and acknowledgement timeouts interrupt the connection and terminate the Agent.
Cancellation/shutdown deny pending approvals; cancellation completion waits for the
executor. Crashes settle pending requests and emit an interruption shown bilingually.
The fixed preload bridge checks the owning window/main frame in main and rejects
extra credential/authority fields. Concurrent shutdown is coalesced with exit waiting
and kill fallback. Shared chunks are included in both packaged process locations.

Validation: `CI=true pnpm check` and `CI=true pnpm exec vitest run apps/desktop/src`
passed (4 files / 17 tests), including approval acceptance/cancellation, cross-run
messages, replay, late events, sequence gaps, crashes and 20 lifecycle cleanup cycles.
`CI=true pnpm desktop:smoke` hit SIGABRT inside the sandbox; outside it both development
and unsigned local arm64 packaged application smoke passed. No live provider was called.
The production entry has no executor yet and returns false for start. D06 connects
sessions; D07/D08 connect shared application execution, detailed tool events, results
and engine-specific approval semantics. The bounded text/approval/complete DTOs do
not replace the full RunEvent/RunResult contract or establish full Codex bridge approval
support. Process isolation is not a security sandbox.

## D06 · Workspaces and sessions

**Deliver:** folder selection, shared cwd/root semantics, automatic
$FORGE_HOME/workspaces/<id>/ on valid submission, Session-backed tasks and drafts.
Reuse JSON/JSONL, expose effective home, add minimal conflict/busy rejection without takeover.
**Accept:** Git subfolder/ordinary folder correctness; no restored authority or expanded
boundary. Missing/corrupt directories/history, overrides, writes and conflicts report
errors while preserving snapshots. No full Forge-home access or mandatory task.json/input/output layout.
**Verify:** config/workspace/persistence regressions and temporary-directory restart/conflict tests.

**Dependency integration (2026-09-08)**: Connected directory selection, private automatic
workspaces, shared Session creation/list/resume, per-session drafts, Forge home display,
and compaction for D07/D08. Automatic paths are canonicalized and reject expansion to
an ancestor Git root; execution rechecks workspace boundaries. Exclusive desktop
session locks and snapshot hashes reject occupied sessions and changed snapshots.
These are not a takeover service; a crash lock requires manual handling after verifying
no owner remains. This was the initial dependency subset; full acceptance follows.

**Completion (2026-09-08)**: Startup lists existing Sessions across workspaces, making
private automatic-workspace tasks discoverable after restart. Resume uses the saved
workingDirectory and revalidates its current root, retaining Git subdirectories.
Missing/non-directory paths, changed boundaries and invalid configuration reject the
transition without replacing the active session. Drafts are scoped to a session or
new-task working directory within the current window. Management failures have bilingual
categories; raw parser errors and credentials never cross into the renderer.

FileSessionStore now takes a short exclusive write lock and checks the loaded revision
before atomic replacement. Stale desktop/CLI clients cannot overwrite a newer snapshot
written through the same protocol, and listing never refreshes an active writer's revision.
The desktop's longer run lock still rejects occupied sessions. No automatic takeover:
crash-left `.desktop-lock` / `.json.write-lock` files require manual removal after checking
that no owner remains. External writers bypassing this version's store do not honor its lock.

Validation: 97 focused desktop/application/config/workspace/persistence/CLI tests and
71 deterministic cross-layer checks passed. Nine new workspace/session cases cover Git
subdirectories, ordinary/missing directories, corrupt/missing history, configuration
restrictions, automatic boundaries, stale/concurrent writers and unwritable-directory
snapshot preservation. Live DeepSeek `deepseek-v4-flash` passed: create/read a file and
run `pwd`, recreate the desktop service, discover/resume from the startup list, then
read/edit the same file. Assertions cover final contents, two persisted runs, successful
tool exchanges, approvals and streaming text. Live calls use DesktopApplication and the
shared native executor; separate Electron smoke covers the bridge/UI. This is not a
live-model GUI interaction test. Temporary files/sessions were removed and credentials
stayed inside the test process. Explicit reproduction:
`CI=true FORGE_DESKTOP_LIVE_DEEPSEEK=1 pnpm exec vitest run apps/desktop/src/agent/deepseek-live.test.ts`.
Default test runs skip live calls. `pnpm check`, `pnpm check:docs` and
`pnpm package:verify` passed (CLI package: 337194 bytes). Electron hit SIGABRT inside
the restricted sandbox; development and local unsigned arm64 packaged smoke both passed
outside it. No signing, notarization or publication was performed.

## D07 · Native Forge execution

**Deliver:** real submission, streaming, activity, approval/cancel, persistence/context display.
**Accept:** two turns, real read/edit/command execution; denied actions do not execute,
no new actions after cancellation, stopping until confirmed. Recover complete exchanges,
distinguish completion from verification, preserve TUI behavior.
**Verify:** fake-adapter end-to-end first, then authorized configured live-provider smoke;
record separately and finish independent offline work when credentials are unavailable.

**Implementation and offline completion (2026-09-08)**: The real Electron workbench
calls `@forge/application.runTask` in the Agent through the fixed bridge, with streaming
text/reasoning, tool activity, one-time approval/denial, confirmed cancellation, session
saving, and context. Engine/workspace/session switching is disabled during execution.
Native execution keeps the existing safe policy, tools and agent loop. A denied tool
never executes; the model may still answer afterward, so tool failure is distinct from
run outcome. Shutdown cancels and drains the executor with main's termination fallback.

Offline tests exercise actual read_file, edit_file create/replace, and run_command,
approval/denial/cancellation, two turns, restart with four complete tool exchanges,
occupied/stale sessions, and automatic-workspace execution. Optional engine and history
boundary fields extend schema v3 while accepting old snapshots. Switching engines sends
text only; restoring does not reintroduce earlier tool state. No approval authority is
persisted. Live paid-provider execution remains a separately authorized acceptance step.

**Full acceptance (2026-09-09)**: Extended the D06 live test with denial and cancellation.
DeepSeek `deepseek-v4-flash` passed four turns (16.06 seconds): create/read/command,
restart and edit, deny a write, and cancel at approval. Assertions check file contents,
complete tool exchanges, absence of denied/cancelled files and persisted cancelled status.
Default offline runs never call the provider; use the explicit D06 reproduction command.
Run completion, tool denial and cancellation are verified separately.

## D08 · Codex execution and authentication

**Deliver:** existing Codex execution/auth in the workbench, engine/model identity,
setup/unavailable errors, no credential copying or silent native fallback.
**Accept:** separately verify startup/auth/output/errors/cancel/history. Do not advertise
Forge plugins as Codex tools or infer complete approvals/sources from exit-code success.
Identify and address bridge gaps or label limits. No active-run engine switch; continuation
follows D01 decisions.
**Verify:** current transport/CLI offline checks separately from authorized local integration.

**Implementation and offline completion (2026-09-08)**: Connected `runCodexTask`, model
catalog/status, browser login and login cancellation to the same workbench. Credentials
remain with the existing Codex App Server. A non-terminal host approval callback supports
one-time command/file acceptance or denial. Unknown operations remain unsupported.
Startup cancellation races, completion-listener cleanup and late approval acceptance
are covered; Agent shutdown closes owned Codex clients. Offline coverage includes text,
reasoning, errors, cancellation, saving and restart/resume.

The bridge does not expose complete patches, sources, tool counts or native Forge tool
exchanges; the UI states these limits without claiming Forge plugins or falling back to
native execution. A read-only check through the local Codex CLI outside the sandbox
reported authenticated and 5 available models (unavailable inside the sandbox). No live
model turn or fresh browser login was performed, so neither is claimed as verified.

**Shared validation**: Focused regression passed (11 files / 72 tests), as did
`CI=true pnpm check`, `CI=true pnpm eval:deterministic` (13 files / 71 tests), and
`CI=true pnpm package:verify` (336,873 bytes). `CI=true pnpm desktop:smoke` passed for
development and the unsigned arm64 `.app`, including real preload/main/Agent state RPC.
Application dependencies/resources are packaged and preload schemas are bundled for
sandbox compatibility. Chinese/English screenshots and fixes for initial-window identity,
panel layout and send wording are recorded in [desktop QA](../apps/desktop/design-qa.md).
No commit, release, signing or notarization was performed.

**Full acceptance (2026-09-09)**: Corrected authentication reporting to match execution:
only ChatGPT authentication enables the Codex path; signed-out/API-key accounts do not.
Status uses one client, model-list failure preserves confirmed authentication, and refresh
during login preserves signing-in. Cancelling login restores the prior state and clears
the URL; a late login/start response is cancelled without displaying/opening its URL.
Added offline signed-out/API-key, model-list failure, login success/failure, cancellation
and late-response regressions.

Live integration using existing local Codex App Server authentication passed (132.34 seconds):
create/read a scratch file; recreate the desktop service and resume the Session; edit the
file and correctly recall a marker unique to the previous turn; then cancel after turn/start
and assert turn/completed interrupted plus persisted cancelled status. Credentials were not
copied, no native fallback occurred, and Codex text was not presented as Forge tool history.
The test used the locally available default Codex model. Explicit reproduction:
`CI=true FORGE_DESKTOP_LIVE_CODEX=1 pnpm exec vitest run apps/desktop/src/agent/codex-live.test.ts`.
Sandboxed auth reported unavailable; the passing live run was outside the sandbox.
Temporary Forge sessions and files were removed.

Authentication/cancellation contracts were checked against the
[OpenAI App Server documentation](https://learn.chatgpt.com/docs/app-server).
No fresh manual browser sign-in was completed: login success/failure/cancel have offline
client coverage, while existing authentication was checked live. Live models exercise the
Agent/application path; Electron UI/IPC smoke is separate. Patch/source/tool-count limits
remain explicit and the full GUI state matrix belongs to D12.

Current focused checks: 13 files / 91 tests passed, with two live cases skipped by default
and both explicitly passed in this run. Type checking and release routing passed with
`pnpm check`; deterministic checks passed 13 files / 71 tests. Development and unsigned
arm64 packaged Electron smoke passed outside the sandbox. `pnpm package:verify` built
and checked the tarball, but the temporary install exhausted registry retries downloading
`wrap-ansi-10.0.1.tgz` with HTTP 503 / E503. This run's installed-package verification did
not pass; D06's earlier success is not reused as current evidence. `pnpm check:docs`
passed (151 files / 588 references). No commit or publication was performed.

## D09 · File operations and change review

**Deliver:** open/preview/save-as, explicit external-file copy and naming conflicts;
separate proposed edit diff and cumulative review with a baseline for ordinary folders too.
**Accept:** no attribution of pre-existing user changes; disclose comparison limits when
evidence is missing, including Codex. Export cancellation writes nothing, overwrite requires
choice, originals/references stay intact. No source-directory authorization expansion.
**Verify:** add/edit/delete/conflicts/symlink escapes/external concurrent changes and
both engine attribution. Do not copy entire projects for tracking.

**Completion record (2026-09-10, Complete):** the main process now owns a narrow,
validated file bridge for importing an explicit external-file copy, workspace-relative
preview/open/reveal, and Save as. Import conflicts require rename/replace/cancel; Save
as cancellation writes nothing and replacing a destination requires a second explicit
choice. Copies are hashed after transfer, so a concurrently changing source removes a
new destination or leaves an existing overwrite target intact. Canonical-path checks
deny traversal and symlink escapes; importing one file grants no access to its source
directory.

Each create, resume, or workspace selection records a bounded in-memory comparison
baseline (5,000 files, 16 MiB total textual baselines, 1 MiB per text file; generated
patches are separately bounded). This does not copy a project to persistent storage.
The cumulative review labels task-start, resume-time, and workspace-selection baselines
and describes all results as changes since that baseline, never as Agent authorship.
Native Forge approval diffs remain separate. Codex exposes no authoritative per-edit
patch through this bridge, so its cumulative view is explicitly baseline-only. Concurrent
user and engine edits after the baseline cannot be separated and the UI says so.
`react-diff-view` 3.3.3 renders textual cumulative patches; binary or oversized entries
remain visible with metadata and a disclosed missing content diff.

## D10 · Content reading and previews

**Deliver:** shared bounded reading interface, PDF.js pages/text, Papa Parse CSV/TSV,
text/images. Renderer has no arbitrary file access. Provide model-readable bounded
access, not only visual previews; document engine coverage separately.
**Accept:** source/page/row/error/truncation fidelity; no OCR claim for textless PDFs,
leading-zero preservation, actual computation, distinct preview/analysis scope.
DOCX/XLSX are not first-version gates.
**Verify:** Chinese/multicolumn/textless PDFs and packaged workers/fonts, quoted/multiline
CSV, TSV, malformed rows, partial views/full calculations, bounded cancellable large inputs.

**Completion record (2026-09-10, Complete):** `@forge/tools` now advertises the shared
`read_document` and `format_table` tools alongside `read_file`. PDF.js 6.3.289
extracts bounded page ranges
with page numbers and explicit textless/OCR-not-run state. Papa Parse 5.7.0 parses CSV
and TSV without dynamic typing, retains values such as `00123`, returns malformed-row
errors, distinguishes the selected preview rows from full-file parsing, and can perform
an explicit full-file numeric sum/average/minimum/maximum while reporting invalid rows.
`format_table` uses Papa Parse for quoted CSV/TSV generation and returns content to the
existing separately approved `edit_file` write path rather than bypassing write policy.
Text reads honor the existing output budget; PNG/JPEG reads return metadata and an
engine-dependent image-analysis notice. Cancellation is checked before access, after
bounded I/O, and between PDF pages; PDF and table inputs also have 32 MiB and 16 MiB
ceilings, with at most 20 pages or 500 rows returned per call.

The desktop main process calls that same reader and returns only validated preview data
for a workspace-relative file; the sandboxed renderer has no filesystem API. It displays
text, tables, images, PDF page text, and a PDF.js canvas. Vite emits the renderer worker,
and the packaged app includes PDF.js CMaps, standard fonts, and WASM data. Native Forge
models receive `read_document`; Codex keeps its own sandbox/tools, while desktop preview
is shared UI rather than fabricated Codex tool coverage. DOCX/XLSX and OCR remain out of
scope.

Focused checks passed 2 files / 16 tests, including add/edit/delete, conflict choices,
symlink escapes, concurrent-source preservation, quoted multiline CSV, malformed rows,
TSV parsing/generation, leading zeros, a calculation extending beyond the preview range, positioned
two-column PDF text, textless PDF pages, images, limits, and cancellation. A macOS
`cupsfilter` Chinese text-layer PDF extracted Chinese text successfully. Production build
emitted the PDF worker; unsigned arm64 packaging contained the CMaps/fonts/WASM resources,
and packaged Electron smoke passed. These are offline/local checks, not real-provider
proof. No commit, signing, publication, DOCX/XLSX, or OCR was performed.

## D11 · Search plugins and sourced reports

**Deliver:** existing web-tools with explicit install/enable/config, Brave/DuckDuckGo;
controlled fetching followed by Readability/jsdom, no scripts/parser networking,
basic-text fallback, provenance and Markdown reports.
**Accept:** actual service clear, auto is not failure failover, per-request approval and
TUI defaults preserved. Distinguish snippets/body/truncation/failures and link facts to
consulted sources. Verify Codex independently without fabricated source fields.
Distribution remains compatible with plugin paths/resource packaging.
**Verify:** web-tools regression plus article/list/JS-dependent/failure/redirect/limits
fixtures; authorized live checks separately from extraction and quality claims.

## D12 · End-to-end and failure acceptance

**Deliver:** three workflows and dual-engine capability/evidence matrix with gaps.
Identify the engine used per workflow; dual support does not promise total parity.
**Accept:** code review, local-file output/preview and sourced research work, both locales.
Cover crashes/cancel/missing folders/storage/network/history/conflicts/unconfigured models.
Mark unverified cells rather than using mocks as real support evidence.
**Verify:** CI=true pnpm check, CI=true pnpm eval:deterministic, focused tests and rendered UI.
Run CI=true pnpm package:verify for packaged-resource/public-artifact changes; record omissions.

## D13 · macOS installer and handoff

**Deliver:** D01 target artifacts, development/build/install instructions, actual versions/limits.
Separate desktop evidence from CLI npm verification and release pipelines.
**Accept:** installed Agent/plugins/PDF/auth/folders/exit behavior. Verify GUI-launched
PATH/proxy/FORGE_HOME instead of depending on the development shell. State OS/CPU coverage;
do not claim untested platforms.
**Verify:** local installation smoke and chosen architectures; separately record signing,
notarization, updates and publication. Without signing or publication permission, hand off
reviewable local artifacts and remaining steps without publishing or claiming release.

## Completion record per task

Update actual status with changes, commands/results, evidence paths, unverified items,
and next dependencies. Suggested states: Not started, In progress, Offline complete /
integration pending, Complete, Blocked. Only mark complete after all task acceptance;
distinguish partial implementation from environment blocks. Evidence must not contain
credentials/private files. Release evidence goes under the chosen version's evals/reports;
label development evidence separately.

## Starting prompt for the coding agent

> Read AGENTS.md, docs/DESKTOP_APP_PLAN.md and this checklist; begin D01 against current
> source. Deliver reviewable changes in dependency order, preserving user changes and
> both TUI engines. Do not reselect settled technologies. Verify offline first and report
> live providers, installers and releases separately. Bring concrete gaps and proposals
> for unresolved decisions. Do not add takeover, mandatory artifact directories or a new
> agent loop. Update actual status; documentation is not implementation.
