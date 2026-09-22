# Forge workbench follow-up development plan

Date: 2026-09-15. Development plan, not a shipped-feature declaration.

[中文（详细任务说明）](WORKBENCH_DEVELOPMENT_PLAN.zh-CN.md) · [UX specification](WORKBENCH_UX_PLAN.md) · [Visual QA](design-qa.md)

## Pending extension: unsigned updates (2026-09-22)

Without a signing certificate, use startup background checks, explicit verified DMG downloads and manual replacement. See the [update design and U01–U04 plan](UPDATE_PLAN.md). Documentation only; functionality is pending and P0–P4 historical acceptance is unchanged.

## P4 progress (2026-09-22)

W18–W20 complete within local implementation and automated acceptance scope. Management confirmations now use a centered native HTML dialog with Cancel focused initially, keyboard containment and opener focus restoration. Settings Back and model-picker Close restore focus; resource navigation focuses its destination. New approvals focus Deny. Failed, interrupted and cancelled runs retain visible feedback above the composer.

Long model names truncate with their full accessible label/title retained. At widths up to 900 px, an open workbench stacks below the conversation so it does not cover composer controls; wide windows retain the right panel. Narrow Settings wrap safely, popovers remain bounded, loading indicators are neutral and reduced-motion preferences are respected.

Fresh validation: 135 related tests passed, six opt-in live tests skipped; 71 deterministic evaluations, root check, desktop production build and documentation checks passed. Electron completed 49 captures and assertions covering bilingual themes, modal focus/centering, narrow layout, approval/completion/stop/failure and close/quit draft guards. Four scripted loopback HTTP requests exercised the real adapter/Agent/IPC and an approved `pwd` tool; they are not external-model evidence. See [P4 QA and screenshots](design-qa.md) and [capture manifest](design/p4-validation/ui.json).

P0–P4 local milestones are complete. Full TUI parity, live expired-account recovery, remote cancellation, manual assistive-technology/native-dialog checks and installed/release acceptance remain separate follow-ups. File preview is path-based, not a directory tree. No commit, installed-app replacement or publication.

## P3 progress (2026-09-21)

W14–W17 implementation and offline acceptance complete. Settings separates Forge API credentials from Codex subscription login, supports explicit provider logout, and never includes keys in DesktopState. Password input is uncontrolled, cleared on submit, and only sent to the Agent credential service. Environment credentials retain precedence. Codex login cancellation/failure and failed logout retain truthful status; account refresh clears stale model metadata.

Configured model removal requires confirmation and reuses the existing user-config writer. The selected default is protected until another default is saved; project/built-in definitions are not removed. A removed temporary task selection is cleared. Resource discovery/trust was moved into the shared application package with a CLI compatibility export. Settings lists installed/enabled plugins and read-only Skill diagnostics, supports explicit user-plugin toggles and project trust, and retains separate bundled Web installation/configuration. Discovery never grants execution authority.

Management slash commands navigate to their relevant settings section. /exit is available during runs and uses the normal window close path. All unsent drafts and active work trigger a keep-working/exit choice, including native window close and application quit; Agent shutdown retains its bounded cancellation/kill fallback. Remote cancellation is not asserted merely because a local process exits.

Validation: 135 related tests passed; six opt-in live tests skipped. Root check, production build, 71 deterministic evaluations, packed CLI install and documentation checks passed. Electron completed 34 captures with resource navigation and beforeunload protection assertions. See [P3 compatibility and QA](design-qa.md). No commit, installed desktop replacement or publication.

Next is P4 (W18–W20), visual/accessibility and delivery acceptance. Full TUI parity is not claimed: new provider route setup and non-bundled plugin installation still use CLI; macOS dialog interaction and live expired-account refresh remain outside offline proof.

## P2 progress (2026-09-21)

W08–W13 complete. New and clear reset the active conversation while retaining saved history. Desktop approvals are allow-once and no reusable session grants are stored, so both commands leave an empty grant list; the permissions view explains this instead of offering a fictitious revoke action. The composer policy controls the next run.

Compact now executes dry-run and real compaction through the session service, returns results, and rejects revision conflicts. Dry-run leaves snapshots unchanged; compaction preserves canonical messages. The context ring and /context share details, refresh time and estimate provenance; unavailable Codex usage remains unknown.

The searchable model picker uses shared native/configured metadata and Codex discovery, validates model/effort combinations, and distinguishes temporary task selection from explicit default saving. /effort with an argument saves the default, matching TUI behavior. Built-in entries were consolidated from existing code, not independently verified as live provider capabilities. History search matches title and workspace; resume retains the canonical workspace boundary and clears transient state only after success.

Validation: 118 related tests passed, six opt-in live tests skipped; 27 Agent/Codex tests passed again after the final default-selection guard. Root check, desktop build, 71 deterministic evaluations and packed-install verification passed. Electron completed 32 captures with model, context and permissions checks. See [QA](design-qa.md). No live-provider proof, installed-app update, commit or release is claimed.

Next is P3 (W14–W17): management commands and Settings. Login/logout, model deletion, plugins/resources and platform exit handling still require their own acceptance; full sixteen-command parity is not claimed.

## P1 progress (2026-09-20)

W04–W07 complete. The sixteen-entry registry and argument parser now live in private `@forge/application/slash-commands`. CLI retains compatibility exports and uses the parser; desktop help/menu share the catalog with platform-specific availability labels.

Command spelling follows TUI case rules; effort values are case insensitive. Parsing/completion supports `/compact --dry-run` and `/effort <level>`; desktop execution remains P2 and explicitly returns unsupported without calling a model. Routing returns structured open/read/manage/error/not-applicable outcomes.

The menu has combobox/listbox relationships, option IDs, visible selection, Tab/Enter/Esc and IME protection. Invalid commands retain drafts and offer an explicit send-as-message action, never automatic fallback. An immediate pending lock prevents duplicate management submissions; completion preserves drafts edited while awaiting results. Help/context remain available during runs; mutations return busy, with Agent enforcement covered by a new regression test.

Validation: 112 related tests passed, six opt-in live tests skipped; root check, desktop build, 71 deterministic evaluations and packed-install verification passed. Electron completed 29 captures and added keyboard, completion, error and IME assertions. See [QA](design-qa.md). No commit or release.

Next is P2 (W08–W13). New/clear authorization semantics, actual compact dry-run, context details, grant revocation, model/effort management and searchable resume are still pending; parsing success does not imply execution parity.


## Progress (2026-09-20)

P0 (W01–W03) is complete. The starting worktree was clean. Root `pnpm check` now passes; the old prototype formatting blocker is gone, with non-blocking lint diagnostics remaining. Extracted WorkspaceHeader, ComposerControls, ModelSelector, SlashCommandMenu and SettingsView; retained orchestration in LiveWorkbench and moved workspace switching into a callback. Consolidated duplicate v2 CSS without changing command semantics or IPC.

Validation: 60 desktop tests passed, 6 opt-in live tests skipped; type checks, release routing checks and desktop build passed. Electron completed 29 captures plus new cross-session draft isolation and engine/default-policy callback assertions. 25 captures are pixel-identical; four Settings captures differ only in the temporary Forge home suffix. See [QA](design-qa.md). No commit or release.

Next: P1 (W04–W07), shared command registry/parser, structured results, keyboard/argument interaction and running-state availability. Full TUI parity is not claimed.


## Scope and baseline

Continue the approved monochrome anvil design. The initial task wrote the plan; subsequent implementation is tracked above. Preserve existing uncommitted changes, reference images and historical QA. Reference screens are in `design/reference/`; actual implementation captures are in `design/implementation-v2/`.

Current source has the relocated workspace picker, in-sidebar collapse control, composer engine/model labels, permission selection, context ring and Settings-only themes. The command menu has a separate desktop registry and rejects all arguments. Login/plugins open existing Settings; permissions focuses the policy selector. These are partial integrations, not full management parity. Resources/logout/delete-model/effort remain disconnected; update-dismiss is not applicable. New/clear currently share backend reset; the native model field is an input/datalist. LiveWorkbench and appended CSS still need separation and cleanup.

Source checkpoints: renderer `live-workbench.tsx`, `composer-context.tsx`, `slash-commands.ts`; shared protocols; Agent `application.ts`; CLI `apps/cli/src/commands.ts` and its actual handlers. Source/tests outrank old plans.

## Ordered milestones

Execute P0 → P1 → P2 → P3 → P4. W identifiers are handoff tasks, not replacements for existing D milestones. Each stage delivers a runnable result, validation evidence, and explicit remaining gaps.

### P0 — Stable baseline and component structure

- W01: Inspect current changes and rerun root checks. The previous root check encountered separate design/prototype formatting failures; reverify rather than treating that result as permanent. Address formatting or justified check scope separately, without disabling production rules.
- W02: Extract WorkspaceHeader, ComposerControls, ModelSelector, SlashCommandMenu and SettingsView; separate routing from JSX while retaining event, approval, cancellation and preview interfaces.
- W03: Consolidate v2 CSS and remove superseded overrides without a broad style rewrite.

Gate: no unintended same-fixture visual changes; task switching, drafts, theme persistence and panel controls pass relevant tests and type checks. Report root failures separately from focused success.

### P1 — Shared commands and reliable input

- W04: Create a private shared command descriptor/parser without React, Ink or Electron dependencies. Derive argument rules from TUI handlers; retain CLI compatibility exports.
- W05: Use structured outcomes for opening UI, success, errors and platform applicability. Share the registry between menu, help and TUI; keep authorization out of static metadata.
- W06: Complete combobox/listbox semantics, visible keyboard selection, focus restoration, IME handling and argument completion. Preserve invalid drafts; explicitly offer sending slash-prefixed ordinary text as a message, never automatic fallback.
- W07: Allow appropriate read-only commands while running; validate mutations again in the Agent. Prevent duplicate pending submissions and retain failed drafts.

Gate: all 16 names agree; valid/invalid arguments, case, paths, URLs and code are covered. Command failures never invoke a model. Keyboard navigation reaches items outside the menu viewport.

### P2 — Sessions, permissions and models

- W08: Verify distinct TUI new/clear context, history and authorization semantics. Do not add grants merely for visual parity. Test backend reset survives state refresh and saved history remains resumable.
- W09: Support compact arguments and dry-run with structured results, locks and revision conflicts. Dry-run writes no snapshot/checkpoint.
- W10: Unify context details, estimate source, budget, freshness and unknown state. Never substitute Forge wrapper estimates for unavailable Codex telemetry.
- W11: Separate policy selection from inspecting/revoking actual session grants. Preserve native safe versus Codex read-only semantics; workspace-write must not bypass other required approvals.
- W12: Add searchable model selection with current/loading/empty/error/retry states. Distinguish task overrides from persisted defaults; derive and validate effort from engine/model capabilities. Engine changes cannot silently retain invalid choices.
- W13: Add searchable resume, workspace boundary and failure feedback; reset transient previews/run state and relevant grants while preserving task-specific drafts.

Gate: validate both engines independently, invalid policy/model/effort rejection, configuration persistence, dry-run no-write and conflict behavior. Live-provider evidence is separate from fixtures.

### P3 — Management and Settings

- W14: Target an explicit engine/provider for login/logout through existing authentication services; handle cancellation, expiry and failure. Keep credentials out of renderer state and isolate engine accounts.
- W15: Confirm an explicit model before deletion; reuse configuration write rules and explain active/default model handling. Failure preserves configuration.
- W16: Distinguish plugin discovery, installation, enabling and configuration. Web settings are only a subset. Resources expose read-only Skills/resource diagnostics; discovery does not authorize execution. Preserve explicit enablement and network approval boundaries.
- W17: Use normal Electron shutdown for exit, including active runs, cancellation timeout and drafts. Return not-applicable for update-dismiss without a matching desktop update notice.

Gate: record verified/partial/not-applicable/pending for every command with test or manual evidence. Opening Settings alone does not satisfy management parity.

### P4 — Visual, accessibility and handoff checks

- W18: Compare each reference for spacing, typography, message width, borders, menu density and branding. Check composer wrapping with the right panel, long models, empty history, loading/error/approval states. Track the real path-preview versus reference file-tree gap independently; any tree must use main-process boundaries, lazy loading and bounded enumeration.
- W19: Cover English/Chinese and light/dark, plus system theme, collapsed sidebar, open right panel, Settings, empty conversation, commands, running and errors. Check 1100×728 and 840 px narrow layouts, overflow, visible focus and keyboard completion.
- W20: Update bilingual documentation and QA while preserving reference images and historical evidence. Clearly separate mockups from actual captures.

Gate: complete workspace → engine/model/policy → run → approve/stop → results → new/resume workflow; deliver traceable screenshots, tests and remaining limitations.

## Validation and delivery

- TypeScript/workflows: focused Vitest, `CI=true pnpm check`, desktop build.
- Cross-layer protocol/session/policy: additionally `CI=true pnpm eval:deterministic`, with renderer/main/Agent boundary tests.
- Markdown/index changes: `CI=true pnpm check:docs`.
- UI: build and run Electron acceptance, then inspect captures rather than relying only on exit status.
- Packaged resources/public artifacts: `CI=true pnpm package:verify`; installer verification is separate.

Each stage supplies change summary, relevant tests, screenshots for visual changes, command matrix updates and unresolved issues. Previous counts (15 focused tests, 71 evaluations, 29 captures) are historical evidence, not results for future changes.

Commits/merges, replacing the installed App, signing, notarization, publication and new /plan or /goal modes are not automatic parts of this plan. Release requests need a separate release checklist.

P0–P4 local development and automated acceptance are complete. Scope live-service, manual accessibility or installed/release acceptance separately; none is implied by this local result. Earlier progress entries retain their historical stage status.
