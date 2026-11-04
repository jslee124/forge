# Desktop 0.5.0-preview.1 release evidence

[简体中文](README.zh-CN.md) · [Report index](../README.md)

## Candidate

Prepared on 2026-11-04 from feature commit 21babed. The immutable-tag workflow and independent public-artifact verification are complete; see the published-artifact section below. Feature-source CI 41774872810 passed; it is not the release-tag result.

Feature-source local checks: 899 tests passed, 6 opt-in tests skipped; 223 deterministic checks passed; source/type/docs and packed-install checks passed.

## Real model scope

Reviewed [live acceptance summary](LIVE_ACCEPTANCE.json).

DeepSeek TUI and macOS development Electron tested concurrent sessions, queued cancellation, real pwd and persisted isolated history. Electron Native had 3 approvals and a fourth queued task; final Electron Codex had 2 active tasks and a third queued, confirmed turn/interrupt -> interrupted, and another task completed. Codex used gpt-6-luna / low. This does not establish live Codex TUI or multi-turn recovery.

Failed live harness attempts were retained: asynchronous session creation was read too early, an old-round counter contaminated a retry, and initial DeepSeek tool-budget/exit timing assertions failed. Later bounded retries passed. The latest Electron round consumed 4 DeepSeek requests and 8 Codex turns in total; turns may contain multiple model requests. No billing estimate is asserted.

## Release-candidate local checks (2026-11-04)

The versioned candidate passed 899 tests (6 opt-in skips), 223 deterministic checks, source/type/docs checks, packed installation of @jslee124/forge@0.5.0-preview.1, CLI version output, release-tag/package-version validation and an explicitly identified desktop build. These are local checks; tag CI and public downloads remain separate.

## Publication

Exact release source, CI run IDs and public-artifact verification are recorded below and in PUBLICATION.json. Candidate checks remain distinct from publication evidence.

## Limits

Preview; process-local queues, no automatic replay, worktrees retain external shared resources. Unsigned desktop installers, macOS not notarized; Windows/Linux real-provider/TUI, Intel hardware, independent users, IME/accessibility, installed-app live providers and long-duration coverage are not established. Existing stable channels remain unchanged.

## Published artifact verification (2026-11-04)

Published [desktop-0.5.0-preview.1](https://github.com/jslee124/forge/releases/tag/desktop-0.5.0-preview.1) as a non-draft prerelease from immutable source `3b6c3b5252a65861a63f074c0fe3c35ef824f60f`. [Tag CI](https://github.com/jslee124/forge/actions/runs/41779417083) passed all five jobs: release-source checks, Windows gateway contracts, Windows x64 package/launch and NSIS install/start/uninstall, macOS arm64/x64 package with host smoke, and verified draft upload/publication.

All five public files were independently downloaded. Names, byte sizes, SHA-256, available GitHub digests, platform/version manifests and release notes matched. The current update selector chose this release for older Preview installations on macOS arm64/x64 and Windows x64 using actual public release metadata; this is a parsing check rather than a full installed-app update interaction.

The public arm64 DMG was mounted read-only, copied to an isolated directory, detached, and launched with a fresh FORGE_HOME. Packaged smoke exited 0; the embedded Desktop identity was 0.5.0-preview.1 (package version 0.5.0). No model request was made and the existing installation was not replaced. This does not prove Gatekeeper/quarantine, signing or notarization acceptance.

See [PUBLICATION.json](PUBLICATION.json) for reviewed hashes, byte sizes, update candidates, exact source and CI results. The separately published CLI is on npm next; npm latest and GitHub stable Latest remain 0.4.0 / v0.4.0.
