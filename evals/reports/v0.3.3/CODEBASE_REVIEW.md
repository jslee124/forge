# Forge v0.3.3 Codebase Review and Release Readiness

[简体中文](CODEBASE_REVIEW.zh-CN.md) · [Documentation index](../../../docs/README.md)

> **Evidence snapshot:** this review records commit `5b24a2e` before the
> post-review fixes. Its findings and release recommendation are historical and
> must not be treated as the current tree's status.

## Review snapshot

- Review date: 2026-08-30
- Reviewed branch: `dev`
- Reviewed commit: `5b24a2e`
- Source version: `0.3.3`
- Working tree at review time: clean
- Remote state at review time:
  - `origin/dev` matched `5b24a2e`
  - `origin/main` remained at `6e6c43b`, the v0.3.2 integration commit
  - no remote `v0.3.3` tag existed
- npm state at review time:
  - `latest` was `0.3.2`
  - published versions were `0.3.0-bootstrap.0`, `0.3.0`, `0.3.1`, and `0.3.2`

This document records a repository-wide, read-only review of the current Forge
development tree. It distinguishes deterministic validation from live-provider
or publication evidence. No source files were changed as part of the review.

## Release recommendation

**Do not publish the current tree as a stable Forge release yet.**

The build, offline test, documentation, packaging, and public-artifact gates are
healthy. However, the review reproduced three release-blocking correctness or
safety defects and one important provider-compatibility defect in the newly
landed structured-session path. Fix these findings and rerun the complete
release matrix before creating a release tag.

Because the change from v0.3.2 includes Milestone 13 and Milestone 14, session
schema v3, checkpoint v2, and substantial runtime/TUI behavior, `0.4.0` would
communicate the scope more clearly than a patch release. Keeping `0.3.3` is
possible during pre-1.0 development, but it should be described as a feature
release rather than a small defect fix.

## Findings

### P1: a successfully saved session can immediately become unreadable

`packages/persistence/src/session-store.ts` enforces the 4 MiB
`MAX_SESSION_BYTES` limit only during `load()`. `save()` serializes and replaces
the session file without checking the final byte length.

Minimal reproduction result:

```text
serializedApproxBytes: 5400920
save: succeeded
load: PersistenceError: Session <id> exceeds the size limit.
```

This is especially important for the long-session release because canonical
history is append-only and bounded tool results can accumulate until a session
cannot be resumed.

Required action:

- Check the final redacted serialized size before replacing the previous valid
  snapshot.
- Return an actionable error without destroying resumability.
- Define a retention, segmentation, or archival strategy for sessions that
  approach the durable size limit.
- Add a regression test covering save/load symmetry at and above the limit.

### P1: cancellation after a completed tool drops side-effect context

The runtime stores a tool exchange in `canonicalDelta` only after the result is
ready to be returned to the next model step. If cancellation occurs after the
tool emitted `tool.completed` but before that commit point, `finish()` writes a
generic cancelled outcome without mentioning the completed side effect.

The reproduced event stream contained:

```text
tool.started
tool.completed
run.cancelled
```

The resulting canonical history contained only the original user message and a
generic `Status: cancelled` assistant outcome. A resumed model could therefore
repeat an operation whose filesystem or process side effect already happened.

Required action:

- Do not fabricate a tool-call/result pair that was never returned to the
  model.
- Add a bounded, authority-free outcome summary describing completed or failed
  tools whose effects occurred before cancellation.
- Explicitly instruct the next turn to re-inspect relevant state.
- Extend the existing cancellation-between-steps test to assert persisted
  canonical context, not only status and request count.

### P1: absolute executable paths bypass destructive-command classification

High-risk classification compares the complete `program` string against names
such as `rm`, `curl`, and `sudo`. An absolute executable path therefore bypasses
the match.

Reproduced descriptor:

```json
{
  "program": "/bin/rm",
  "args": ["-rf", "build"],
  "riskFlags": [],
  "allowedScopes": ["command"]
}
```

The UI can consequently offer a reusable session grant for `/bin/rm`, contrary
to the documented rule that destructive and broad external-effect commands are
not eligible for reuse.

Required action:

- Classify normalized executable basenames as well as the original executable.
- Conservatively disallow reuse for shell, interpreter, and `env` wrappers that
  can execute a high-risk nested command.
- Add absolute-path and wrapper fixtures for destructive, credential-sensitive,
  install, publish, and network-capable commands.

### P2: provider tool-call IDs are treated as globally unique across a session

`validateCanonicalConversation()` keeps one tool-call map for the complete
session. Two independent runs that both receive a provider tool-call ID such as
`call-1` cause the second session save to fail with:

```text
Duplicate canonical tool-call ID: call-1
```

OpenAI commonly generates unique IDs, but compatible and local endpoints can
restart their call numbering for each response or request.

Required action:

- Scope call/result validation to a run or causal assistant exchange, or
  separate the durable canonical identifier from the provider wire identifier.
- Preserve the provider identifier needed for protocol replay without requiring
  it to be globally unique across independent runs.
- Add a multi-run persistence test with repeated provider call IDs.

### P2: prerelease tags publish to npm `latest`

`.github/workflows/publish.yml` triggers for every `v*` tag and always runs:

```text
npm publish --access public
```

A tag such as `v0.4.0-beta.1` would therefore update `latest`, although the
release documentation states that prereleases use the `next` dist-tag.

Required action:

- Reject prerelease versions in the stable workflow, or select `--tag next`
  when the verified version contains a prerelease component.
- Add a deterministic workflow/version-routing check.

### P2: roadmap status wording is internally inconsistent

The Roadmap header says Milestone 13 is implemented and Milestone 14 is marked
completed, while the Milestone 13 section title still says `planned`. The same
stale state appears in the Chinese Roadmap.

Required action:

- Make the English and Chinese status wording consistent.
- Clearly separate implementation, offline validation, optional live-provider
  validation, and npm publication.

## Current codebase assessment

### Strengths

- Clear workspace boundaries among core runtime, providers, persistence, CLI,
  tools, resources, authentication, and plugin APIs.
- The native agent loop, policy gateway, approval flow, and tool execution stay
  under Forge ownership rather than model SDK callbacks.
- Workspace paths are canonicalized and checked against traversal and symlink
  escapes before built-in file access.
- Process execution uses a structured program/argument contract with
  `shell: false`, bounded output, timeouts, and cancellation handling.
- Write approvals show exact diffs and reject truncated previews.
- Prompt-cache observations preserve unavailable provider metrics as unknown
  instead of reporting false zeroes or misses.
- Session grants are memory-only, scoped, inspectable, revocable, and not
  restored through resume.
- Plugins cannot loosen a core policy decision, and the documentation clearly
  states that trusted plugins are in-process code rather than sandboxed code.
- Package generation bundles private `@forge/*` implementation packages while
  retaining an allowlisted public artifact and ordinary external runtime
  dependencies.
- English, Chinese, and bundled product documentation are versioned and checked
  together.

### Maintainability risks

- `apps/cli/src/interactive-ui.tsx` has grown beyond 4,000 lines. Session
  orchestration, approval state, context/update state, transcript rendering, and
  presentational components should be separated before more UI features land.
- Session and context behavior now spans runtime, CLI, persistence, adapters,
  TUI state, traces, and documentation. Cross-layer contract tests should be
  treated as first-class release gates.
- The checked-in Milestone 13 report predates the later Milestone 14 structured
  history changes. It remains useful M13 evidence but is not sufficient evidence
  for the current HEAD by itself.

## Validation evidence for the reviewed HEAD

| Gate | Result |
| --- | --- |
| `CI=true pnpm check` | Passed; two non-failing Biome information notices |
| Full offline tests | 55 files and 342 tests passed; the three loopback tests were rerun outside the restricted sandbox |
| `CI=true pnpm eval:deterministic` | 11 files and 65 tests passed |
| `CI=true pnpm check:docs` | 83 Markdown files and 373 local references passed |
| `CI=true pnpm package:verify` | Passed; clean installed artifact size was 329,758 bytes |
| `CI=true pnpm release:verify-tag -- v0.3.3` | Passed version consistency checks |
| `pnpm audit --prod --audit-level low` | No known vulnerabilities found |
| `git diff --check` | Passed |
| GitHub Actions for `5b24a2e` | Passed |
| Live/paid provider validation | Not performed during this review |
| Git tag or npm publication | Not performed; no `v0.3.3` tag existed |

The initial full test run inside the restricted review sandbox could not bind
`127.0.0.1` and reported three provider-route hook timeouts. The exact three
tests passed when rerun with local loopback permission. This was classified as
an environment restriction rather than a product regression.

## Recommended release sequence

1. Fix the session-size, cancelled-side-effect, destructive-classification, and
   repeated-tool-ID defects.
2. Add focused regression tests for each reproduced failure.
3. Correct prerelease dist-tag routing and bilingual Roadmap status wording.
4. Rerun build, check, full offline tests, documentation checks, deterministic
   evaluations, package verification, version checks, and dependency audit.
5. Run at least one bounded tool-call/resume smoke test for OpenAI and DeepSeek;
   include a compatible route if that behavior is part of the release claim.
6. Merge `dev` into `main` and wait for the `main` CI run to pass.
7. Create an immutable annotated release tag and let the trusted-publishing
   workflow publish the reviewed commit.
8. Verify npm dist-tags, public clean installation, bundled resources, and
   update behavior after publication.

After the four runtime/persistence findings are fixed, the tree is suitable for
a release candidate. Stable publication should follow only after the complete
post-fix matrix and bounded provider-resume smoke tests pass.
