# ADR-0004: Reserve finalization inside the existing Desktop run budget

[Documentation index](../README.md) · [Product implementation](../development/DESKTOP_PRODUCT_IMPLEMENTATION.md)

## Status

Accepted on 2026-10-25 for native Desktop finalization. Extends
[ADR-0002](0002-desktop-run-presentation-contract.md) and
[ADR-0003](0003-desktop-durable-run-records.md); no automatic resume or new grant.

## Context

A model can spend its last step requesting tools and then terminate without an
answer. Raising the total budget does not ensure convergence. Removing tool
schemas can break provider-owned continuation, while a model instruction alone
cannot prevent another tool effect.

## Decision

- Core exposes optional `completionPolicy: reserve-final-step`. Its default is
  `direct`. Application forwards this explicitly; only native Desktop opts in.
  CLI, gateway, child runs, and Codex keep their existing execution defaults.
- With at least two model steps, the last available logical step is tool-free.
  One-step budgets permit answering only. A depleted tool allowance or a batch
  larger than the remaining allowance also enters finalization. Finalization is
  one of the configured steps, never an extra model call or tool allowance.
- Keep original prompt, canonical history, observed tool results, and provider
  continuation. Retain historical schemas and request `toolChoice: none` through
  tested transports. A declared transport capability means the option can be
  projected; it does not promise that every endpoint honors it.
- Core blocks all finalization tool calls. Budget-refused batches receive paired,
  explicitly nonexecuted results and perform no effects. Complete pending
  exchanges remain in canonical history, including deterministic fallback paths.
- Buffer finalization answer text until a valid tool-free stop. Provider errors,
  ignored none, unsupported capability, incomplete output, or failed context
  admission use bounded observed facts without an extra attempt. Cancellation
  remains cancellation. Finalization does not use the clean-overflow retry path.
- Three consecutive model steps containing only identical `read_file` calls,
  known unchanged resource versions, and unchanged output enter finalization.
  Normalize field order and exclude attempt IDs. Changed evidence/version,
  unknown versions, failed/mixed operations, processes, and network calls reset
  or disable this check. It never serves cached results or grants authority.
- Preserve `limit_reached`, structured reason, and `partial: true` after a summary;
  natural-language output is not proof of task success. Record finalizing events
  and partial metadata for read-only history. A no-progress stop is presented as
  stopped investigation rather than numeric budget exhaustion.

## Limits

This contract bounds logical runtime model steps. Existing adapter-owned transport
retries remain separate and bounded by their own implementation; no claim of one
HTTP request per logical step is made. Context admission still applies. External
endpoint support and live-model answer quality require independent evidence.
The no-progress check is deliberately limited to versioned file reads; it does
not infer resource identity from process/network descriptions or unknown outputs.
