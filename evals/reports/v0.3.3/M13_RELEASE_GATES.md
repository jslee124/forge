# Forge v0.3.3 Milestone 13 release gates

> **Historical evidence boundary:** this report was generated for Milestone 13
> before Milestone 14 introduced canonical structured tool history, session
> schema v3, and faithful resume reconstruction. Its recorded M13 results remain
> valid, but this report is not sufficient by itself to establish release
> readiness for the current tree. Current structured-session readiness also
> requires the deterministic
> [cross-layer session contract](../../src/session-contract.test.ts), the
> [Milestone 14 implementation record](../../../docs/history/v0.3.3/STRUCTURED_SESSION_HISTORY.md),
> and the latest codebase review/post-fix validation.

This checked-in report records the deterministic, offline Milestone 13.3-13.5
gate. It compares the same long-session fixture in `warn`, session `compact`,
and an explicitly configured user-default `compact` mode. The machine-readable
values are in [M13_RELEASE_GATES.json](M13_RELEASE_GATES.json).

All three variants retained the seeded constraint, edited-file marker,
unresolved-work marker, canonical transcript, and resume safety label. The
hostile historical approval claim was removed from derived memory. The compact
fixtures reclaimed 81.12% of projected input in the deterministic oracle.

Cache read/write values are `null` because the fake adapter did not declare
provider cache usage; they are not interpreted as zero. Latency is deterministic
local fixture time and is not a provider benchmark.

No live or paid provider call was made. Live trials remain behind the explicit
`eval:live` opt-in. The extractive checkpoint is still a safety oracle rather
than a semantic-quality basis, so the shipped default remains `warn`.
