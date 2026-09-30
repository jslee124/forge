# Desktop 0.4.0 Preview 1 release evidence

[简体中文](README.zh-CN.md) · [Release notes](../../../.github/release-notes/desktop-0.4.0-preview.1.md)

## Scope and status

The maintainer authorized `desktop-0.4.0-preview.1` on 2026-09-30, targeting
Windows x64 and macOS arm64/x64 unsigned installers. The candidate updates the
desktop package to 0.4.0 and bundles the shared Forge 0.4.0 runtime and current
bilingual product help. Telegram remains an experimental CLI foreground gateway;
Desktop does not add gateway settings or a background service.

Publication and exact-source CI are pending. This candidate record alone does not
establish a public release or completed checks. Results will be recorded after
each stage finishes. The immutable release tag must resolve to the same source
commit checked by the publication CI. No main-branch integration was requested.

## Required checks

- Local source/docs checks, full tests, deterministic evaluations, packaged
  product-resource and npm installation checks, and whitespace validation.
- Native and Codex desktop entry-point tests: a shared occupied workspace
  rejects execution, release allows another task, and completion releases it.
- Exact-source CI: Ubuntu verification, Windows gateway contracts, Windows
  installer/package smoke and NSIS install/start/uninstall, macOS arm64/x64
  packaging and packaged-app smoke.
- Release assembly checks each installer against its platform SHA-256 manifest;
  uploaded file names, sizes and digests are checked before the draft is published.
- Public manifests and installer URLs are checked independently after publication.

## Local candidate checks — 2026-09-30

- `CI=true pnpm check` passed with 4 existing warnings and 19 informational diagnostics.
- `CI=true pnpm check:docs` and `git diff --check` passed.
- Full suite: 81 files passed, 4 skipped; 545 tests passed, 6 skipped.
- Deterministic release evaluations: 13 files and 71 tests passed.
- `CI=true pnpm package:verify` passed a clean temporary npm installation of 0.4.0.
- Desktop production build passed with `FORGE_DESKTOP_BUILD_TAG=desktop-0.4.0-preview.1`.
- Local unsigned macOS arm64 directory packaging and packaged-app smoke passed using an isolated `FORGE_HOME` outside the execution sandbox. The first sandboxed launch ended by signal without an application diagnostic; it is not recorded as a pass. This was not downloaded-DMG installation acceptance.
- These are local candidate checks, not remote CI, public downloads or live-provider evidence.

## Limits

The installers are unsigned; macOS DMGs are not notarized. Offline mock-provider
tests and CI smoke do not establish real-provider login/calls, all network routes,
Windows ARM64, SmartScreen or downloaded-file Gatekeeper/quarantine acceptance,
Intel hardware, macOS 13, native window controls, or installed-app acceptance on
every device. The Telegram live tests retained under [v0.4.0](../v0.4.0/RELEASE_VERIFICATION.md)
are separate CLI evidence and do not prove Desktop gateway support. Workspace
leases coordinate cooperating tasks, not manual edits or other applications.
