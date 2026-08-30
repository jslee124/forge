# Forge v0.3.3 post-fix release gates

[简体中文](POST_FIX_RELEASE_GATES.zh-CN.md)

Evidence date: 2026-08-30
Candidate base commit: `782de378716961c34bce630a90038d8a383612a9`

## Evidence boundary

This report records the local release-candidate working tree after repairing
the approval-UI timing test and adding release documentation. The changes must
be committed, pushed, and verified by Linux CI before this evidence can be
attached to an immutable release tag.

The separately recorded [live provider resume smoke](LIVE_PROVIDER_RESUME_SMOKE.md)
covered native DeepSeek and Luna Codex Engine resume. No OpenAI API call,
branch merge, tag creation, push, npm publish, or post-publication installation
was performed.

## Resolved pre-fix findings

- Session persistence rejects a redacted snapshot above the durable size limit
  before replacing the prior valid file.
- Failed and cancelled runs retain a bounded, authority-free outcome; completed
  or failed tool side effects that were not returned to the model are called
  out without fabricating a canonical tool pair.
- Process approval examines executable basenames and treats common wrappers
  conservatively, preventing destructive commands from receiving reusable
  session approval.
- Canonical tool-call pairing is scoped by run and step, so independent runs
  may safely reuse provider wire IDs.
- The publish workflow selects `latest` for stable versions and `next` for
  prereleases.
- Approval preview tests wait for observable UI state instead of assuming the
  state is available after a fixed 30 ms delay.
- Provider-protocol SDK dependencies use exact tested versions. This prevents
  the public artifact from drifting to an upstream patch whose dependency is
  not present in the npm registry.

## Current local matrix

The final results for this working tree are recorded after all documentation
and test changes are present:

| Gate | Result |
| --- | --- |
| `CI=true pnpm check` | Passed; 231 files, with two non-failing Biome information notices |
| `CI=true pnpm check:docs` | Passed; 96 Markdown files and 418 local references |
| `CI=true pnpm test` | Passed; 56 files and 350 tests |
| `CI=true pnpm eval:deterministic` | Passed; 12 files and 69 tests |
| `CI=true pnpm package:verify` | Passed; clean installed package size 331,218 bytes |
| `CI=true pnpm release:verify-tag -- v0.3.3` | Passed; all package and runtime versions match |
| `pnpm audit --prod --audit-level low` | Passed; no known vulnerabilities |
| `git diff --check` | Passed |

The first clean-package attempt exposed that the range
`@ai-sdk/deepseek@^3.0.28` selected upstream `3.0.37`, which declared the
unpublished dependency `@ai-sdk/provider@4.0.9`. Forge now publishes exact
tested versions for `@ai-sdk/deepseek`, `@ai-sdk/openai`, and `ai`; the clean
install was rerun with an isolated npm cache and passed.

## Stable-release conditions still requiring external evidence

1. Commit and push the candidate changes, then obtain green Linux CI for the
   exact commit.
2. Run a separately authorized compatible-route smoke when live compatible
   behavior is part of the stable-release claim. Native OpenAI API remains
   intentionally untested because no API key is available.
3. Merge the reviewed candidate into `main` and rerun the matrix on the exact
   merge commit.
4. Create the immutable annotated tag only after the prior conditions pass.
5. After trusted publishing completes, verify npm dist-tags, a public clean
   install, bundled Skills/docs, and update behavior.

Until those external conditions pass, this tree is an offline release candidate
and must not be described as a published or live-provider-validated stable
release.
