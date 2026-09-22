# Desktop update acceptance — 2026-09-22

[简体中文](update-qa.zh-CN.md) · [Update plan](UPDATE_PLAN.md) · [Installation](INSTALL.md)

U01–U04 implementation and controlled acceptance are complete locally. This is not publication, application replacement, signing/notarization or Intel-hardware acceptance.

## Implementation and automated checks

- Full build identity comes from `FORGE_DESKTOP_BUILD_TAG`. A missing identity is explicit; packaging requires one. Local package identity: `desktop-0.3.4-preview.2`, package filename version: `0.3.4`. No such release was published by this task.
- Fixed official release source; semantic stable/preview ordering; bounded pagination; running-process architecture; exact assets and unique checksums before download is offered.
- Main-process service and strict IPC cover checking, download, cancel, verify, open and preferences. An isolated Chromium session validates every redirect before transmission. Renderer supplies no URL/path and update state never enters model context.
- 22 focused update tests passed. Coverage includes CLI/draft/invalid release exclusion, equal/older versions, later pages and page limits, x64/Rosetta selection, malformed checksums, redirect host/count restrictions, credential omission, rate limits, timeouts, cancellation, duplicate clicks, ENOSPC, size limits, cache tampering, symlink substitution and persisted preferences.
- Desktop suite: 97 tests passed; 6 opt-in live-provider tests skipped. Root `pnpm check` passed with the existing 4 warnings / 18 informational diagnostics. Deterministic evaluation: 71 tests passed. CLI packed-install verification passed independently of desktop acceptance.
- Desktop production build and arm64/x64 DMG/ZIP packaging passed. `release-contract.mjs` generated `SHA256SUMS` and `desktop-build.json`. All four SHA-256 values were rechecked; [local build manifest](design/update-validation/local-build.json) records them. Both executable architectures and embedded full identities were inspected; both packaged main bundles match the final build. The unpacked arm64 app completed `--desktop-smoke` with fresh [Settings capture](design/update-validation/packaged-arm64-settings.png), Agent resource/preload checks and normal shutdown (a non-fatal Electron Helper sandbox warning was emitted). This is unpacked-app smoke, not an Applications replacement or Intel/Rosetta execution claim.

## Interface evidence

Electron captures cover 8 states × 2 languages × 2 themes plus 4 collapsed 720×600 layouts. Assertions check horizontal overflow, focusable controls, plain-text release notes and accessible collapsed controls. The updated harness also verifies an unsent draft survives update state changes and Settings navigation, and that its existing exit guard still prevents unload. This is an offline UI fixture, not a provider run.

Representative captures and the result manifest are in [update-validation](design/update-validation/results.json): [English light](design/update-validation/light-en-available.png), [Chinese dark download](design/update-validation/dark-zh-CN-downloading.png), [collapsed narrow layout](design/update-validation/light-en-collapsed.png), [verified installer](design/update-validation/dark-zh-CN-verified.png).

## Real download and DMG opening

[Machine-readable evidence](design/update-validation/live-download.json) records the controlled current identity `0.3.4-preview.0`, used solely to select the existing official `desktop-0.3.4-preview.1` release. Release enumeration used a fresh official metadata snapshot captured with `gh api`; the checksum and installer were fetched by the actual Electron update transport over HTTPS, without provider credentials.

- Target: `0.3.4-preview.1`; process/asset architecture: arm64.
- Source: [official arm64 DMG](https://github.com/jslee124/forge/releases/download/desktop-0.3.4-preview.1/forge-desktop-0.3.4-arm64.dmg).
- SHA-256: `1713e0f0ff5355b0af35bd97f22ab9b94bbcb03480ca98622ba0bec6993b3ca5`.
- Download, size check, SHA-256 verification and re-verification before `shell.openPath` succeeded. The acceptance process remained running after open. `hdiutil info` confirmed the downloaded image mounted at `/Volumes/Forge Desktop 0.3.4-arm64`.
- No app was copied into Applications, no existing Forge was quit/replaced, and no quarantine/signature settings were changed.

The initial live unauthenticated Release API returned HTTP 403 through the current proxy and timed out on a direct retry. The proxy also closed connections to GitHub's asset CDN (independently reproduced with curl). Asset acceptance succeeded with a **test-process-only** `--no-proxy-server` switch and captured release metadata. Production keeps normal system proxy behavior and reports errors; no automatic bypass was added. This is real asset-download/open evidence, but **not** a successful end-to-end live unauthenticated Release API check.

A real-transport attempt also exposed Electron's `fetch` manual-redirect cancellation. The implementation now uses a private session with a pre-request redirect guard; dedicated regression tests and the subsequent successful download cover that fix.

## Reproduction

Run from the repository root:

```sh
CI=true pnpm exec vitest run apps/desktop/src/main/update-service.test.ts apps/desktop/src/main/update-network.test.ts
CI=true pnpm check
CI=true pnpm check:docs
CI=true FORGE_DESKTOP_BUILD_TAG=desktop-0.3.4-preview.2 pnpm desktop:package
CI=true FORGE_HOME=/private/tmp/forge-update-ui-home apps/desktop/node_modules/.bin/electron apps/desktop --desktop-update-ui
```

The UI harness writes 36 PNGs and `results.json` under Electron's temporary directory, `forge-update-ui`. It does not make model calls. For the explicit live acceptance (opens a DMG):

```sh
pnpm exec esbuild apps/desktop/scripts/update-live-acceptance.mjs --bundle --platform=node --format=esm --external:electron --outfile=/private/tmp/forge-update-live-acceptance.mjs
apps/desktop/node_modules/.bin/electron /private/tmp/forge-update-live-acceptance.mjs --live
```

When separately diagnosing network failures, `--release-fixture /absolute/path/releases.json` supplies captured metadata only. `--no-proxy-server` applies only to that test process. Neither option changes the production updater. Inspect/eject the mounted image after acceptance; the test retains its backing file and evidence in its temporary directory.

## Live API recheck

A fresh no-fixture Electron recheck still returned HTTP 403 with `x-ratelimit-remaining: 0`, both with normal network settings and the test-process `--no-proxy-server` argument. GitHub reported the same quota reset time: 2026-09-22 15:54:14 Asia/Shanghai. Neither run reached checksum retrieval, downloaded a DMG or opened an installer. This confirms a current API quota blocker; successful real API enumeration remains unverified. See [retry evidence](design/update-validation/live-check-retry.json).
