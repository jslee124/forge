# CLI/npm 0.5.0-preview.1 release evidence

[简体中文](README.zh-CN.md) · [Report index](../README.md)

## Candidate

Prepared on 2026-11-04 from feature commit 21babed. Publication is pending the immutable-tag workflow and independent public-artifact verification. Feature-source CI 41774872810 passed; it is not the release-tag result.

Feature-source local checks: 899 tests passed, 6 opt-in tests skipped; 223 deterministic checks passed; source/type/docs and packed-install checks passed.

## Real model scope

Reviewed [live acceptance summary](../desktop-0.5.0-preview.1/LIVE_ACCEPTANCE.json).

DeepSeek TUI and macOS development Electron tested concurrent sessions, queued cancellation, real pwd and persisted isolated history. Electron Native had 3 approvals and a fourth queued task; final Electron Codex had 2 active tasks and a third queued, confirmed turn/interrupt -> interrupted, and another task completed. Codex used gpt-6-luna / low. This does not establish live Codex TUI or multi-turn recovery.

Failed live harness attempts were retained: asynchronous session creation was read too early, an old-round counter contaminated a retry, and initial DeepSeek tool-budget/exit timing assertions failed. Later bounded retries passed. The latest Electron round consumed 4 DeepSeek requests and 8 Codex turns in total; turns may contain multiple model requests. No billing estimate is asserted.

## Release-candidate local checks (2026-11-04)

The versioned candidate passed 899 tests (6 opt-in skips), 223 deterministic checks, source/type/docs checks, packed installation of @jslee124/forge@0.5.0-preview.1, CLI version output, release-tag/package-version validation and an explicitly identified desktop build. These are local checks; tag CI and public downloads remain separate.

## Publication

Exact release source, CI run IDs, npm integrity/dist-tags or installer hashes, and public-download verification will be recorded after publication. Do not treat candidate checks as publication evidence.

## Limits

Preview; process-local queues, no automatic replay, worktrees retain external shared resources. Unsigned desktop installers, macOS not notarized; Windows/Linux real-provider/TUI, Intel hardware, independent users, IME/accessibility, installed-app live providers and long-duration coverage are not established. Existing stable channels remain unchanged.
