# Chat channels development evidence — 2026-09-28

[简体中文](CHAT_CHANNELS_DEVELOPMENT.zh-CN.md) · [Specification](../../../docs/development/CHAT_CHANNELS_SPEC.md) · [Source guide](../../../docs/product/operations/CHAT_CHANNELS.md)

This is a development snapshot, not a release declaration. Target: 0.4.0. The
workspace/package version remains 0.3.4; no release tag or publication was performed.
The work was developed on `dev` over documentation commit `8149271`. Current source
and fresh tests supersede this record.

## Implemented source scope

- Telegram private text gateway; explicit local owner/workspace/profile configuration,
  foreground lifecycle, status and delivery-only recovery commands.
- Shared application/native runtime, canonical session persistence, cancellation,
  separate gateway sessions and per-action remote approvals. Ordinary CLI/Desktop
  permission profiles retain their existing behavior.
- Durable inbox/checkpoint and bounded outbox; no automatic replay of interrupted
  work; reply retries never rerun a task. Approval state is not restored.
- Shared host-local execution leases for native and Codex application entry paths,
  with dead-process recovery. Codex workspace resolution does not parse provider config.
- Transport-neutral service tests with a second adapter lacking buttons, Telegram
  plain-text rendering, bounded response/input/output, backoff and fail-closed startup.
- Bilingual source guide, intent/spec implementation notes and packaged product help.

The gateway still supports only the Forge native engine. The Codex entry path was
changed solely to participate in workspace exclusion, not to expose it through Telegram.

## Validation recorded

| Check | Result |
| --- | --- |
| `CI=true pnpm check` | Passed type checks and release routing; Biome reports 4 warnings and 19 informational diagnostics, no errors |
| `CI=true pnpm test` | 81 files passed, 4 skipped; 538 tests passed, 6 skipped |
| Focused gateway/runtime/lease/policy files | 5 files, 44 tests passed |
| `CI=true pnpm eval:deterministic` | 13 files, 71 tests passed |
| `CI=true pnpm package:verify` | Built and installed `@jslee124/forge@0.3.4` locally; gateway help, offline setup, status and delivery recovery passed |
| `CI=true pnpm check:docs` and `git diff --check` | Passed |

The temporary package installation used a placeholder bot token and made no Telegram
request. The integration tests used a fake fetch transport and fake model; they
exercised the real gateway polling loop, native application, tool approval/file write,
session persistence, reply delivery and shutdown. npm dependency installation is not
an agent/provider acceptance trial.

Covered failure cases include unauthorized/non-private/unsupported input, stale input,
replay, busy workspaces, wrong/expired/repeated/changed-action approvals, cancellation,
deadline, failed persistence before execution and after a simulated side effect,
restart interruption, ambiguous final send-attempt recovery, outbox retry exhaustion,
full journal cancellation, mismatched persisted destinations, bot/webhook validation,
rate limits and credential failure. Recovery tests use controlled persisted snapshots
and injected failures; they do not claim a power-loss or cross-platform soak test.

## Remaining acceptance and release work

- C10: live Telegram owner plus unauthorized-account trial, real provider execution,
  approval/deny/cancel, restart and network interruption. Not run in this task.
- Extended operating evidence: real long-running network conditions, host sleep and
  forced termination at OS boundaries; Windows/Linux acceptance was not run.
- Desktop installed-app acceptance was not rerun. Existing automated Desktop tests
  passed as part of the full suite; that is a different evidence boundary.
- Version preparation, prerelease distribution, updated release notes and immutable
  tags, npm publication, and any Desktop release remain separate work.

Do not mark the feature release accepted solely from these offline results. The
[specification acceptance matrix](../../../docs/development/CHAT_CHANNELS_SPEC.md#7-acceptance-matrix)
remains the complete release contract.
