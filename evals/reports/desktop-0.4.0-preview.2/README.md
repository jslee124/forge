# Desktop 0.4.0 Preview 2 release record

[简体中文](README.zh-CN.md) · [Report index](../README.md)

## Preparation

Published as a prerelease; public-download checks passed. This record separates the already-merged application
checks from the new immutable-tag packaging and public-asset checks.

- Application integration: PR #9, main `7caf490`; source candidate `da55e29`.
- Candidate source CI: [41052172854](https://github.com/jslee124/forge/actions/runs/41052172854), passed Windows x64 packaging, packaged smoke, NSIS install/start/uninstall, and macOS arm64/x64 packaging with host smoke.
- Integration CI: [41188036903](https://github.com/jslee124/forge/actions/runs/41188036903), passed.
- Local application checks: 877 tests passed (6 opt-in skips), 223 deterministic checks, source/docs checks and npm packed-install verification passed.
- The preceding CI assets have a `.ci.41052172854` identity. They are not Preview 2 installers and will not be relabeled.
- The preceding local arm64 candidate passed isolated packaged smoke and ZIP integrity checks. It is not downloaded-DMG installation acceptance.
- The earlier Windows failure at `c86c983` is retained in [41051083907](https://github.com/jslee124/forge/actions/runs/41051083907); `da55e29` fixed linked record-file handling before the passing run.

## Publication gates

New tag `desktop-0.4.0-preview.2` must point to the reviewed release source.
Its CI must rebuild Windows x64 and macOS arm64/x64 with that exact identity,
run release checks and installer smoke, assemble the EXE and two DMGs, and check
their SHA-256 values. The draft remains private until uploaded names, sizes and
available remote digests match the five-file release asset set.

## Publication and public-download checks (2026-10-31)

- Published [desktop-0.4.0-preview.2](https://github.com/jslee124/forge/releases/tag/desktop-0.4.0-preview.2) at 2026-10-31T09:40:16Z; non-draft prerelease. Stable Latest remains `v0.4.0`.
- Immutable source: `f1b8a7489bc2c7266b35a9d67de00b7b76f97a3b`, merged through PR #10 after [PR CI](https://github.com/jslee124/forge/actions/runs/41188781435). [Exact-main CI](https://github.com/jslee124/forge/actions/runs/41189226422) passed.
- [Tag publication CI](https://github.com/jslee124/forge/actions/runs/41189244124) passed all five jobs, including release checks, Windows x64 packaging and NSIS install/start/uninstall, macOS arm64/x64 packaging with host smoke, immutable-source validation, asset assembly and draft upload verification.
- All five public assets were independently downloaded. Names, byte sizes, SHA-256, platform/version manifests, available GitHub digests and the bilingual release body matched. Full reviewed values are in [publication.json](publication.json).
- The public Apple Silicon DMG was mounted read-only, copied to an isolated temporary directory and started with an isolated home. Packaged smoke exited 0 and the embedded version was `0.4.0-preview.2`; the image was detached. The existing installation was not replaced. This does not establish Gatekeeper/quarantine acceptance.

## Limits

Unsigned Windows installer; unsigned and non-notarized macOS DMGs. Runner smoke
does not establish Intel hardware/macOS 13, Gatekeeper/SmartScreen, VoiceOver,
all IME paths, real Codex/provider login, or complete product acceptance.
Full two-round acceptance and independent user trials remain open; prior failed
acceptance evidence is retained. Telegram work is deferred. CLI/npm publication
is separate and is not part of this Desktop release.
