# Forge v0.2.0 release notes

Release date: 2026-08-23

Forge v0.2.0 is the first minor release after the v0.1 runtime and evaluation
baseline. It turns the small, evaluated coding-agent loop into a broader,
provider-aware CLI with persistent sessions, controlled extensions, and an
inspectable context budget.

## Highlights

- Added OpenAI API and user-configured OpenAI-compatible provider routes,
  including bounded model discovery, capability metadata, bearer and auth-free
  loopback modes, and separate model/reasoning-effort selection.
- Added experimental DeepSeek vision input and the CLI attachment flow for
  JPEG, PNG, GIF, and WebP images.
- Added the Codex Engine integration through the official Codex App Server,
  subscription-aware login, session creation/resume, and provider-exposed
  reasoning-summary persistence without fabricating hidden reasoning.
- Added budgeted context management: `/context`, manual `/compact`, durable
  checkpoints, bounded active history, overflow recovery, and deterministic
  safety/reduction gates.
- Added a plugin API with project trust, capability declarations, policy hooks,
  custom tools, and opt-in web-tool examples while keeping plugin code
  explicitly trusted local code.
- Improved the interactive terminal with the Forge header, model and effort
  controls, image paste/drop handling, clickable sign-in URLs, Markdown and
  diff presentation, and clearer keyboard guidance.
- Expanded configuration, authentication, persistence, security, architecture,
  evaluation, plugin, and CLI documentation, including a complete Simplified
  Chinese documentation mirror.

## Verification

The release is backed by the checked-in deterministic suite and the v0.2
context-management gate:

- `CI=true pnpm build`
- `CI=true pnpm check`
- `CI=true pnpm test`
- `CI=true pnpm eval:deterministic`
- `pnpm forge --version` prints `0.2.0`

The v0.2 context gate reports zero safety-invariant regressions, zero
transcript-corruption cases, zero known over-budget calls sent, 100% seeded
durable-constraint recall, zero historical approvals restored, at least 30%
long-session input reduction, and zero duplicate tool actions during clean
overflow recovery. Its provider-tokenizer error, paid-provider latency, and
live task-quality comparisons remain deferred.

## Honest limits

Automatic context checkpoint generation remains opt-in (`context.mode=compact`);
the evidence-based default is still `warn`. Native Anthropic and Gemini
protocols, stronger process isolation, multi-agent orchestration, semantic
retrieval, cloud execution, and cross-machine session synchronization are not
part of this release. Live model behavior remains nondeterministic, and the
v0.1 live evaluation's seven-of-nine result should not be interpreted as a
v0.2 provider-quality benchmark.

See the [context-management gate](CONTEXT_MANAGEMENT.md), the
[evaluation guide](../../docs/EVALUATION.md), and the
[v0.1 report](../v0.1/report.md) for the underlying evidence.
