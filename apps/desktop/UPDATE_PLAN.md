# Forge Desktop unsigned update plan

Date: 2026-09-22. Status: design only, not implemented; this change is documentation only. The user has no Developer ID or signing certificate.

[中文](UPDATE_PLAN.zh-CN.md) · [Development plan](WORKBENCH_DEVELOPMENT_PLAN.md) · [Installation](INSTALL.md)

## Scope and current state

Desktop currently has no startup update check, feed or download manager. Target flow: background startup check → explicit download → verification → open DMG → manual application replacement. No automatic overwrite or restart-to-install, no signing configuration change. This plan is neither shipped behavior nor publication authorization.

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

## Future implementation and acceptance

All tasks below remain pending. P4 screenshots/tests do not prove update behavior.

1. U01: Define build identity and Release/checksum contracts. Test stable/preview ordering, equal/older versions, CLI exclusion, pagination, missing assets and architecture selection.
2. U02: Implement main service, IPC and preferences. Fixture tests cover redirect restrictions, rate limits/timeouts, cancellation, disk errors, checksum failure, repeated clicks and cache tampering.
3. U03: Connect startup, Settings and sidebar UI. Verify both languages/themes, collapsed/narrow layouts, keyboard focus and all states without disrupting tasks/drafts.
4. U04: Build and perform controlled download/DMG-open acceptance, recording version, architecture, source and digest. Update bilingual installation/QA. Real downloads, manual replacement, signing/notarization and publication require separate evidence; fixtures cannot substitute for them.

During implementation run focused Vitest, root check, desktop build and docs checks; add packaging/install acceptance for artifact contracts and deterministic evaluation for cross-layer changes. This documentation change implements none of these tasks, uploads no Release and replaces no application.
