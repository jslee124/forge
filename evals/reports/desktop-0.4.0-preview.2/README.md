# Desktop 0.4.0 Preview 2 release record

[简体中文](README.zh-CN.md) · [Report index](../README.md)

## Preparation

Publication is pending. This record separates the already-merged application
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

## Limits

Unsigned Windows installer; unsigned and non-notarized macOS DMGs. Runner smoke
does not establish Intel hardware/macOS 13, Gatekeeper/SmartScreen, VoiceOver,
all IME paths, real Codex/provider login, or complete product acceptance.
Full two-round acceptance and independent user trials remain open; prior failed
acceptance evidence is retained. Telegram work is deferred. CLI/npm publication
is separate and is not part of this Desktop release.
