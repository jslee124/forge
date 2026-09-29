# Gateway network fault injection — 2026-09-29

[简体中文](CHAT_CHANNELS_NETWORK_2026-09-29.zh-CN.md)

Development evidence, not live Telegram outage or release acceptance. Tests ran
locally on macOS with injected fetch responses and a deterministic model. They
exercise `runGateway`, the Telegram adapter, native application and persistent
state. No bot credentials or external messages are used.

## Coverage

Four runtime scenarios inject a fetch connection error, a TimeoutError, HTTP 503,
and HTTP 429 with retry_after. Each fails the first poll, observes persisted
reconnecting state, then restores polling. Each also fails the first terminal reply
and verifies its second attempt was persisted before successful delivery. The mock
continues returning the same update after acknowledgement.

All four scenarios verify one model execution, one successful terminal delivery,
completed task state, offset 11, an empty outbox and disconnected state after
shutdown. Existing tests separately cover exhausted delivery attempts, explicit
local delivery-only recovery, and avoiding a seventh attempt after restart.

This does not test real socket interruption, waiting for the actual 35-second
transport deadline, Telegram downtime, provider network failure, or uncertain
server acceptance followed by a lost response. Delivery is not exactly-once:
ambiguous transport outcomes may still produce duplicate replies, as documented.

## Results and CI scope

- Gateway and runtime tests: 42 passed across two files.
- `CI=true pnpm check`: passed with 4 existing warnings and 19 informational diagnostics.
- Workflow inspection: `.github/workflows/ci.yml` runs the full test suite in
  `verify` on ubuntu-latest. The Windows job runs selected desktop, tools and Codex
  tests, builds/packages the desktop app, and exercises installation; it does not
  currently select gateway tests.
- These are local results and workflow configuration observations. No workflow was
  changed, pushed or remotely executed for this test; no current remote CI success
  or Windows gateway acceptance is claimed.
