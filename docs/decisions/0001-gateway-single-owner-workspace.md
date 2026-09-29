# ADR-0001: Restrict the chat gateway to one owner and one workspace

[Documentation index](../README.md) · [Chat channels specification](../development/CHAT_CHANNELS_SPEC.md)

## Status

Accepted; shipped in the experimental 0.4.0 Telegram gateway.

## Context

Forge 0.4.0 added a foreground chat entry point so a task can be started from a
messaging client. Unlike the CLI and Desktop, this entry point accepts input from
a channel the host does not control, and it can run workspace-writing tools on
behalf of whoever sends the message.

That raises questions a local CLI never faces: who is allowed to start work, which
workspace their work may touch, and how a remote approval can be trusted. The
gateway also has to stay inside the existing policy and approval model rather than
introducing a second one.

## Decision

The v0.4.0 gateway serves exactly one numeric owner and one workspace binding.

- Local setup requires one `allowedUserIds` entry and one `workspaceRoot`. The
  binding is never inferred from traffic: a missing allowlist is deny-all, not
  first-sender ownership.
- Inbound tasks are keyed by channel, account, conversation, thread, and the
  *verified* sender identity — never by chat ID alone — and are rejected before
  model invocation when they come from a group, a forwarded or edited message, an
  attachment, or the bot itself.
- Non-read actions require one-time approval through an input path the adapter can
  authenticate. An adapter without secure approval input must reject
  approval-required execution instead of degrading to a weaker prompt.
- Gateway settings are local-only. Project configuration, chat commands, and model
  output cannot change the owner, workspace, profile, or bot.

## Alternatives considered

- **Multi-owner allowlist from the start.** Rejected: a shared workspace with
  several remote identities needs per-user authorization, attribution, and
  conflict handling that v1 does not have.
- **First-sender ownership.** Rejected: whoever messages the bot first would claim
  it, so an unconfigured bot becomes an unauthenticated remote shell.
- **Chat-ID-scoped task keys.** Rejected: identifiers would not survive account,
  conversation, or thread changes and would not tie a run to a verified identity.
- **Background service installation.** Rejected for v1: a daemon widens the
  always-on attack surface before the admission and approval paths have live
  evidence.

## Consequences

Positive: the authorization model is small enough to reason about completely; every
run is attributable to one verified identity and one workspace; approvals cannot be
answered by a third party; and the gateway reuses the existing policy, lease, and
approval semantics instead of forking them.

Negative: the gateway is not usable by a team, and the owner must be established
during local setup. Changing the owner, workspace, profile, or bot invalidates prior
authorization, and old sessions stay on disk without being attached to the new
binding. Groups, attachments, and background operation remain unavailable.

Supporting a second owner is therefore a new decision, not a configuration change.
Record it as a superseding ADR rather than widening this one.
