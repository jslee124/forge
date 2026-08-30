# Published evaluation reports

This directory is reserved for reviewed release reports. Generated local
artifacts are written to the ignored `evals/artifacts/` directory first.

- [v0.1 evaluation report](v0.1/report.md) and [release notes](v0.1/RELEASE_NOTES.md)
- [v0.2.0 release notes](v0.2/RELEASE_NOTES.md)
- [v0.2 context-management gate](v0.2/CONTEXT_MANAGEMENT.md)
- [v0.3.2 Milestone 13 baseline](v0.3.2/M13_BASELINE.md)
- [v0.3.3 Milestone 13 offline release gates](v0.3.3/M13_RELEASE_GATES.md)
  — historical M13-only evidence that predates Milestone 14 structured session
  history; current deterministic coverage also includes the
  [cross-layer session contract](../src/session-contract.test.ts)
- [v0.3.3 codebase review](v0.3.3/CODEBASE_REVIEW.md) ·
  [简体中文](v0.3.3/CODEBASE_REVIEW.zh-CN.md) — review snapshot for commit
  `5b24a2e`; its pre-fix release recommendation is historical

The v0.1 report contains the required successful and failed live trials and
parseable redacted traces. The v0.2.0 release adds deterministic context
evidence; provider-tokenizer accuracy, paid-provider latency, and live
task-quality comparisons remain explicitly deferred. The v0.3.3 report adds
offline permission, cache, update, TUI, and cross-feature gates while retaining
the explicit live-provider opt-in boundary.
