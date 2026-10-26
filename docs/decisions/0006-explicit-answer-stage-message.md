# ADR-0006: Make the reserved answer stage explicit in model messages

[Documentation index](../README.md) · [Product implementation](../development/DESKTOP_PRODUCT_IMPLEMENTATION.md)

## Status

Accepted on 2026-10-26. Extends [ADR-0004](0004-reserved-desktop-finalization.md);
its fixed budgets, historical schemas, continuation, refusal and fallback rules
remain in force. No automatic retry or new execution authority is introduced.

## Context

A bounded headless application diagnostic retained its actual DeepSeek final
request. Both its exact replay and a replay without tool definitions returned raw
DSML under none. Appending a new answer-stage message, or starting an independent
answer from the same evidence, produced prose in one sample each. This is narrow
protocol evidence, not a model reliability or task-success claim. The independent
evidence projection was not selected because it would replace continuation.

## Decision

- Core supplies a host-authored `responseDirective` only when entering the
  reserved tool-free stage. It restates the original request, requires an answer
  from existing evidence, and asks that unsupported connections remain unknown.
- Adapters append the directive after pending tool results as a user-role message
  only with `toolChoice: none`. That role marks a provider conversation boundary;
  it is generated host control, not another human request. It is excluded from
  canonical human history and does not restore approval or authorize effects.
- Keep original messages, observed/refused results, historical schemas, thinking
  configuration and provider continuation. The stage remains a single existing
  logical model step. Invalid output still falls back without an extra attempt;
  tools are still refused even when the provider ignores none.
- Count directive text in current-request and mandatory context estimates even
  with continuation. A large repeated original request can fail context admission;
  do not silently bypass limits or drop evidence to fit it.
- The installed DeepSeek SDK 3.0.35 recognizes historical reasoning by the V4
  spelling but misses the current `deepseek-flash` name when a new user-role
  boundary is appended. Apply a version-pinned, three-line source/distribution
  patch recognizing that exact name as well. Keep the selected wire model name;
  do not reroute to a retired alias. Other model-name behavior is unchanged.
  Remove the patch only after an upstream version passes the same wire tests.

## Validation and limits

HTTP-body tests cover OpenAI Responses, DeepSeek Chat and both compatible APIs.
DeepSeek tests cover current and legacy Flash names, preserving previous reasoning
and completed tool pairs before the final directive. Core tests retain the total
step/effect limits and canonical history; context tests reject oversized control
messages with and without continuation. Deterministic tests are separate from
real-model and installed-app acceptance.

The [DeepSeek thinking guide](https://api-docs.deepseek.com/guides/thinking_mode/)
requires reasoning passback for requests carrying tools, and its
[current integration guide](https://api-docs.deepseek.com/quick_start/agent_integrations/)
identifies deepseek-flash as the current name. The SDK patch implements that name
recognition; it does not promise endpoint compliance or accurate answers. Future
SDK upgrades must verify the patch and serialization rather than assuming it is
still needed. Investigation prioritization and full product gates remain separate.
