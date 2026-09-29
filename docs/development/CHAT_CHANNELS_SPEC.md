# Chat Channels Specification

[简体中文](../zh-CN/development/CHAT_CHANNELS_SPEC.md) · [Intent](CHAT_CHANNELS_INTENT.md) · [Roadmap](ROADMAP.md)

> Document role: current-development. Telegram is implemented as experimental in 0.4.0.
> The maintainer chose a direct 0.4.0 CLI release, superseding the planned prerelease sequence below.
> Full C10 live acceptance remains incomplete; not all acceptance gates are claimed complete.

## Implementation notes

The source now includes the gateway and Telegram transport. Validation results belong
in the dated development evidence linked from the roadmap; C10 live acceptance is
still pending. Remote policy is deliberately stricter than ordinary `safe` and
`workspace-write`: every non-read action requires one-time approval. CLI, Desktop,
and Gateway native/Codex run entry paths share a host-local lease; read-only runs
also participate. The lock does not coordinate other machines or external editors.

`forge gateway retry-delivery` is a local recovery addition: while the gateway is
stopped, reset delivery attempts without rerunning tasks or restoring approvals.
The approval renderer currently denies descriptions exceeding its single-message
budget (at most 1,450 UTF-16 code units), including descriptions changed by redaction.
Outbox capacity reserves slots for final outcomes and approvals. The implementation
pauses admission at 80 queued messages and bounds retained inbox records at 10,000.

## 1. Current foundation and architectural boundary

The current [application runner](../../packages/application/src/run.ts) exposes
`runTask`, `cwd`, `sessionId`, `conversation`, `approvalChannel`, `signal`, and
`onEvent`. [Session persistence](../../packages/application/src/persistent-session.ts)
provides preparation, recording, and resume. The
[Desktop application](../../apps/desktop/src/agent/application.ts) invokes the shared
runner but also owns Desktop-specific session locks. These are reuse points, not
proof of an existing cross-entrypoint gateway or shared lock protocol.

Proposed ownership:

| Layer | Responsibility |
| --- | --- |
| CLI | Local setup, foreground lifecycle, diagnostics; no model-facing configuration mutation |
| Internal channel adapter | Platform transport, identity extraction, formatting, callbacks, retry classification |
| Gateway service | Admission, owner/workspace bindings, task lifecycle, concurrency, approval routing, delivery |
| Application | Shared session/run orchestration and cross-entrypoint execution lease integration |
| Core | Tool policy, approval semantics, context, cancellation and limits |
| Persistence | Versioned inbox, bindings, task/delivery metadata, atomic writes and recovery |
| Model adapters | Existing provider protocol projection; no platform-specific behavior |

Keep Telegram SDK objects out of application/core/persistence contracts. Start with
internal modules; add a private workspace package only when implementation needs it.
Do not implement the gateway by scraping CLI output or injecting chat into a shell.

## 2. Channel contract

Normalize inbound messages into `channel`, `accountId`, `eventId`, `senderId`,
`conversationId`, optional `threadId`, `receivedAt`, `kind`, and bounded text or
approval payload. Treat IDs as opaque strings. The Telegram adapter preserves
`update_id` for transport deduplication and the authenticated sender ID from the
platform envelope, never from forwarded content or display names.

An adapter provides start/stop, normalized inbound events, send, optional edit,
approval rendering, and a capability descriptor. Capabilities include message
editing, buttons, threads, attachments, and transport text limits. The gateway
requires text delivery; optional features use explicit fallback behavior. Approval
fallback is `/approve <opaque-token>` or `/deny <opaque-token>` from the same bound
owner and conversation, with the same expiry and single-use checks as buttons.
An adapter without secure approval input must reject approval-required execution.

Task keys include channel/account/conversation/thread and verified owner; they never
use a chat ID alone. Platform identities remain separate unless a future explicit
local linking flow is specified. The first release rejects groups, forwarded or
edited task messages, attachments, and bot-authored tasks before model invocation.
Service events are ignored. Supported callback events still pass authorization.

## 3. Local configuration and commands

Proposed CLI:

- `forge gateway setup telegram`: configure locally without starting execution.
- `forge gateway run`: run one foreground instance until terminated.
- `forge gateway status`: show sanitized connection, binding, and task state.

Store non-secret settings in a versioned user-owned file under
`FORGE_HOME/gateway/config.json` (default home follows existing Forge resolution).
Configuration includes `schemaVersion`, `channel`, `accountId`, `tokenEnv`,
`allowedUserIds`, `workspaceAlias`, and canonical `workspaceRoot`. For v1,
`channel=telegram`, exactly one owner ID and one binding are required, and the token
is read from `FORGE_TELEGRAM_BOT_TOKEN`. Never place its value in config or logs.
Reject missing identity, secret, invalid root, unsupported engine, or duplicate
instance at startup. A missing allowlist is deny-all, never first-sender ownership.
Project config, chat commands, and model output cannot change these gateway settings.

Require an explicit existing permission profile during local setup; no broader
profile is silently selected. v1 uses the Forge native engine. Existing model and
workspace instruction loading remains in application. These instructions do not
control gateway admission. Token rotation takes effect after a local restart.

Proposed owner-only Telegram commands:

| Command/input | Behavior |
| --- | --- |
| Plain text | Start a task in the current bound conversation if idle |
| `/help` | Show supported commands and host/workspace limitations |
| `/new` | Create a new conversation if idle; retain previous records |
| `/status` | Show current task state and latest completion without a model call |
| `/cancel` | Cancel current task and invalidate its pending approvals |

Unknown commands return help without model execution. `/new` is rejected while busy.
General CLI slash commands are not automatically exposed remotely. Pairing, arbitrary
workspace paths, provider changes, shell commands, and remote configuration are out
of scope. Normal text while busy is rejected with the active task ID; no hidden queue.

## 4. Admission, durability, and execution

Order: validate supported envelope and size → authorize owner/private conversation →
deduplicate → enforce capacity and workspace lease → durably accept → acknowledge →
execute. Use one active task and a bounded control-event queue of 100 items. Default
maximum task text is 16 KiB UTF-8; overflow gets a deterministic rejection. Rate-limit
unauthorized responses and never reveal project, session, model, or task details.

Persistence maintains a versioned inbox keyed by channel/account/event, routing to
session/run IDs, transport checkpoint, task state, and a bounded delivery outbox.
Durable writes must be atomic and private to the OS user. For polling, persist the
accepted event or terminal disposition before advancing the checkpoint. Do not wait
for model completion before continuing to receive cancellation or approval events.
Use a single poller lease per bot account. Webhook transport is deferred.

States: `accepted → running ↔ awaiting_approval → completed | failed | cancelled`.
On restart, any accepted/nonterminal task from the previous process becomes
`interrupted`; do not automatically invoke it again. Completed, failed, cancelled,
and interrupted states are terminal. A new user message creates a new task.

Duplicate events do not rerun the agent. Retain disposition records for seven days
by default and reject replay older than the retained acceptance horizon; retain a
monotonic Telegram checkpoint beyond inbox pruning. Record per-delivery status and
retry only sends, never execution. Do not claim exactly-once external side effects:
a crash may happen after a tool acts but before its result is persisted. Report that
uncertainty and require a fresh user task to inspect/reconcile it.

Reuse canonical completed conversation history. Never restore pending approvals,
processes, provider continuation from display text, or historical authority. Do not
silently attach an existing Desktop/CLI session. Gateway sessions are distinct in v1.

Before enabling writes, integrate a common canonical-workspace execution lease into
CLI, Desktop, and Gateway application paths. A competing Forge run must fail clearly
or wait through an explicit bounded policy; v1 chooses a busy rejection. Session
snapshot conflict detection remains required. Lease recovery checks process ownership
and avoids deleting a live lease solely by elapsed time. This coordinates cooperating
Forge entrypoints, not editors, external processes, or arbitrary shell side effects;
existing stale-write safeguards still apply. If the shared lease is not implemented,
remote mutating execution cannot pass release acceptance.

## 5. Approvals, cancellation, and secrets

Map core approval requests to server-owned records binding verified owner,
channel/account/conversation, session, run, tool-call/action digest, expiry, and a
cryptographically unpredictable token. Send the exact action and scope through
escaped, bounded presentation. If safe complete presentation is impossible, deny
with an explanation; do not ask for blind approval of a truncated action.

Default approval timeout: five minutes, capped by remaining task time. A response
is valid once, only while the matching request is pending. Atomically consume it
before resolving the core request. Wrong owner/chat/run, stale token, double click,
changed action, restart, timeout, cancellation, and disconnect-expired requests must
not approve. Core denial is final; gateway approval cannot override it. v1 does not
expose persistent session-wide grants.

Cancellation uses the existing abort path, stops further tool dispatch, denies pending
approvals, and records the observed outcome. Do not label cancellation complete before
the runner settles; show cancelling while it is in progress. Existing effects are not
rolled back. Default overall task deadline: 30 minutes, including approval waits;
existing step/tool/output/command limits also apply and cannot be raised from chat.

Use existing redaction plus gateway-token redaction before logs and delivery storage.
Never send environment dumps, credentials, hidden reasoning, or raw traces. Escape
untrusted output for Telegram markup. Send final text through a bounded sanitizing
renderer; do not promise arbitrary repository text can be perfectly secret-detected.
The local operator explicitly accepts that selected task text/results leave the host.

## 6. Delivery and operating behavior

Acknowledge only after durable acceptance. Update progress at most once per two seconds
and coalesce excess progress; preserve final outcomes and pending approvals. Apply the
platform's current text limit and split at safe boundaries. Default final-output cap:
16 KiB UTF-8, with a visible truncation notice and local session reference. v1 sends no
arbitrary files or raw tool output. Never present a local path as a remotely accessible
artifact link.

Handle rate limits using server retry hints, network/5xx errors using bounded backoff,
and invalid credentials as a stopped connection requiring local repair. Retry each
outbound item at most five times; cap the outbox at 100 items, discard coalescible
progress first, and pause new admission if terminal delivery cannot be retained.
Ambiguous send completion may duplicate a reply; stable task IDs make it recognizable.
Delivery failure must not change a completed task into a new execution.

Expose disconnected/reconnecting/connected and pending-delivery state locally. Retry
polling with bounded exponential backoff; receiving old queued task text after an outage
must reject messages older than five minutes instead of starting stale work. Approval
callbacks follow their own expiry. Graceful shutdown stops admission, cancels active
work, flushes state within 10 seconds, then leaves unresolved work interrupted. No
promise of continuous operation during host sleep, power loss, or network outage.

## 7. Acceptance matrix

All rows are required unless explicitly deferred in the intent.

| ID | Evidence required |
| --- | --- |
| C01 | Owner/private text runs through real application with fake provider; unknown owner/group/forward/edit/bot/attachment cannot call model or tools |
| C02 | One bot/owner/workspace configuration; missing allowlist/token/root and duplicate poller fail closed; diagnostics redact token |
| C03 | Multi-turn and `/new` preserve session separation; restart restores completed history, not pending authority |
| C04 | Approval allow/deny plus wrong sender/chat/run, action mismatch, expiry, restart, cancellation, and duplicate callback tests |
| C05 | Cancellation during model/tool/approval stages; control reception stays responsive; terminal result matches observed execution |
| C06 | Crash injection before/after inbox persistence, checkpoint, tool side effect, and outbox send; no automatic task replay; ambiguity disclosed |
| C07 | Concurrent Desktop/CLI/Gateway workspace execution rejected; independent workspaces unaffected; stale/live lease and snapshot conflict tests |
| C08 | Formatting, length, flood, 429, 5xx, invalid token, stale inbound, outbox saturation, and reconnect tests with fake transport |
| C09 | Fake second adapter passes shared routing/approval/lifecycle tests, including no-edit/no-button capability fallbacks |
| C10 | Opt-in live Telegram test with owner and second unauthorized account; real native-provider task, approval, rejection, cancel, restart and disconnect |
| C11 | Built npm artifact exposes proposed commands and gateway dependencies/resources; existing CLI/Desktop regression checks pass |

Offline gates: `CI=true pnpm check`, `CI=true pnpm check:docs`, focused Vitest tests,
`CI=true pnpm test`, `CI=true pnpm eval:deterministic`, and
`CI=true pnpm package:verify`. New test paths are assigned during implementation;
this spec does not invent runnable tests. Live trials require operator-provided bot
and model credentials and record sanitized evidence under `evals/reports/<version>/`.
Record OS, architecture, provider, transport, failures, and exclusions separately.

## 8. Delivery sequence and release

1. Freeze internal contracts and implement fake-transport lifecycle/conformance tests.
2. Implement local config, ingress/outbox persistence, shared execution lease and admission.
3. Connect native application/session execution, approvals, cancellation, and recovery.
4. Add Telegram polling, rendering, diagnostics, and opt-in live acceptance.
5. Prepare 0.4.0-beta.1; update bilingual user guides only for delivered behavior.
6. Publish 0.4.0 after required evidence passes; add later channels separately.

Current [npm workflow](../../.github/workflows/publish.yml) accepts `v*` tags;
[dist-tag selection](../../scripts/release-version.mjs) routes prereleases to `next`
and stable versions to `latest`. Reverify routing before publishing.
[Version tooling](../../scripts/set-version.mjs) currently excludes Desktop, whose
`desktop-*` artifacts have a separate build/version contract. Update all applicable
manifests, lockfile metadata, version constants, release-note paths, and packaging
checks during release preparation; do not publish private implementation packages.
This document change performs no version bump, tag creation, or publication.

Deferred decisions: second production platform, background-service support, Desktop
settings and shared-session handoff, multi-user/group policy, attachments, and Codex
engine compatibility. Each requires its own acceptance extension before shipping.
