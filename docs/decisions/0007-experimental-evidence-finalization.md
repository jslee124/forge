# ADR-0007: Opt in to a lossless evidence request for finalization

[Documentation index](../README.md) · [Implementation](../development/DESKTOP_PRODUCT_IMPLEMENTATION.md)

## Status

Accepted on 2026-10-26 for a host-selected experiment. This extends
[ADR-0004](0004-reserved-desktop-finalization.md) and
[ADR-0006](0006-explicit-answer-stage-message.md) only when explicitly selected.
Provider continuation remains the product default; this is not a rollout decision.

## Context

A small fixed-observation diagnostic suggested that evidence framing deserves
broader testing, but did not establish general reliability or justify switching
models. Testing coding and recorded-run summaries requires the actual runtime to
preserve writes, failed verification, refusal, unknown effects and canonical
history rather than substitute a model-written account of what happened.

## Decision

- Core/application accept host-only `finalizationInput: evidence`, effective only
  with reserved-final-step policy. Direct runs, CLI/gateway defaults and Codex
  remain unchanged. Desktop exposes no renderer or persistent configuration field.
  Isolated live-pilot startup can select an override; ordinary Desktop defaults
  still retain continuation.
- At the existing tool-free stage, serialize supplied history plus all current
  canonical messages and the complete pending exchange into an untrusted packet.
  Preserve tool-result JSON, failures, refusals, truncation, identities and order.
  Include host counters/limits and known history omissions (null if unknown).
  Provider-private reasoning is excluded; no model summarizer or extra call builds
  the packet. No record, approval receipt or checkpoint acquires authority.
- Send a fresh prompt with the original question/images, the packet, the original
  host instructions, original tool schemas, none and the existing answer-stage
  directive. Omit provider continuation, conversation roles and toolResults from
  this request to avoid duplication; canonical history is never replaced.
- The combined textual question/packet has a fixed 256 KiB cap. Count the actual
  resulting request against the same context/output limits. If it cannot fit,
  use existing factual fallback without omitting records, another model call,
  grants or effects. Preserve partial/limit reason and cancellation semantics.
- Core continues to refuse every tool call during finalization. An encoded
  refusal is not executed; exit zero is not goal success; unknown process effects
  are never replayed. This projection cannot make semantic accuracy deterministic.
- Trace finalizing events may label requested evidence input; a subsequent model
  start indicates admission, not proof of provider compliance or answer accuracy.
- Pilot summary recovery remains a separate reviewed, linked run, one model step
  and zero tools. An explicit test option exercises review/confirmation/draft
  preservation; product behavior does not gain automatic recovery.

## Validation and limits

Test both default and evidence modes, actual SDK serialization, pending/refused
exchanges, failed process verification, hostile text, unsupported none, packet and
context overflow, cancellation, replay-token rejection and unknown recovery facts.
Real isolated E01/F03 runs retain original prompts/model/budgets and independent
port checks. A run finishing before reserved finalization does not measure the
projection. Recorded source runs and reviewed summaries must be assessed separately.
No small trial, fixture or prose response establishes release/user acceptance.
