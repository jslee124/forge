# Forge Desktop unsigned update plan

Date: 2026-09-22. Status: U01–U04 implemented and controlled acceptance complete; validation is recorded in [update QA](update-qa.md). Published as [Preview 2](https://github.com/jslee124/forge/releases/tag/desktop-0.3.4-preview.2) on 2026-09-23; see [release evidence](../../evals/reports/desktop-0.3.4-preview.2/README.md). No Developer ID or signing certificate is configured.

[中文](UPDATE_PLAN.zh-CN.md) · [Development plan](WORKBENCH_DEVELOPMENT_PLAN.md) · [Installation](INSTALL.md)

## Scope and current state

Desktop now implements: background startup check → explicit download → verification → open DMG → manual application replacement. No automatic overwrite or restart-to-install, no signing configuration change. Publication and manual application replacement remain separate actions.

## UI and states

Check after startup without blocking the window or tasks; do not download automatically. Add a Settings version/update section with full desktop build version, channel, last successful check, result, release notes and manual check. Allow disabling startup checks and persist the preference. Development and automated tests default to no network.

| State | Beside Settings | Behavior |
| --- | --- | --- |
| Unchecked / checking / current | No button | Show status in Settings; failures never mean up to date |
| Update available | Download update | Show target version; download only on click |
| Downloading | Downloading… and progress | Cancellable; indeterminate if total size is unknown |
| Verifying | Verifying… | Cannot open until verified |
| Verified | Open installer | Open verified DMG without quitting Forge |
| Check / download / verification failed | Retry for download failures | Explain errors and retry in Settings; no modal for automatic check failures |

Place the action beside Settings at the sidebar bottom. Collapsed history uses an icon with a full tooltip and accessible name while preserving Settings access. Verify both languages/themes and narrow windows. Retrying re-verifies; cancelling preserves the update notice.

Explain the manual steps when opening the DMG: save work, quit the old Forge, then drag into Applications to replace it. Opening the installer never closes Forge; existing draft/active-work exit guards remain. Do not label this action Install update or Restart to install.

## Release and version contract

- Query the fixed official GitHub repository's Release API. Accept only `desktop-<semver>` tags; exclude CLI `v*` tags, drafts and invalid versions. Compare semantic versions, not dates, strings or a single GitHub latest response. Bound pagination; incomplete enumeration cannot imply up to date.
- Stable builds default to the stable channel; preview builds default to preview. Preview also accepts newer stable versions. Settings may select stable/preview, triggering a fresh check without automatic downgrades.
- Package version `0.3.4` alone cannot identify `desktop-0.3.4-preview.1`. First establish generated desktop build identity with full semantic version/channel matching the tag. Missing identity in old builds must be explicit, never guessed. Existing installations require one manual upgrade to obtain this feature.
- Select arm64/x64 DMG by the running application's architecture, including x64 under Rosetta; no implicit architecture migration. Match `forge-desktop-<package-version>-<arch>.dmg` and the same Release's `SHA256SUMS`. Record the mapping from full build identity to filename version in the release contract.
- Require the matching architecture asset and a unique valid checksum. Incomplete releases must be explained rather than presented as downloadable compatible updates. Render release notes as text or safe links, never executable remote HTML.

## Implementation boundaries

Use an independent Electron main-process service for checks, download, verification and opening files. Expose narrow check/download/cancel/open/status IPC through preload. Renderer supplies neither arbitrary URLs nor filesystem paths. Preferences never enter model context; no provider credentials are used.

Allow only the fixed official HTTPS source and validated GitHub asset redirects. Reject arbitrary schemes/hosts and path traversal. Bound timeouts, response/file sizes, redirects and retries; deduplicate concurrent work and support cancellation. Handle rate limits, proxy/offline errors, disk exhaustion and process exit.

Download to an application-managed temporary directory. Compute SHA-256 against the same Release's SHA256SUMS before atomically promoting the file. Remove failed temporary files. Reverify reusable caches after restart and validate the managed file/checksum before opening. Clean versioned application caches without deleting user-saved files.

SHA-256 establishes integrity, not Apple signing, notarization or independent source authenticity. Unsigned-system prompts may remain; never remove quarantine or bypass Gatekeeper automatically. If certificates become available, evaluate electron-updater while reusing UI states; automatic replacement is outside this phase.

## Implementation and acceptance

U01–U04 are implemented in the current source. Controlled U04 results and evidence boundaries are in [update QA](update-qa.md); P4 evidence is not reused.

1. U01 — implemented: Define build identity and Release/checksum contracts. Test stable/preview ordering, equal/older versions, CLI exclusion, pagination, missing assets and architecture selection.
2. U02 — implemented: Implement main service, IPC and preferences. Fixture tests cover redirect restrictions, rate limits/timeouts, cancellation, disk errors, checksum failure, repeated clicks and cache tampering.
3. U03 — implemented: Connect startup, Settings and sidebar UI. Verify both languages/themes, collapsed/narrow layouts, keyboard focus and all states without disrupting tasks/drafts.
4. U04 — see acceptance record: Build and perform controlled download/DMG-open acceptance, recording version, architecture, source and digest. Update bilingual installation/QA. Real downloads, manual replacement, signing/notarization and publication require separate evidence; fixtures cannot substitute for them.

During implementation run focused Vitest, root check, desktop build and docs checks; add packaging/install acceptance for artifact contracts and deterministic evaluation for cross-layer changes. This implementation uploads no Release and replaces no application.

## Build and cache contract

Set `FORGE_DESKTOP_BUILD_TAG=desktop-<full-semver>` when building a release. Packaging refuses a missing identity. The embedded full version is validated against the package version's major.minor.patch; development builds without the variable explicitly report a missing identity. The acceptance identity `desktop-0.3.4-preview.2` is now the published preview tag.

`release-contract.mjs` generates `SHA256SUMS` and `desktop-build.json` after both architecture DMG/ZIP outputs exist. Publish these together with the four files under the matching desktop tag only after separate publication authorization. The updater reads the checksum before offering a download and reads it again before downloading; changed checksums require a fresh check.

The main process uses an isolated, nonpersistent Chromium network session with credentials omitted. Every redirect is validated before sending it; see [Electron networking](https://www.electronjs.org/docs/latest/api/net). Checks allow at most 10 pages of 100 releases and 30 seconds; metadata is capped at 4 MiB/page, checksums at 1 MiB, installers at 2 GiB, downloads at 15 minutes and redirects at four. Retries are user-initiated. Chromium uses system proxy configuration; failures remain visible, with no automatic proxy bypass.

Preferences are stored under Electron userData/desktop-updates, outside Forge sessions. Installers live in private session directories, are deleted on normal exit, and are not reused after restart. Abandoned session directories older than 24 hours are pruned on initialization (up to 1,000 entries per launch); a new check removes previous version installers from the current session. User-saved files are not touched. Last successful check time describes the current app session.
