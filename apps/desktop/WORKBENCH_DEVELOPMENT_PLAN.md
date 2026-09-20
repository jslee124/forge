# Forge workbench follow-up development plan

Date: 2026-09-15. Development plan, not a shipped-feature declaration.

[中文（详细任务说明）](WORKBENCH_DEVELOPMENT_PLAN.zh-CN.md) · [UX specification](WORKBENCH_UX_PLAN.md) · [Visual QA](design-qa.md)

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

P1 is complete. Continue with P2 (W08–W13), covering sessions, permissions and models. Require working behavior at each gate rather than more entry points or static screenshots.
