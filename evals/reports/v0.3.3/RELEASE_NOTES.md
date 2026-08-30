# Forge v0.3.3 release notes

[简体中文](RELEASE_NOTES.zh-CN.md)

Release status: candidate; not yet tagged or published
Candidate date: 2026-08-30

Forge v0.3.3 is a feature release focused on long-session reliability,
faithful resume behavior, safer approvals, and clearer terminal feedback. It
also tightens the release and documentation boundaries used to verify the
public package.

## Highlights

- Added context-pressure reporting, explicit session compaction controls,
  prompt-cache observability, and memory-only scoped session approvals.
- Replaced text-only resume reconstruction with provider-neutral canonical
  conversation history. Completed tool calls and results remain paired across
  OpenAI, DeepSeek, compatible-provider, and Codex App Server projections.
- Added session schema v3 and checkpoint v2 validation, conservative migration,
  bounded failed/cancelled outcomes, and cross-layer resume contract tests.
- Pinned the provider-protocol SDK set to the versions exercised by the Forge
  test matrix, so a public install cannot silently select an unverified or
  temporarily broken upstream patch release.
- Prevented an oversized session snapshot from replacing the previous durable
  snapshot, and kept cancelled runs aware of tool side effects that occurred
  before the model received their results.
- Hardened process approval classification for absolute executable paths and
  common shell/interpreter wrappers. Destructive and broad-effect commands
  cannot receive a reusable session scope.
- Improved the interactive approval experience with semantic file-diff rows,
  command/network/subagent previews, visible edit activity, and unavailable
  choice handling that matches the backend approval descriptor.
- Added a documentation catalog that separates current product guidance,
  current development material, historical evidence, and compatibility
  redirects. Packaged documentation and built-in Skills are verified through a
  clean installed CLI.
- Routed stable npm releases to `latest` and prereleases to `next`, with tag,
  workspace-version, runtime-version, and generated-package consistency checks.

## Compatibility and migration

- The public package still requires Node.js 24 or later.
- Existing text-only session snapshots are migrated conservatively. Historical
  tool output never restores approval, policy, trust, process, or continuation
  authority.
- Context compaction remains opt-in; the shipped default remains `warn`.
- Private `@forge/*` implementation packages remain private. The public npm
  artifact is `@jslee124/forge`.

## Verification boundary

The deterministic post-fix matrix, dependency audit, and clean package install
are recorded in [post-fix release gates](POST_FIX_RELEASE_GATES.md). The earlier
[codebase review](CODEBASE_REVIEW.md) is a historical pre-fix snapshot.

Offline tests do not establish live provider behavior. A bounded, redacted
[live resume smoke](LIVE_PROVIDER_RESUME_SMOKE.md) passed for native DeepSeek
and Luna Codex Engine through ChatGPT subscription without using the OpenAI
API. Native OpenAI API remains intentionally untested; run a separately
authorized compatible-route smoke when that route's live behavior is included
in the stable-release claim.

## Honest limits

Forge remains under active development. Automatic semantic compaction quality,
provider cache hit rates, and live model task quality are not inferred from
deterministic fixtures. Native Anthropic/Gemini protocols, stronger process
isolation, cloud execution, and cross-machine session synchronization are not
part of this release.
