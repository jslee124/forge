# ADR-0003: Durable Desktop run records remain read-only presentation facts

[Documentation index](../README.md) · [Implementation plan](../development/DESKTOP_PRODUCT_IMPLEMENTATION.md)

## Status

Accepted on 2026-10-25 for the second Desktop productization increment. Extends
[ADR-0002](0002-desktop-run-presentation-contract.md) with persistence; it does not
complete the product milestones or introduce automatic execution recovery.

## Context

In-memory activity disappears after restart. Canonical session history preserves
model context, but cannot establish whether an interrupted tool caused an effect.
A separate record must preserve observable facts without becoming an approval or
provider continuation source.

## Decision

- The private persistence package owns versioned, redacted records at
  `FORGE_HOME/run-records/<sessionId>/<runId>/`. Summaries are atomic replacements;
  ordered JSONL journals append and sync control facts. New files/directories use
  0600/0700. Validate IDs, directory identities, and regular non-symlink files.
- Each journal has a 16 MiB ceiling, reserving 1 MiB for control facts. Coalesce
  text fragments; bound answers and per-step reasoning; report omitted content.
  A full control journal stops the run rather than silently losing decisions.
- Application serializes recording and exposes a poisoned/abort state. Desktop
  acquires session and workspace leases, persists a discoverable session and run,
  then acknowledges admission. Native tool lifecycle and decisions await durable
  recording before allowing the next effect.
- Record a terminal intent, save canonical session history, then finalize the
  product summary. Failure to record or save never becomes a successful live
  completion. A restart accepts an unfinished terminal intent only if canonical
  run membership confirms it. A completed summary without that membership is
  downgraded. This proves a session commit, not user-goal success.
- Reconcile under the session lease. Unfinished work becomes interrupted; tools
  with a start but no result become unknown. Old pending decisions become
  unresolved historical facts. There is no replay API, restored grant, or restored
  provider continuation.
- Use the existing PID/nonce execution lease for cooperating Desktop processes;
  retain the legacy empty-lock check and fail closed when ownership is unknown.
  Only a provably dead lease owner can be reclaimed by the existing mechanism.
- Read history through a bounded 20-summary index page and a bounded selected
  journal; project at most 500 items with an independent view-text budget.
  Historical components have no executable approval controls.

## Limits and consequences

Canonical sessions remain v3. CLI/gateway behavior and policy remain unchanged.
Codex output observers are asynchronous descriptive records: Desktop cannot
establish a before-effect barrier for opaque tools inside Codex. Existing records
are never injected into model conversation. Filesystem checks are application
controls, not an OS sandbox or protection against arbitrary concurrent host
filesystem mutation.

A valid journal prefix can survive a partial final write. Missing/corrupt indexed
records surface a storage error rather than empty history. Per-run quotas do not
provide lifetime disk retention. Reconciliation currently scans summary pages;
large-session retention/index compaction and performance gates remain separate
work. This increment covers process interruption, not proven power-loss durability,
exactly-once effects, installed-package validation, or live-provider quality.
