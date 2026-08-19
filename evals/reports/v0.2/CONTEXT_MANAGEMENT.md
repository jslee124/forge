# Milestone 10 context-management release gate

Date: 2026-08-19

Forge keeps `context.mode=warn` as the default. Automatic checkpoint generation
remains opt-in (`compact`) because deterministic safety and reduction gates pass,
but provider-tokenizer error and live task-quality gates have not yet been measured
across paid providers.

## Deterministic results

| Gate | Result |
| --- | --- |
| Safety-invariant regressions | 0 |
| Transcript corruption after checkpoint/save/resume | 0 |
| Known mandatory over-budget calls sent | 0 |
| Seeded durable-constraint recall | 100% |
| Historical approval restored | 0 |
| Long-session input reduction | at least 30% |
| Duplicate tool actions during clean overflow recovery | 0 by construction and runtime test |

The suite covers long recall, fresh-instruction precedence, hostile history,
checkpoint resume/provenance, tool-result pressure, schema cost, mandatory
overflow, and the Forge-owned Codex wrapper. All estimators are deterministic and
make no provider calls.

## Deferred live gates

- Provider-reported estimator error distribution
- Paid-provider latency and summary cost
- Task pass-rate comparison across `off`, `warn`, and `compact`

Until those are published, `warn` remains the evidence-based default and manual
`/compact` is the recommended checkpoint workflow.
