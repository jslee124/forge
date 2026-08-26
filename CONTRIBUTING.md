# Contributing to Forge

[简体中文](CONTRIBUTING.zh-CN.md) · [Documentation index](docs/README.md)

Forge is a learning-oriented coding-agent project, but changes are held to a
production-style standard: the smallest complete behavior, an explicit safety
boundary, deterministic tests, and evidence that matches the claim.

## Before you start

- Read [Getting started](docs/GETTING_STARTED.md) and run the checkout once.
- Read [Security](docs/SECURITY.md) before changing tools, approvals, plugins,
  credentials, persistence, network behavior, or delegated model runs.
- Check the [Roadmap](docs/ROADMAP.md) for completed acceptance criteria and
  deferred scope.
- For a bug, preserve a minimal reproduction and the first actionable error.
- For a feature, define the user-visible outcome and how it will be verified
  before adding a new abstraction or dependency.

## Development setup

```bash
git clone https://github.com/jslee124/forge.git
cd forge
pnpm install --frozen-lockfile
pnpm build
pnpm check
pnpm test
```

Requirements are Node.js 24 or newer and pnpm 11.18.0. The root is a private
ESM pnpm workspace using TypeScript project references.

Default build, check, test, and deterministic-evaluation commands do not make
paid model requests. Never use a real API key in a test fixture or committed
configuration.

## Repository map

```text
apps/cli/                 Commander commands, Ink UI, provider assembly
packages/core/            Agent loop, events, context, policy contracts
packages/tools/           Bounded workspace and structured process tools
packages/config/          Schema, merge rules, provenance, instructions
packages/auth/            API-key resolution and owner-only file store
packages/persistence/     Session snapshots, JSONL traces, redaction
packages/plugin-api/      Plugin discovery, trust, host, and API v1
packages/model-*/         Provider and protocol adapters
packages/codex-app-server Codex JSON-RPC and account boundary
fixtures/                 Small repositories used by integration/evaluation
evals/                    Manifests, external graders, runners, reports
examples/plugins/         Optional extension examples, not core defaults
docs/                     English canonical guides and Chinese entry points
```

Dependency direction matters. The CLI may assemble packages, but core must not
import terminal rendering, a provider implementation, or a plugin
implementation. Providers own protocol translation; core owns the multi-step
loop, policy, limits, lifecycle, and events.

## Change workflow

1. Start from a focused problem and identify the current call path.
2. Add or update a deterministic test that proves the failure or acceptance
   criterion.
3. Implement the smallest complete change at the package that owns the
   behavior.
4. Preserve structured errors, cancellation, limits, policy decisions, and
   trace evidence across failure paths.
5. Update every affected user-facing guide, example, and Chinese entry point.
6. Run the narrow test while iterating, then the appropriate repository gates.
7. Review the diff for unrelated generated files, secrets, stale claims, and
   accidental safety widening.

Do not make a live provider call merely to prove logic that a fake adapter or
mock transport can cover. When provider behavior itself is the question, mark
the call as paid/remote, use explicit opt-in, and report its model/date/limits
without deleting failed evidence.

## Verification matrix

| Change | Minimum verification |
| --- | --- |
| Documentation only | `pnpm check:docs` and `git diff --check` |
| TypeScript implementation | Focused test, `pnpm build`, `pnpm check`, `pnpm test` |
| Configuration or CLI flags | Above, plus `pnpm forge --help`, `pnpm forge config validate`, and relevant command help |
| Tool, policy, plugin, or security boundary | Above, plus negative/denial and cancellation coverage |
| Evaluation harness | `pnpm eval:deterministic`; live trials only with explicit provider opt-in |
| Terminal UI | Focused Ink render/interaction tests, then full build/check/test |

Useful root commands:

```bash
pnpm build
pnpm check
pnpm check:docs
pnpm test
pnpm eval:deterministic
pnpm forge --help
```

Use `CI=true pnpm install --frozen-lockfile` when pnpm is running without an
interactive terminal and needs to recreate dependencies.

## Safety invariants

A contribution must not weaken these boundaries accidentally:

- Every model-proposed tool action is validated, evaluated by policy, and
  recorded before execution.
- Built-in file tools remain inside the canonical workspace, including through
  symlink resolution.
- Process commands remain structured `program + args[]` with `shell: false`,
  timeout, cancellation, and bounded output.
- A missing approval channel fails closed.
- Project configuration, instructions, Skills, and plugin policy hooks cannot
  widen the user's permission boundary.
- Project plugin code is not imported before explicit canonical-workspace trust.
- Plugin capabilities and approvals are never described as OS isolation.
- Credentials never enter prompts, events, traces, errors, examples, or
  repository files.
- Resume restores completed conversation, not old approvals or pending
  executable state.
- Checkpoints are derived untrusted memory; the canonical transcript and fresh
  instructions remain authoritative.
- Forge displays only provider-exposed reasoning text and never invents hidden
  chain of thought.

When a change intentionally revises one of these invariants, update the
security model and add an explicit reviewable acceptance test.

## Tests and fixtures

- Prefer a deterministic fake model for runtime state and recovery behavior.
- Prefer fake HTTP/App Server transports for authentication and provider
  protocol behavior.
- Create temporary workspaces for file tools; cover traversal, symlinks,
  concurrent edits, truncation, and cancellation where relevant.
- Keep fixture defects small and semantic. The fixture's visible tests and the
  external grader should fail before the reference fix and pass afterward.
- A model message claiming success is not proof. Verify terminal run status and
  the fixture/grader result.
- Never loosen an evaluation approval merely to make a failed live trial pass.

## Documentation style

- Lead with the reader's outcome, then explain the boundary and commands.
- Write commands that work from a stated directory and distinguish `pnpm forge`
  from a globally linked `forge` command.
- Distinguish implemented behavior, opt-in behavior, examples, plans, and
  historical release contracts.
- Keep API-key access separate from ChatGPT subscription access, and Forge
  Engine behavior separate from Codex Engine behavior.
- Treat `web_search`, `web_fetch`, MCP, to-dos, and subagents as optional plugin
  examples unless core implements them.
- Update English canonical pages and the corresponding Chinese navigation or
  translation in the same change.
- Run `pnpm check:docs` so relative files, fragments, and local image links do
  not drift.

## Pull request checklist

- [ ] The change has one clear user-visible or architectural outcome.
- [ ] Tests cover success and the important failure/denial path.
- [ ] `pnpm build`, `pnpm check`, and `pnpm test` pass when code changed.
- [ ] `pnpm check:docs` and `git diff --check` pass.
- [ ] No real credentials, private traces, generated artifacts, or unrelated
      workspace changes are included.
- [ ] Documentation states current behavior and honest limitations.
- [ ] Paid or remote validation, if any, is explicitly identified and does not
      replace deterministic coverage.

## Reporting a security issue

Do not post API keys, OAuth data, private repository content, or an unredacted
run trace in a public issue. Provide the smallest sanitized reproduction and
identify the affected boundary. Until a private reporting channel is published,
avoid sharing exploit details that would expose another user's data or system.

Forge is not an operating-system sandbox. A report about an approved process or
trusted plugin having user-level privileges should distinguish that documented
limit from a bypass of Forge's own workspace, policy, trust, or redaction
controls.
