# Forge Desktop preview

简体中文 · Documentation index

As of 2026-09-27, [Desktop 0.3.4 Preview 4](https://github.com/jslee124/forge/releases/tag/desktop-0.3.4-preview.4)
provides a Windows x64 installer and macOS arm64/x64 DMGs. Desktop releases are
separate from the `@jslee124/forge` npm CLI. All Preview 4 installers are
unsigned; the macOS DMGs are also not notarized. Installation and replacement
are manual. See the [Windows installation guide](https://github.com/jslee124/forge/blob/dev/apps/desktop/INSTALL-WINDOWS.md)
or [macOS installation guide](https://github.com/jslee124/forge/blob/dev/apps/desktop/INSTALL.md)
for configuration, authentication, and update steps. The older
[Preview 2](https://github.com/jslee124/forge/releases/tag/desktop-0.3.4-preview.2)
still provides macOS ZIPs.

## What the preview supports

- One workbench for code tasks, local files and document previews, and sourced
  research reports. File access remains scoped to the selected workspace.
- Separate Native Forge and Codex engines with their own authentication and
  availability. The app does not silently switch engines.
- Saved tasks, reviewable file changes, approvals, cancellation, and a bilingual
  light/dark interface. Some management commands have narrower desktop behavior
  than the CLI; availability is shown in the app.
- Background update checks and explicit, SHA-256-verified installer downloads.
  Opening a DMG or EXE does not replace the running app automatically.

## Validation limits

The [Preview 4 candidate CI run](https://github.com/jslee124/forge/actions/runs/36298064888)
built the Windows installer and ran packaged and installed-app smoke on a
Windows runner. These offline checks do not prove Windows real-provider login,
every network route, Windows ARM64 support, or signed installer acceptance.
The Preview 4 release record
records source CI, publication and public download checks, and remaining limits
as each stage is completed.
The Preview 3 release record
retains the preceding release evidence.
The [Preview 2 release record](https://github.com/jslee124/forge/blob/main/evals/reports/desktop-0.3.4-preview.2/README.md)
retains earlier macOS limits, including real unauthenticated GitHub update API
checks, Intel hardware, macOS 13, VoiceOver, and signed/notarized installation.
Consult the
[desktop QA record](https://github.com/jslee124/forge/blob/main/apps/desktop/design-qa.md)
for command-specific and accessibility limits.

The original desktop implementation contract,
D01–D13 checklist, and
D01 baseline are historical
records. Current behavior is established by source, tests, and the evidence above.

## Desktop development records

These records describe in-progress desktop work. They are not shipped-behavior
declarations; source, tests, and the release evidence above remain authoritative.

| Record | Status |
| --- | --- |
| Workbench design | Layout, theming, and interaction behavior of the live workbench |
| Workbench follow-up plan | Ordered tasks, acceptance gates, and current progress |
| Workbench UX specification | Proposed layout and slash-command parity; full parity still pending |
| Model and workbench refinement plan | Refinement design and local implementation record |
| Unsigned update plan | U01–U04 update flow, published through Preview 2 |
| Desktop QA record | Command-specific and accessibility limits |
