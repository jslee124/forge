# Forge Desktop preview

简体中文 · Documentation index

As of 2026-09-23, the public desktop build is
[Desktop 0.3.4 Preview 2](https://github.com/jslee124/forge/releases/tag/desktop-0.3.4-preview.2).
It is a macOS prerelease distributed separately from the `@jslee124/forge` npm CLI.
Choose the arm64 or x64 DMG/ZIP for the machine. The app is unsigned and not
notarized; installation and later replacement are manual. See the
[desktop installation guide](https://github.com/jslee124/forge/blob/main/apps/desktop/INSTALL.md)
for configuration, authentication, and update steps.

## What the preview supports

- One workbench for code tasks, local files and document previews, and sourced
  research reports. File access remains scoped to the selected workspace.
- Separate Native Forge and Codex engines with their own authentication and
  availability. The app does not silently switch engines.
- Saved tasks, reviewable file changes, approvals, cancellation, and a bilingual
  light/dark interface. Some management commands have narrower desktop behavior
  than the CLI; availability is shown in the app.
- Background update checks and explicit, SHA-256-verified installer downloads.
  Opening the DMG does not replace the running app automatically.

## Validation limits

The [Preview 2 release record](https://github.com/jslee124/forge/blob/main/evals/reports/desktop-0.3.4-preview.2/README.md)
records publication, assets, checksums, and test scope. Local Electron and
controlled update acceptance do not prove every external provider or network
route. A full unauthenticated live GitHub update API check, manual replacement
in Applications, Intel/Rosetta execution, macOS 13 hardware, VoiceOver, and
signed/notarized installation remain unverified. Consult the
[desktop QA record](https://github.com/jslee124/forge/blob/main/apps/desktop/design-qa.md)
for command-specific and accessibility limits.

The original desktop implementation contract,
D01–D13 checklist, and
D01 baseline are historical
records. Current behavior is established by source, tests, and the evidence above.
