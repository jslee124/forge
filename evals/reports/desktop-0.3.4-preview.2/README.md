# Desktop 0.3.4 Preview 2 release evidence

Published on 2026-09-23 (Asia/Shanghai) as a public GitHub prerelease:
[Preview 2](https://github.com/jslee124/forge/releases/tag/desktop-0.3.4-preview.2).
See [machine-readable evidence](release.json) and [中文](README.zh-CN.md).

- The tag points to source commit `6f57f6ad3d5f15e71cbfbdf227f1044f04e58e47`; [source CI passed](https://github.com/jslee124/forge/actions/runs/35700681711).
- Local check and full tests passed: 491 passed, 6 opt-in tests skipped.
- Both architecture bundles contain the full preview identity and match the built main bundle. All four installer checksums passed locally.
- All six GitHub asset sizes and SHA-256 digests match local files. All six public download URLs returned HTTP 200 to HEAD requests; the Intel DMG required a retry after a TLS failure. The public checksum list and build manifest were downloaded and matched byte-for-byte. Full installers were not downloaded again after publication.
- The release is a prerelease, not a draft. Stable latest remains `v0.3.4`; no npm publication was triggered.

The artifacts are unsigned and not notarized. Preview 1 users must manually upgrade once to obtain the updater. The full real unauthenticated GitHub update check remains unverified due to API quota/network failures; publication and public download checks do not replace that acceptance. No Applications replacement, Intel/Rosetta execution or macOS 13 hardware acceptance is claimed. Earlier implementation evidence remains in the [update QA](../../../apps/desktop/update-qa.md).
