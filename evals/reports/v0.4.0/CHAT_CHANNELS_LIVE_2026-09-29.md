# Telegram live smoke — 2026-09-29

[简体中文](CHAT_CHANNELS_LIVE_2026-09-29.zh-CN.md) · [Source guide](../../../docs/CHAT_CHANNELS.md)

Development evidence on macOS, branch `dev`, package version 0.3.4. This is not a
release or full acceptance declaration. The user authorized creation of a dedicated
test bot and testing through their logged-in Telegram Web account. The gateway used
the real Telegram Bot API and the configured DeepSeek native model route
(`deepseek-v4-flash-vision-exp`), with a private temporary Forge home and an isolated
workspace outside the repository. No token or provider credential is included here.

## Observed results

| Check | Evidence |
| --- | --- |
| Connection and help | Gateway recorded connected; `/help` returned commands in Telegram |
| Remote status | `/status` returned completed with zero pending deliveries in Telegram |
| Real model response | Requested `TEST_OK` and received it |
| Multi-turn context | A later request recalled the synthetic marker `TG-929-ALPHA` |
| Write approval | `hello.txt` absent before approval; Allow once produced exactly `hello telegram` plus newline, 15 bytes |
| Denial | Deny acknowledged in Telegram; `denied.txt` absent after the task settled |
| Cancellation | `/cancel` settled the waiting task as cancelled; `cancelled.txt` absent |
| Stale approval | Clicking the cancelled task's old Allow once returned invalid or expired; no file appeared |
| Process restart | SIGTERM stopped the gateway; restarting retained the session and correctly recalled the original marker |
| Start command regression | Initially `/start` returned unknown command; corrected to the help path and verified live after restart |

The model later incorrectly claimed it had not written `hello.txt`. Direct filesystem
verification and the persisted session's tool records contradicted that statement.
This smoke therefore does not establish reliable model narration of prior actions.

## Limits

This uses one owner account on macOS. A second unauthorized account, groups,
attachment handling, provider outages, rate limiting, abrupt process death during a
side effect, delivery exhaustion, Windows and Linux were not tested live. Existing
deterministic coverage is separate evidence. The temporary profile is disposable;
the bot remains registered, and stopping the gateway makes it unavailable for tasks.
No version bump, publication, signing or installer acceptance was performed.

## Local checks and final state

- Focused gateway/runtime tests: 38 passed across two files.
- `CI=true pnpm check`: passed; 4 existing warnings and 19 informational diagnostics.
- `CI=true pnpm check:docs`: 226 Markdown files, 912 local references passed.
- `CI=true pnpm package:verify`: packed install verified at version 0.3.4.
- `git diff --check`: passed.
- After resuming the interrupted test, the gateway lease PID returned `ESRCH`: the
  test gateway is no longer running. Its persisted connected status is historical.
