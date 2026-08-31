# Forge v0.3.4 Milestone 15 release gates

[简体中文](M15_RELEASE_GATES.zh-CN.md)

Evidence date: 2026-08-31
Exact candidate commit: `f92ebb45c94768fa47d2832ac9de7751566d1470`

## Evidence boundary

The candidate commit was checked from an isolated clean checkout. The source
checkout's uncommitted Roadmap status edits were not present, and the final
`git diff --check` and `git status --short` checks were clean.

This evidence covers the Milestone 15 implementation, offline contracts, and a
user-executed real Ghostty smoke. It does not claim an exact-commit
live-provider result, a version bump, a merge to `main`, a tag, publication, or
public installation.
The earlier authorized DeepSeek trials remain development evidence under the
ignored `evals/artifacts/` boundary and are not promoted by this report.

## Exact-candidate matrix

| Gate | Result |
| --- | --- |
| `CI=true pnpm install --frozen-lockfile` | Passed from the committed lockfile |
| `CI=true pnpm check` | Passed; 245 files, with two non-failing Biome information notices |
| `CI=true pnpm test` | Passed; 58 files and 360 tests |
| `CI=true pnpm eval:deterministic` | Passed; 13 files and 71 tests |
| `CI=true pnpm check:docs` | Passed; 102 Markdown files and 454 local references |
| `CI=true pnpm package:verify` | Passed; clean installed package size 337,200 bytes |
| `git diff --check` | Passed |
| `git status --short` | Clean |
| Real Ghostty exit/resume smoke | Passed; user-observed on 2026-08-31 |

Package verification still reports `@jslee124/forge@0.3.3`, because this is
Milestone 15 implementation evidence rather than authorization to perform the
v0.3.4 version or release workflow.

## Ghostty smoke

The user ran Forge in the real Ghostty application, completed provider turns,
exited multiple interactive sessions, and resumed the latest session with
`pnpm forge resume --last`. The resumed canonical exchange and Manual context
selector rendered correctly. No `MaxListenersExceededWarning`, keyboard
regression, or visible reflow regression appeared in the supplied terminal
capture.

Together with the repeated mocked lifecycle regression, this closes the
Milestone 15 acceptance checklist. It does not authorize or imply a v0.3.4
release.
