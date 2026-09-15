# Workbench layout and slash-command plan

See the [follow-up development plan](WORKBENCH_DEVELOPMENT_PLAN.md) for ordered tasks and acceptance gates.

Status: implementation approved; workbench layout and initial command integrations implemented. Full command parity remains pending. 2026-09-15.

This is the next proposed iteration after the monochrome/anvil refresh, not a
statement of shipped behavior. The detailed review specification is the
[Chinese design and implementation plan](WORKBENCH_UX_PLAN.zh-CN.md).

## Visual source of truth

Both comparison boards are stored in the repository and embedded here.

### Original reference

![Original light workbench and dark command menu](design/reference/workbench-v2-original.png)

### Revised visual target

![Revised light workbench and dark command menu](design/reference/workbench-v2-revised.png)

Only three changes are intended: move collapse inside the sidebar; add current
permissions beside plus; add Engine/Model labels and a context ring before Engine.
Preserve message bubbles, circular anvil avatar, tool cards, navigation icons,
selection, bordered controls, corner radii, spacing and tonal hierarchy. Retain the
separate workbench toggle at the top right.

The earlier simplified Figma file is a structural draft, **not the visual acceptance
reference**. Future Figma refinement and implementation must match the revised
board, rather than discarding existing design detail. The 24% usage and permission
label are illustrative states, not shipped behavior. Explicit text specifications
take precedence over incidental image-generation lettering errors.

## Design

Remove the `FORGE / workspace / Ready` renderer banner and its reserved height.
Use one compact header for the workspace directory, available task
title, and workbench toggle. Keep native window controls and dragging intact.
Workspace selection reuses the existing native chooser; cancelling changes nothing.
Lock directory changes during runs and invalidate artifact views after a switch.

Move engine/model controls into the composer footer, beside the send/stop control.
Use searchable selectors with accessible labels, loading/error/empty states and
separate Native/Codex data. Preserve drafts on engine changes and reset incompatible
model/effort selections. Effort options must come from actual model capabilities.
The existing import-copy action moves to the composer plus menu. Ordinary Enter
inserts a newline; Command/Ctrl+Enter submits outside IME composition.

Appearance lives only in Settings: Light, Dark and System retain persistence and
live system tracking. Settings remains reachable when the sidebar is collapsed.
Keep monochrome tokens and semantic warning/error/diff colors. At narrow widths,
truncate long names and wrap controls without hiding send/stop or causing overflow.

The user's Codex screenshot provides layout reference. ZCode was inspected locally:
typing `/` in an empty composer showed an upward command/skill list. The character
was removed without sending a message or executing a command. These are interaction
references, not a request to copy their full feature sets.

## Command behavior and compatibility

A leading slash opens a searchable list above the composer; slashes inside prose,
URLs or code do not. Arrow keys select, Tab completes, Enter chooses, Escape closes.
Argument-taking commands open their selector or keep argument entry active. IME
composition must not submit. Unknown commands and invalid arguments remain local,
preserve the draft and never reach the model. Provide an explicit send-as-message
escape for ordinary text beginning with `/`. Successful commands clear their input;
failed commands retain it. Local results are not assistant responses or implicitly
added model context.

The current TUI has 16 commands:

| Command | Desktop target and constraint |
| --- | --- |
| `/help` | Searchable help with actual availability |
| `/new` | Reset backend session and session permission grants; retain saved history |
| `/clear` | Reset context without conflating TUI's distinct permission behavior |
| `/context` | Real context/checkpoint state panel |
| `/permissions` | Inspect and revoke actual session grants |
| `/update-dismiss` | Dismiss the advertised version; explain when not applicable |
| `/compact` | Safe checkpoint, including existing `--dry-run` syntax and conflict checks |
| `/plugins` | Full project plugin management, beyond today's web-plugin subset |
| `/resources` | Skills and resource diagnostics, without granting execution authority |
| `/login` | Provider/engine selection and matching authentication flow |
| `/logout` | Sign out the selected provider without affecting the other engine |
| `/model` | Same selector and state as the composer control |
| `/delete-model` | Select and confirm deletion through the configuration service |
| `/effort` | Validate model-supported levels, including existing argument syntax |
| `/resume` | Workspace-scoped search/resume with boundary and transient-state checks |
| `/exit` | Normal Electron close lifecycle, respecting active-run handling |

Do not label opening Settings as completed authentication or full plugin support.
Unconnected commands must be explicitly marked; do not claim full compatibility
until every row is implemented or documented as platform-inapplicable. Read-only
commands may remain available during runs; mutations require service-side activity
checks. Skills in the menu are a later enhancement, not a prerequisite. Do not add
unsupported `/plan` or `/goal` modes simply because references contain them.

## Implementation

The authoritative sources are `src/renderer/src/live-workbench.tsx`,
`src/shared/application-protocol.ts`, `src/shared/run-protocol.ts`,
`src/agent/application.ts`, and the CLI's `commands.ts` and `interactive/app.tsx`.

Extract a framework-neutral command catalog/parser into the private application
layer, keeping CLI re-exports compatible. Extract shared management services rather
than importing Ink components into the renderer. Split the renderer into workspace
header, composer controls and command menu. Route commands into local UI actions,
validated management requests or explanatory errors; ordinary prompts use a separate
execution path.

Extend typed DTOs and validation across preload, main, Agent and renderer together.
Filesystem/configuration/credentials stay outside the renderer. Reuse session locks,
revision checks, policy, plugin trust and persistence. Resetting only frontend
sessionId is insufficient: a later state refresh could restore the old backend
session. Preserve TUI persistence semantics and distinguish temporary run overrides
from saved defaults.

Implement in order: A layout; B catalog/menu plus help/new/clear/context/compact/model/
resume and backend reset; C remaining management capabilities; D platform-specific
commands, accessibility, localization and regression QA. These are implementation
stages, not permission to claim complete compatibility after stage B.

## Acceptance

Test catalog parity, arguments, unknown commands, ordinary slash-containing content,
and prevention of model dispatch. Test IME, keyboard navigation, focus restoration,
scrolling selection, duplicate submissions, error drafts and task isolation. Cover
new/clear permission differences, backend reset, resume boundaries, dry-run no-write
behavior and revision conflicts. Verify engine authentication isolation, supported
effort levels, plugin trust and real grant revocation.

Inspect English/Chinese, light/dark, home/conversation/settings/menu, expanded and
collapsed sidebars, plus 840 px windows and long model names. Verify banner removal,
workspace cancellation, composer selectors, settings-only appearance and visible
send/stop controls. Run focused Vitest, repository checks, documentation checks,
desktop build and offline Electron acceptance. Add deterministic evaluations for
cross-layer runtime contracts and package verification when packaged resources
change. Report live-provider and installer evidence separately.

No implementation starts until the user approves the plan. This delivery changes
planning documents only and does not create a Git commit.

## Revision: sidebar and composer controls (2026-09-15)

This revision overrides earlier control placement. The collapse button sits inside
the sidebar at its upper-right corner, aligned with branding. When collapsed, a
square anvil restore control appears at the main header's left edge.

Composer footer order: plus, current permission selector, flexible space, context
usage ring, “Engine” label and selector, “Model” label and selector, send. Labels
remain visible; wrap at narrow widths. Permission text reflects actual policy,
not ZCode's automatic-edit default. The mock uses “Approval on request”; policy
changes and grant revocation retain existing authorization rules.

The ring shows used context proportion, exposes used/total/remaining on hover or
focus, and opens context details on click. Unknown usage is neutral and explicitly
unavailable, never a fabricated zero. Mock percentages are illustrative only.
Deliver editable Figma workbench and command-menu references; no code implementation
or shipped-feature claim is included.

Figma: [Forge — Workbench UX v2](https://www.figma.com/design/sk9IZlKqoRF8PEpAJ3gR8b).

## Additional scenario references

These four visual references extend the revised design; they are not implemented screenshots. Written behavior and actual state take precedence over sample data or image-generation discrepancies.

### Collapsed sidebar

![Collapsed sidebar](design/reference/workbench-v2-sidebar-collapsed.png)

Hide task navigation completely; restore it with the square anvil. Keep conversation and composer centered.

### Open workbench

![Open workbench](design/reference/workbench-v2-workbench-open.png)

Files, Changes and Activity share a closable right panel. The composer stays within the conversation column. Implementation must keep tree selection and preview title consistent; pictured paths, code and conversation are illustrative.

### Settings

![Settings](design/reference/workbench-v2-settings.png)

Settings groups appearance, language and connections, hides the composer/workbench and offers return to conversation. The web toggle does not replace installation/configuration; availability follows actual plugin state.

### Empty new task

![Empty new task](design/reference/workbench-v2-empty.png)

Keep the anvil, introduction and three suggestions, which populate drafts only. Unknown context uses a neutral ring and dash. Before workspace selection, show the chooser instead of the illustrative forge directory.

## Implementation record (2026-09-15)

Implemented the banner removal, in-sidebar collapse control and collapsed anvil restore button, top workspace picker, labeled engine/model controls inside the composer, permission selector, context ring, Settings-only themes, empty state, message layout, and connection cards. Existing real file, preview, change, and activity panels remain connected.

The validated run protocol accepts only safe / workspace-write. Forge defaults to approval-based access; Codex safe means read-only. The ring uses Forge transcript budget estimates, excluding drafts; unavailable Codex usage displays a dash.

The slash menu supports filtering, arrows, Tab, Enter, Esc, and IME protection. Connected entries: /help, /new, /clear, /context, /compact, /model, /permissions, /resume, /login, /plugins, /exit. Login/plugins open existing Settings; resume opens saved tasks. New/clear both reset in-memory context while retaining saved history; desktop has no cross-run approval cache.

Pending: command arguments, a shared TUI command registry, /resources, /logout, /delete-model, /effort, /update-dismiss, and complete searchable model management. Unsupported commands are explicitly reported and never sent to a model. The preceding specification remains the target rather than a claim of full implementation.

Validation: 15 focused tests, production build, and TypeScript checks passed. Actual Electron checks cover locales, themes, panels, home, Settings, and slash entry; see [visual QA](design-qa.md). Root pnpm check is blocked by existing design/prototype formatting errors; modified files pass focused checks. No commit, release, or paid-provider verification.
