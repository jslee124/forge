# Chat Channels Intent

[简体中文](../zh-CN/development/CHAT_CHANNELS_INTENT.md) · [Specification](CHAT_CHANNELS_SPEC.md) · [Roadmap](ROADMAP.md)

> Document role: current-development. Telegram is implemented as experimental in 0.4.0.
> The maintainer chose a direct 0.4.0 CLI release, superseding the planned prerelease sequence below.
> Full C10 live acceptance remains incomplete; not all acceptance gates are claimed complete.

## Problem and intended outcome

Forge users need to delegate and supervise repository tasks while away from their
terminal or desktop. A chat channel should let an authorized owner submit work,
see concise progress, approve a specific action, cancel a task, and receive its
result on a phone. Execution remains on the machine hosting Forge and the bound
workspace; chat access does not move a local repository into the cloud.

The first useful journey is: configure one Telegram bot locally, bind one workspace
and one owner, send a coding task in a private chat, handle an approval, receive a
result, and continue the conversation after a gateway restart. A sleeping or offline
host cannot execute work. Setup and status must make that limitation clear.

## Product decisions

- Treat channels as additional Forge entry points and reuse the application/runtime.
- Start with Telegram private text messages, one bot, one owner, one workspace,
  and one active task. Keep the channel boundary reusable for future platforms.
- Run an explicit foreground gateway independently of Electron. Background service
  installation and Desktop settings are later work.
- Use Telegram long polling for the first transport; no public inbound endpoint is
  needed. The host needs working outbound access to Telegram and its model provider.
- Keep authorization, task ownership, and workspace binding outside model control.
- Preserve existing tool policy. Remote access must not implicitly approve tools,
  enable plugins, expand filesystem access, or change provider credentials.
- Make progress readable: acknowledge acceptance, report important phase changes,
  and deliver a concise final result instead of sending raw traces.

## Scope and non-goals

| In the first release | Deferred |
| --- | --- |
| Explicit owner allowlist and local workspace binding | Public bots, groups, team permissions, multiple owners |
| Text tasks, persisted conversations, status, cancellation | Voice, images, arbitrary file uploads, rich artifact browser |
| Single-use, expiring approval buttons | Broad or permanent remote approvals |
| Durable ingress, bounded delivery retries, interrupted-task reporting | Automatic replay of interrupted tool execution |
| Internal channel contract and a fake second adapter for conformance tests | Additional production platforms, third-party channel marketplace |
| Forge native engine using configured model adapters | Remote Codex engine support until separately specified and validated |
| CLI gateway lifecycle and diagnostics | Desktop gateway UI, cross-channel handoff, scheduled tasks |

A future platform should mainly add transport, authentication integration, formatting,
and capability handling. It should not duplicate task execution or permission policy.
Adding a second production platform will test the abstraction before a public plugin
API is stabilized. A messaging adapter is distinct from an agent tool plugin.

## User experience and trust

A task is accepted only after identity validation and durable recording. Replies
identify its task ID and bound workspace alias. Busy requests receive a clear busy
response rather than silently replacing the running task. Approvals show the exact
requested action and scope; rejection, expiration, or lost approval state never means
permission. The owner can query status even while the model is waiting or running.

Messages and selected results travel through the chat platform. Setup must explain
that transport boundary. Default replies exclude credentials, hidden reasoning, and
raw traces. Project files, tool output, forwarded text, and repository instructions
remain untrusted context and cannot authorize a sender or an approval.

## Success and acceptance

The specification's acceptance matrix is the completion contract. In particular:

1. The owner completes a real private-chat task with persistence, approval, and cancel.
2. An unlisted account cannot run a model/tool, inspect status, or approve a task.
3. Duplicate delivery and restart never automatically execute the same accepted task again.
4. An interrupted task is visibly interrupted; completed conversation history can be reused.
5. Existing CLI/Desktop behavior and release contracts remain validated.
6. A fake second adapter passes the shared lifecycle tests without Telegram types in core.

Offline tests, live Telegram/model acceptance, npm publication, and Desktop release
are separate evidence claims. Record platform and provider limitations explicitly.

## Delivery and version intent

Plan a 0.4.0 feature release, preceded by a prerelease such as 0.4.0-beta.1. Do not
change package versions merely to land these documents. Release preparation must
synchronize versions, packaged CLI resources, guides, and release notes; keep private
implementation packages private. Desktop can ship later through its separate release
route when it actually integrates the feature. Details are in the specification.

## References

- [Current architecture](../product/concepts/ARCHITECTURE.md), [security model](../product/concepts/SECURITY_MODEL.md), and [sessions](../product/reference/SESSIONS.md).
- [OpenClaw Telegram](https://docs.openclaw.ai/channels/telegram) and [Hermes Telegram](https://hermes-agent.nousresearch.com/docs/user-guide/messaging/telegram): reference designs, not Forge acceptance evidence.
- [Telegram Bot API](https://core.telegram.org/bots/api): verify current transport and message constraints during implementation.
