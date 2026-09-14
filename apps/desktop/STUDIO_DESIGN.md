# Desktop workbench design

The live Electron workbench uses a monochrome black, white and neutral-gray palette, compact task navigation,
a focused conversation, and an optional file/change/activity panel. The browser-only
simulation remains a separate development fixture.

- Appearance: Settings offers Light, Dark and System. The default is System;
  explicit choices persist locally. System changes apply while System is selected.
  The sidebar shortcut switches directly between light and dark.
- New tasks start with the workbench panel closed. Suggestions populate the draft;
  they do not execute a task. Command/Ctrl+Enter submits outside IME composition.
- Resuming a task opens Files. Files, Changes and Activity retain their own content
  when switching tabs. Switching workspace/session invalidates preview and review data.
- Drag the panel's left edge to resize; focus it and use arrow keys for keyboard
  resizing. On narrow windows the panel overlays content and has a close button.
- Settings uses the main content area without the file panel. Code highlighting,
  tables, approvals and diff colors follow the theme; source images/PDFs retain
  their original colors.

## Validation

Run the renderer theme and store tests, desktop session/file regression tests,
`pnpm check`, and `pnpm desktop:build`. After building, from `apps/desktop`, run
`FORGE_UI_OUTPUT=/private/tmp/forge-studio-qa node scripts/acceptance-ui.mjs`.
The Electron acceptance runner uses temporary sessions and real IPC/file services,
captures both languages and themes, checks theme persistence after renderer reload,
and checks System against the current system preference. It makes no model calls.
The theme unit test checks changes to the system preference and explicit overrides.

Screenshots are local UI evidence, not provider, packaging or release evidence.
