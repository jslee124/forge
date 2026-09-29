# Forge 0.4.0 verification scope

The maintainer authorized a stable CLI/npm 0.4.0 release with the Telegram gateway
explicitly experimental. This supersedes the originally planned beta-first rollout;
it does not waive or claim completion of full C10 live acceptance.

## Existing implementation evidence

- [macOS live smoke](CHAT_CHANNELS_LIVE_2026-09-29.md)
  ([中文](CHAT_CHANNELS_LIVE_2026-09-29.zh-CN.md)): real Telegram and DeepSeek,
  conversation, allow/deny, cancel, stale approval and restart memory.
- [Fault injection](CHAT_CHANNELS_NETWORK_2026-09-29.md)
  ([中文](CHAT_CHANNELS_NETWORK_2026-09-29.zh-CN.md)): deterministic transport faults,
  reconnection, delivery retry and one model execution under repeated updates.
- Implementation commit cb5e99ae7cb2e2807bd3f7baf82e3d427cab017c passed
  [CI 36542885507](https://github.com/jslee124/forge/actions/runs/36542885507):
  Linux verify, Windows gateway contracts and Windows desktop checks.

## Release verification procedure

The versioned candidate must pass source/docs checks, full tests, deterministic
evaluations, package installation and version/tag checks. Verify exact dev and main
commit CI before creating the immutable v0.4.0 tag. Publication is performed only
by the tag workflow with npm Trusted Publishing. Workflow results, npm metadata,
GitHub Release state and public installation are separate evidence; the existence
of this document alone does not establish publication success.

## Remaining limits / 尚未完成

A second real unauthorized account, real connection interruption, live Windows or
Linux Telegram trials and complete C10 acceptance remain unverified. Existing
network tests inject errors and do not prove real outage behavior. Model narration
of prior actions was not always accurate. Desktop installers have a separate
release cycle. Only Telegram is adapted in 0.4.0.

维护者选择直接发布 0.4.0 CLI/npm，Telegram 仍为实验性功能。已完成的真实和自动化验证
与未完成的验收分开记录，不将旧提交的 CI 视为最终发布提交的证明。

## Local candidate checks — 2026-09-29

- Source/type/release-routing checks passed (4 existing warnings, 19 informational diagnostics).
- Full test suite: 81 files passed, 4 skipped; 543 tests passed, 6 skipped.
- Deterministic release evaluations: 13 files, 71 tests passed.
- Documentation checks and diff whitespace checks passed.

These are local candidate results; exact commit CI and public publication must still
be checked independently using the release procedure above.
