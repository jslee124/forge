# Forge v0.3.2 Milestone 13 baseline

This checked-in baseline freezes the existing deterministic long-session
fixture before Milestone 13 changes its default experience. Reproduce the
context rows with:

```sh
CI=true pnpm vitest run evals/src/context-evaluation.test.ts evals/src/m13-baseline.test.ts
```

The fixture completed in all three modes. `off` and `warn` each admitted
11,457 estimated input tokens with no compaction. The existing deterministic
`compact` oracle admitted 2,163 tokens after one checkpoint. It made no paid
provider request and therefore records cache read/write as unavailable rather
than zero. The fixture requires no approvals, so approval count and wait are
both zero.

Five local Node 24.18.0 macOS `forge --version` samples were 270, 190, 180,
190, and 190 ms (median 190 ms). The advisory update refresh is detached from
startup; its blocking latency is zero in the fake-clock contract test. These
local timing samples are comparison evidence, not a cross-machine performance
guarantee.

The machine-readable values live in [M13_BASELINE.json](M13_BASELINE.json).
