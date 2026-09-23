# Forge Desktop preview

简体中文 · Documentation index

As of 2026-09-23, [Desktop 0.3.4 Preview 3](https://github.com/jslee124/forge/releases/tag/desktop-0.3.4-preview.3)
provides a Windows x64 installer and macOS arm64/x64 DMGs. Desktop releases are
separate from the `@jslee124/forge` npm CLI. All Preview 3 installers are
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

The [Preview 3 CI run](https://github.com/jslee124/forge/actions/runs/35825140016)
builds the Windows installer and runs packaged and installed-app smoke on a
Windows runner. These offline checks do not prove Windows real-provider login,
every network route, Windows ARM64 support, or signed installer acceptance.
The Preview 3 release record
separates source CI, publication CI, public download checks, and remaining limits.
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
