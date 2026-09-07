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
| D04 | Shared application services | D01 | Not started |
| D05 | Agent process and protocol | D02, D04 | Not started |
| D06 | Workspaces and sessions | D03, D05 | Not started |
| D07 | Native Forge execution | D06 | Not started |
| D08 | Codex execution and authentication | D06 | Not started |
| D09 | File operations and change review | D07, D08 | Not started |
| D10 | Content reading and previews | D09 | Not started |
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

## D05 · Agent process and protocol

**Deliver:** main-owned lifecycle and validated typed requests/events/approvals/cancel,
request/Session/Run IDs, sequence, subscription, completion/disconnection and stale
message rules. Bridge cancellation via messages, not serialized AbortSignal objects.
**Accept:** no cross-task events, reject invalid operations, narrow bridge, no renderer
credentials. Crashes release waiting UI without replaying effects; no process/listener leaks.
**Verify:** offline ordering/duplicate/late events, approval cancellation, disconnects
and termination. Do not describe process isolation as a sandbox.

## D06 · Workspaces and sessions

**Deliver:** folder selection, shared cwd/root semantics, automatic
$FORGE_HOME/workspaces/<id>/ on valid submission, Session-backed tasks and drafts.
Reuse JSON/JSONL, expose effective home, add minimal conflict/busy rejection without takeover.
**Accept:** Git subfolder/ordinary folder correctness; no restored authority or expanded
boundary. Missing/corrupt directories/history, overrides, writes and conflicts report
errors while preserving snapshots. No full Forge-home access or mandatory task.json/input/output layout.
**Verify:** config/workspace/persistence regressions and temporary-directory restart/conflict tests.

## D07 · Native Forge execution

**Deliver:** real submission, streaming, activity, approval/cancel, persistence/context display.
**Accept:** two turns, real read/edit/command execution; denied actions do not execute,
no new actions after cancellation, stopping until confirmed. Recover complete exchanges,
distinguish completion from verification, preserve TUI behavior.
**Verify:** fake-adapter end-to-end first, then authorized configured live-provider smoke;
record separately and finish independent offline work when credentials are unavailable.

## D08 · Codex execution and authentication

**Deliver:** existing Codex execution/auth in the workbench, engine/model identity,
setup/unavailable errors, no credential copying or silent native fallback.
**Accept:** separately verify startup/auth/output/errors/cancel/history. Do not advertise
Forge plugins as Codex tools or infer complete approvals/sources from exit-code success.
Identify and address bridge gaps or label limits. No active-run engine switch; continuation
follows D01 decisions.
**Verify:** current transport/CLI offline checks separately from authorized local integration.

## D09 · File operations and change review

**Deliver:** open/preview/save-as, explicit external-file copy and naming conflicts;
separate proposed edit diff and cumulative review with a baseline for ordinary folders too.
**Accept:** no attribution of pre-existing user changes; disclose comparison limits when
evidence is missing, including Codex. Export cancellation writes nothing, overwrite requires
choice, originals/references stay intact. No source-directory authorization expansion.
**Verify:** add/edit/delete/conflicts/symlink escapes/external concurrent changes and
both engine attribution. Do not copy entire projects for tracking.

## D10 · Content reading and previews

**Deliver:** shared bounded reading interface, PDF.js pages/text, Papa Parse CSV/TSV,
text/images. Renderer has no arbitrary file access. Provide model-readable bounded
access, not only visual previews; document engine coverage separately.
**Accept:** source/page/row/error/truncation fidelity; no OCR claim for textless PDFs,
leading-zero preservation, actual computation, distinct preview/analysis scope.
DOCX/XLSX are not first-version gates.
**Verify:** Chinese/multicolumn/textless PDFs and packaged workers/fonts, quoted/multiline
CSV, TSV, malformed rows, partial views/full calculations, bounded cancellable large inputs.

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
