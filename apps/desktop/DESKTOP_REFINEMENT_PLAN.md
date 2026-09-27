# Forge Desktop model and workbench interaction refinement plan

Original plan: 2026-09-25. macOS sidebar decision: 2026-09-26. Status: **design and local implementation record**. The original source descriptions are dated snapshots; the implementation status below reflects current source and local checks, not behavior shipped in Preview 3.

[简体中文](DESKTOP_REFINEMENT_PLAN.zh-CN.md) · [Workbench development plan](WORKBENCH_DEVELOPMENT_PLAN.md) · [Current desktop guide](../../docs/DESKTOP.md)

## Visual references (generated concepts)

![Settings sections and model access reference](design/refinement-2026-09-25/settings-reference.png)

![Workbench, model picker, and macOS window top reference](design/refinement-2026-09-25/workbench-model-reference.png)

![Earlier collapsed macOS sidebar concept, superseded by the 2026-09-26 decision](design/refinement-2026-09-25/workbench-collapsed-macos-reference.png)

**Selected macOS sidebar direction (2026-09-26):** expanded on the left, fully collapsed on the right. This replaces the earlier narrow-rail concept; it is a generated design preview, not an application capture.

![Selected macOS sidebar direction with the sidebar fully hidden when collapsed](design/refinement-2026-09-26/macos-sidebar-hidden-reference.png)

These images establish a visual direction and layout hierarchy. They are not screenshots of implemented behavior or runnable prototypes. Example statuses, helper copy, task names, and button details must yield to this plan's interaction requirements and the current source. Check Windows layout, keyboard behavior, and narrow windows separately before implementation.

## Goal and 2026-09-25 baseline evidence

In the installed Preview 3, the user sees old DeepSeek models, a heavily outlined model picker that cannot close by clicking outside, a default Electron app icon, a full-width native title bar, a rough long-form Settings page, and a task sidebar that cannot be resized by dragging. This plan is grounded in the `dev` source and the user's workbench and Settings screenshots on 2026-09-25. The screenshots establish the appearance of that installation, not behavior on every platform.

| Area | 2026-09-25 source snapshot | Target |
| --- | --- | --- |
| Models | `packages/application/src/model-catalog.ts` lists three old DeepSeek IDs; `packages/config/src/schema.ts`, `loader.ts`, and `packages/model-deepseek/src/config.ts` default to old Flash; the adapter accepts images only for old Vision Exp and knows context limits only for old IDs | Make `deepseek-flash` the new choice and default while retaining old configurations and sessions |
| Picker | `apps/desktop/src/renderer/src/model-selector.tsx` closes only via buttons or Escape; `studio.css` outlines the popover and every row | Reduce visual borders; close on selection, outside click, or Escape while preserving keyboard and focus behavior |
| Icon | `forge-mark.svg` is the in-app anvil; `electron-builder.yml` specifies only a Windows `build/icon.ico`, with no macOS app icon | Package platform icons derived from one anvil design |
| Window | `src/main/index.ts` uses the default `BrowserWindow` title bar; the real workbench has a separate sidebar brand row in `live-workbench.tsx` | Integrate native macOS traffic lights into the workbench top; retain Windows system controls |
| Settings | `settings-view.tsx` renders updates, appearance, language, credentials, models, plugins, web research, and Codex in sequence; `management-settings.tsx` repeats cards and long descriptions; `studio.css` limits the content to a narrow column | Clear navigation, grouped status and actions, short primary copy, expandable detail |
| Task sidebar | `studio.css` fixes grid and sidebar widths and changes them to 224/190/160 px by breakpoint; `live-workbench.tsx` only tracks dragging for the right panel | Drag and keyboard resize, collapse, and remember expanded width |

DeepSeek's [2026-09-10 change log](https://api-docs.deepseek.com/updates/) and [models and pricing](https://api-docs.deepseek.com/quick_start/pricing/) say that V4.1 Flash uses `deepseek-flash` and supports vision; old `deepseek-v4-flash` and `deepseek-v4-flash-vision-exp` temporarily route to it; `deepseek-v4-pro` remains available and does not support vision. Recheck official documentation during implementation because capabilities and alias lifetimes can change. Electron's [custom title bar guide](https://www.electronjs.org/docs/latest/tutorial/custom-title-bar) documents `hiddenInset` with native macOS traffic lights and separate Windows controls. electron-builder [v26 macOS configuration](https://www.electron.build/v26/docs/mac/) supports `.icns` app icons.

## R1: Model catalog and runtime compatibility

1. The recommended built-in list should show **DeepSeek V4.1 Flash** (`deepseek-flash`) and the still available **DeepSeek V4 Pro** (`deepseek-v4-pro`). Do not present old Flash and Vision Exp as two distinct current models. Existing old IDs must still parse, run, and be identified as compatibility aliases. Do not silently rewrite saved defaults or historical tasks.
2. New installations and configurations without an explicit model should use `deepseek-flash`. Align config defaults, environment fallback, CLI, desktop catalog, adapter context metadata, and documentation examples so the display and actual request agree. Keep explicit old configurations unchanged until a user deliberately selects or saves the new model.
3. Before allowing image input for `deepseek-flash`, verify that the current `@ai-sdk/deepseek` Chat Completions transport correctly encodes images, tool turns, and continuation. The official [vision guide](https://api-docs.deepseek.com/guides/vision/) also documents a Responses API path. If the current transport falls short, complete and verify the adapter route rather than only widening an ID check. V4 Pro must continue to reject images.
4. Update context window, output limit, and reasoning effort metadata using current official parameters. The catalog may identify old IDs as compatibility aliases, but must not display a temporary provider alias as a separate new model. Keep Codex discovery and user-configured routes on their existing data sources.
5. Run protocol/configuration tests without paid API calls first. Record live DeepSeek text, image, and tool-call validation as a distinct, explicit test step if performed. Offline checks are not live-provider proof.

## R2: Model picker appearance and behavior

Use one clear popover instead of nested input, button, and model-card outlines: search and refresh at the top; a compact scrollable list with the model name as primary text and provider/ID as secondary text; low-contrast background plus a checkmark for the selected row. Hover changes only the background. Keep a border around the popover and use separators only between meaningful regions. Put reasoning effort, the task-only selection explanation, and explicit “Save as default” action in a distinct footer with clear save feedback.

- Clicking a model row updates this task's selection and closes the popover, returning focus to its trigger. Reopen it to change reasoning effort or save a default; selecting alone never writes global configuration.
- Clicking outside both the popover and trigger closes it without changing the selection. Escape does the same and restores focus. Clicking the trigger toggles cleanly, without a close-then-reopen race.
- Clicking search, rows, refresh, effort, or save inside the popover must not be mistaken for an outside click. Async refresh must not reopen a closed popover; engine/task changes clear search and transient feedback.
- Preserve a complete keyboard path, visible focus, accessible names, busy/error/empty states, and full accessible text for truncated long model names. Check light/dark themes, English/Chinese, and narrow windows without covering the composer or Send button.
- Check whether the current `role="dialog"` needs modal focus behavior or should become a nonmodal popover role. Do not leave an inaccurate accessibility contract after changing dismissal behavior.

## R3: Anvil application icon

Use the existing `forge-mark.svg` anvil contour as the single brand source. First prepare a square app-icon design that remains distinct on light and dark Dock/taskbar backgrounds, with adequate padding and contrast at 16, 32, 128, 512, and 1024 px. Once the design is approved, generate macOS `.icns` and Windows `.ico` and explicitly set both in `electron-builder.yml`. Inspect `CFBundleIconFile`, Finder, Dock, and app switcher on macOS, plus installer, Start menu, taskbar, and window icon on Windows. Review the current Windows `icon.ico` visually; its existence does not prove it carries the right design.

Icon resources and application signing are separate concerns. Preview 3 has no Developer ID signature or notarization; an icon update does not resolve Gatekeeper rejection. A future release needs independent signing, notarization, and downloaded-install validation.

## R4: Platform-specific window top

**macOS:** Keep Electron `titleBarStyle: "hiddenInset"` and its native traffic lights rather than drawing fake buttons. In the selected expanded layout, traffic lights, the sidebar toggle, the workspace selector, and the Workbench button align on one horizontal line; the Forge wordmark remains below in the sidebar. Keep the top surface visually continuous without a separate full-width title bar. Empty top regions must be draggable, interactive controls must not be. Preserve expected full-screen, zoom, title-region double-click, light/dark, and narrow-window behavior. Inspect actual macOS window screenshots before deciding whether `trafficLightPosition` needs adjustment.

**Collapsed macOS sidebar (selected direction):** Hide the sidebar completely: no narrow rail, anvil mark, task list, bottom Settings icon, or resize handle remains. The main area uses the released width. Keep the native traffic lights at fixed window coordinates. On their horizontal line, place a keyboard-focusable Expand Sidebar button, workspace selector, and New Task icon from left to right with safe gaps; put Workbench and Settings at the far right. Do not add a separate full-width title bar or divider. Reopening restores the last expanded width. In system full screen, let macOS govern traffic-light visibility rather than drawing replacements.

**Windows:** Retain the native title bar and system minimize/maximize/close controls in this pass; harmonize its color and brand icon with the content. Do not apply macOS left-side safe spacing on Windows. A later unified custom bar would require separate design and acceptance for Windows controls overlay, system menu, dragging, resizing, and accessibility before adopting `titleBarOverlay`.

Keep platform differences in main-process window options and a minimal trusted platform layout signal. Share the rest of the renderer. Do not add general window-management IPC callable by page content just for the title bar.

## R5: Settings redesign

The current Settings page remains a long column capped at `max-width: 780px` on a wide window. In the user screenshot, repeated borders and large gaps surround theme cards, the language row, connection card, and credential card. Important configured status, override precedence, and destructive actions are mixed into paragraphs. Keep the black-and-white anvil design, but give **finding a setting, reading its status, and acting on it** distinct levels.

```text
┌ Settings title / Back to conversation ────────────────────┐
│ General          │ Appearance                             │
│ Models & access  │ Theme: Light  Dark  System             │
│ Extensions       │ Language: English                      │
│ Version & update │                                        │
│                  │ Status, setting rows, and actions       │
└──────────────────┴────────────────────────────────────────┘
```

- Provide always-visible section navigation inside the main area: **General** (appearance, language), **Models & access** (Forge home, API credentials, configured models, Codex), **Extensions** (project plugins, Skill diagnostics, web research), and **Version & updates**. The global task sidebar still navigates tasks; the new section navigation belongs only to Settings. Direct entry from `/login`, `/models`, and similar routes scrolls to and focuses the right section.
- On wide windows, use a section rail and a roughly 640–760 px content column with the page title and Back control fixed at the top. On narrow windows, turn section navigation into horizontally scrollable tabs or a native select and use a single content column; do not squeeze in a second permanent narrow rail beside the task sidebar.
- Show current status first in each section, then editable settings, then management actions. Limit each section to one outer surface; distinguish setting rows using spacing or a light divider rather than wrapping every explanation and button in a large card. Long paths, model IDs, and plugin provenance may wrap or be copied without widening the page.
- Shorten primary copy to what the setting does, what its current value is, and what changing it affects. Keep critical boundaries—environment credentials taking precedence, saving a key without connection validation, project trust versus network approval, and unsigned update packages—next to the relevant row or in expandable details.
- Credential status should clearly say “environment variable / stored locally / not configured.” Password fields remain unfilled and masked; save/remove feedback appears beside its row. Credential deletion, model deletion, project trust, and Codex sign-out retain their existing confirmations. Ordinary theme, language, and update-channel changes add no new confirmation.
- Keep current version, channel, last check, Check button, and download/manual installation instructions together. A failed check must not look like “up to date.” Web research keeps installation distinct from enablement and shows the actual provider and key status. Visual restructuring must preserve these existing semantics.
- Use semantic headings, current-nav indication, form labels, nearby status/errors, and focus targets for keyboard access. Navigating sections or returning to conversation must retain drafts, sessions, and temporary model choices. Check English/Chinese, light/dark, long paths, empty lists, errors, loading, and the 720 px minimum window.

## R6: Resizable task sidebar

Use one grid-column width state as the layout source, removing conflicting fixed widths on `.app-frame` and `.sidebar`. The expanded sidebar defaults to about 224 px; dragging its boundary updates it live, clamped to about 160–360 px while leaving at least about 520 px for the main area. Shrinking the window temporarily clamps the displayed width without overwriting the saved preference; expanding it restores that preference. On macOS the selected collapsed state has no sidebar column; the native traffic-light hit area is accounted for by the main content's top controls. Windows retains its native title bar; its collapsed layout needs separate review rather than inheriting macOS spacing. Reopening restores the last expanded width.

- Put a subtle visual affordance and a generous hit target at the sidebar's right edge. Start dragging only from this handle, without stealing task clicks or text selection. Use Pointer Events and pointer capture, with cleanup on release, cancellation, blur, or component unmount.
- Make the handle focusable with separator semantics, current/min/max values, arrow-key increments, Home/End bounds, and double-click to restore the default width. Show visible focus; resizing must not require a mouse.
- Persist only expanded width as a local UI preference, outside Forge model configuration and sessions. Settings, conversations, and the right workbench panel share this width. When a narrow-window right panel stacks below the conversation, preserve usable main content and composer controls; the two resize handles must not contend for pointer capture.
- Check the macOS traffic-light layout at minimum and maximum expanded-sidebar widths and with the sidebar hidden. Traffic lights must not collide with the toggle, workspace selector, New Task, or drag region. Check the Windows native title bar separately.
- Add real-window expand→collapse→expand screenshots and click acceptance: all three traffic lights stay fixed and clickable; the top-row toggle restores the sidebar; New Task, Settings, workspace selection, and Workbench remain accessible; and the main area uses the freed width. Repeat at minimum window size, in full screen, and on Settings.

## Implementation sequence and acceptance

| Stage | Deliverable and required evidence |
| --- | --- |
| 1. Models | Align config/catalog/adapter/docs; regression-test old IDs and saved selections plus text/image/tool/effort protocol; record whether a live provider was called |
| 2. Picker | Verify visual hierarchy, outside click, selection close, focus, and keyboard behavior; inspect English/Chinese, light/dark, and narrow screenshots |
| 3. Icon | Approve brand art and package both platform assets; inspect native icons in packages and installed apps, not just the in-page SVG |
| 4. Window | Accept native macOS traffic lights in expanded/collapsed states, dragging, and full screen; regress Windows native controls and layout; record screenshots separately by platform |
| 5. Settings | Verify four-section navigation and status/action hierarchy; preserve management semantics, direct routing, confirmations, feedback, bilingual themes, and narrow layout |
| 6. Sidebar | Test pointer and keyboard resize, clamping, collapse/restore, window resizing, persistence, and coexistence with the right panel |

After implementation, run focused tests, `CI=true pnpm check`, the documentation check, and `CI=true pnpm package:verify` for packaging resource changes. Packaged appearance and Gatekeeper behavior require downloaded/installed-app evidence; source checks and renderer captures cannot substitute. Decide versioning, signing, notarization, and platform coverage separately before any release.

## 2026-09-26 local implementation and verification

- Current source already has the `deepseek-flash` default and legacy-ID handling, anvil icons for both platforms, four-section Settings, picker dismissal on selection/outside click, and pointer/keyboard sidebar resizing with a remembered width. This pass does not claim installed-app acceptance for those features.
- This pass fully hides the macOS sidebar when collapsed. The main top row places Expand Sidebar, workspace, and New Task to the right of the native traffic lights, with Workbench and Settings at the far right. The expanded wordmark sits below the top controls. Windows retains its native title bar and existing collapsed layout. The model popover is now positioned within the main content when the right workbench is open.
- `CI=true pnpm check`, `CI=true pnpm desktop:build`, the local Electron workbench acceptance, and the update Settings acceptance passed. Offline fixtures and hidden-window captures checked collapse/restore, actions, narrow layout, and popover bounds. A visible macOS development window also showed the top layout and accessible native window controls. A screen-sharing indicator covered the controls in the screenshot, and the full-screen capture was not reliable, so traffic-light hit targets, system full screen, Windows window behavior, and installed-package appearance still require separate acceptance.

## Approval points

The macOS collapsed-sidebar direction was selected on 2026-09-26 and implemented in the current development source. Other original approval points were `deepseek-flash` as the new default with old IDs retained for compatibility, picker dismissal after model selection, four-section Settings navigation, and pointer/keyboard task-sidebar resizing with remembered width. Recheck their implementation and acceptance against current source; this dated design record is not evidence of a shipped release.
