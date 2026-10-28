# Evaluation Guide

[简体中文](../zh-CN/development/EVALUATION.md) · [Documentation index](../README.md)

## Purpose

Forge separates deterministic runtime correctness from live-model capability.
The default test suite never makes a paid request. Live DeepSeek trials are a
separate, explicit operation whose failures remain part of the report.

Private outputs and source snapshots under `evals/artifacts/` are evidence, not
current test inputs. TypeScript test checking and Vitest discovery exclude that
directory while retaining their normal dependency exclusions; keep snapshots
intact instead of executing them or deleting them to make validation pass.

## Tasks

Versioned manifests live under `evals/tasks/`. Every trial starts from a fresh
temporary copy of one fixture:

| Task | Defect | Main behavior under test |
| --- | --- | --- |
| `validation-bug` | permissive port parsing | inspect, patch, verify, and recover |
| `retry-cache` | rejected promise remains cached | concurrency and failure cleanup |
| `config-merge` | `||` discards explicit falsy values | targeted semantic correction |

Each fixture owns visible tests. A second grader under `evals/graders/` runs
outside the copied Agent workspace after Forge exits. Built-in tools therefore
cannot inspect or edit that grader during the trial.

## Deterministic evidence

Run the fake-model recovery scenario and grader contract tests:

```bash
pnpm eval:deterministic
```

The recovery adapter deliberately applies an incomplete fix, observes a failing
verification command, corrects the patch, reruns verification, and finishes
only after it passes. The grader tests also prove that every original fixture
fails and every reference fix passes both visible and external checks.

The release run on 2026-08-19 passed 2 test files and 8 tests. This is
runtime evidence, not a claim about live model success.

The checked-in terminal recording can be replayed with:

```bash
asciinema play docs/forge-eval.cast
```

## Live DeepSeek trials

Live trials require both the `--live` CLI route and an explicit environment
acknowledgement. The root script supplies `--live`; the environment variable
prevents an accidental paid run:

```bash
FORGE_EVAL_LIVE=1 pnpm eval:live
```

The evaluator uses the same DeepSeek credential resolution as Forge:
`DEEPSEEK_API_KEY` takes precedence, then the owner-readable credential saved
by `/login`. The resolved key is passed only to the isolated run process and is
not written to reports or traces.

Milestone 15 file-edit selection comparisons use the same opt-in guard and
task/trial settings. Run separate, clearly labeled output directories for
`--edit-contract legacy`, `union`, and `flat`; the legacy contract exists only
inside this evaluator and is never advertised by the normal CLI. Compare task
success, first write-call accuracy, invalid/failed writes, approvals, steps,
tokens, and the final filesystem grader before selecting a schema.

The selected product encoding is `flat`: one `edit_file` object with an
`operation` enum and optional branch fields, followed by strict runtime
cross-field validation. The evaluator retains `legacy` and `union` only as
comparison contracts; an omitted `--edit-contract` uses `flat`.

The default is three trials for each of the three tasks. Start with one paid
smoke trial when validating credentials or provider behavior:

```bash
FORGE_EVAL_LIVE=1 pnpm eval:live \
  --task validation-bug \
  --trials 1
```

Repeat `--task` to select multiple tasks. `--model`, `--thinking`, and
`--output` override their defaults. A release run must use a clean Git checkout
so its recorded commit identifies the exact evaluated code.

During development, `--allow-dirty` permits a non-release trial and records the
base commit plus a SHA-256 worktree fingerprint. Such output must not be copied
to `evals/reports/` or presented as exact-HEAD release evidence.

The runner grants the first workspace write and only the exact structured
verification command `pnpm test` from the fixture root with a 60-second timeout.
Every other process proposal is denied. The runner appends this constraint to
the task prompt so the model knows which verification command is available.

## Reports and traces

Local output defaults to the ignored `evals/artifacts/<timestamp>/` directory:

```text
evals/artifacts/<timestamp>/
|-- report.json
|-- report.md
`-- traces/
    `-- <run-id>.jsonl
```

JSON reports record the Forge commit, task, trial number, model ID, thinking
mode, status, grader result, duration, model steps, tool calls, token usage,
failed verification attempts, denied actions, reached limits, and trace path.
Markdown reports aggregate pass rate and averages without deleting failures.

Before publishing, copy the selected redacted report into `evals/reports/v0.1/`
and verify every referenced trace with `forge inspect <run-id>`. Raw traces may
contain repository data and should be reviewed before publication.

## Current provider model

The default `deepseek-flash` ID follows the current [DeepSeek model table](https://api-docs.deepseek.com/quick_start/pricing/) and [vision guide](https://api-docs.deepseek.com/guides/vision/). It supports Chat Completions image input; Forge keeps the retired `deepseek-v4-flash` and `deepseek-v4-flash-vision-exp` IDs as compatibility aliases for existing configurations and sessions. `deepseek-v4-pro` remains selectable but rejects images. Thinking mode is selected explicitly by Forge. Offline transport tests do not establish paid live-provider behavior. The v0.1 evidence below is historical.

## v0.1 evidence

The 2026-08-19 release evaluation (Beijing time) used `deepseek-v4-flash`
with thinking enabled at Forge commit `65c0a51`. Three small TypeScript repair
tasks ran three fresh trials each: seven of nine passed end to end. A trial
passes only when its status is `completed` and both the fixture-owned tests and
external hidden grader pass. This historical small-sample baseline used the
then-current `apply_patch` contract; it does not establish general coding
capability for the current version.

| Task | Passed | Pass rate |
| --- | ---: | ---: |
| `config-merge` | 3/3 | 100.0% |
| `retry-cache` | 2/3 | 66.7% |
| `validation-bug` | 2/3 | 66.7% |

Both unsuccessful runs remain in the [original JSON report](../../evals/reports/v0.1/report.json).
Their termination status and post-run grading describe different facts:

| Task and trial | Run status | Post-run public tests | Post-run hidden tests | Trace |
| --- | --- | --- | --- | --- |
| `retry-cache` trial 1 | `denied` | Passed | Passed | [16c7e4a1](../../evals/reports/v0.1/traces/16c7e4a1-02cf-45f3-bf9c-f97a7e9020d1.jsonl) |
| `validation-bug` trial 2 | `denied` | Passed | Failed | [d7547e89](../../evals/reports/v0.1/traces/d7547e89-f74c-4392-b502-ef75018ee462.jsonl) |

Both traces record a command request with `timeoutMs: 120000`. The narrow
evaluation approval allowed only 60000ms, so the command was not approved and
the run ended as `denied`; this was not a command timing out after 60 seconds.
The `retry-cache` patch passed post-run tests, but its run did not complete and
therefore did not pass end to end. The `validation-bug` patch also failed the
hidden grader. Approval denial and repair failure are not mutually exclusive
categories, and the first result is not a grader false positive.

The [Markdown summary](../../evals/reports/v0.1/report.md) and all nine JSONL
traces are checked in. At publication, every trace was revalidated for schema,
sequence, run ID, and terminal-status consistency, and the configured API key
was not present. These are historical publication checks, not a new live run.

## Milestone 10 context gate

The default suite compares `off`, `manual`, and `automatic` on the same synthetic
long-session transcript without a provider call. It records task success,
estimated and fake-provider-reported input, estimation error, local latency,
compaction count, retained turns, and summary regeneration. Separate runtime
fixtures cover mandatory overflow, clean one-shot recovery, partial-output
non-retry, tool-result projection, hostile history, and resume integrity.

See the [Milestone 10 release gate](../../evals/reports/v0.2/CONTEXT_MANAGEMENT.md).
`manual` remains the permanent default; paid-provider estimator and task-quality gates
are published.

Milestone 13 adds the checked-in
[v0.3.2 comparison baseline](../../evals/reports/v0.3.2/M13_BASELINE.md), stable
prefix/invalidation fixtures, unavailable-versus-zero cache accounting,
pressure-triggered compaction, low-reclamation pause, and session/default mode
tests. All remain offline. Automatic compaction is discoverable and opt-in;
the baseline does not promote the extractive oracle to the default.

The [v0.3.3 Milestone 13 release-gate report](../../evals/reports/v0.3.3/M13_RELEASE_GATES.md)
adds exact/near-match permission scopes, denial feedback, canonical workspace
and high-risk rejection, asynchronous update delivery and dismissal,
installation provenance, protected `FORGE_HOME` fixtures, and narrow/wide Ink
rendering. It records that live trials require explicit `eval:live` opt-in and
that no paid call was made for the offline gate. That report predates Milestone
14 structured history and is historical M13-only evidence. The current
deterministic release matrix also runs the
[cross-layer session contract](../../evals/src/session-contract.test.ts), which
exercises runtime canonical deltas through save/load, resume projection,
checkpoint validation, cancellation outcome recovery, repeated provider call
IDs, non-restored approval state, and durable-size rejection.

Resource evaluation is deterministic and offline by default. Scripted fixtures cover matching, non-matching, ambiguous, explicit, user-disabled, collision, repeated-load, over-budget, adversarial Skill, product-question, and unsupported-question cases. Metrics include selection precision and recall, unnecessary loads, catalog and loaded tokens, citation accuracy, latency, and task completion. Live-provider resource trials remain explicit opt-in.

## Fixed-observation negative-evidence diagnostic

The [comparison runner](../../evals/scripts/compare-negative-evidence.mjs) isolates
requested model ID (deepseek-flash / deepseek-v4-pro) and context framing (paired
tool history / the same observations in an untrusted evidence packet). Each of
four cells has two samples in a predeclared counterbalanced order. It uses the
frozen Q06 question, a depth-1 file listing and literal analytics search, reusing
the native investigation instructions without rewriting them. This is synthetic
history projection, not a replay of original provider requests or Desktop acceptance.

```bash
CI=true pnpm eval:negative-evidence --prepare --output /tmp/forge-negative-compare-new
CI=true pnpm eval:negative-evidence --check --output /tmp/forge-negative-compare-new
CI=true pnpm eval:negative-evidence --fixture --output /tmp/forge-negative-compare-new
# Explicit opt-in paid diagnostic; no model configuration or installation is changed:
CI=true pnpm eval:negative-evidence --live --output /tmp/forge-negative-compare-new
```

Prepare/check/fixture do not read credentials or contact providers. Live caps the
batch at eight requests, one per sample, 4096 output tokens each and 90 seconds
per request, with no tool executor, redirects or additional HTTP retries. Errors
stop the batch, except invalid/incomplete model output, which is recorded for that cell
while other predeclared independent cells continue. No failed cell is retried.
Existing attempts are never overwritten. Changed input, script,
policy, schema or source revision requires a fresh preparation. Request bodies,
reported usage and answers are retained; authentication headers and generated
reasoning text are not saved. Semantic review stays separate from stop/prose
validity. Requested/returned model labels do not prove distinct backend weights,
and two samples per cell do not establish general model reliability or user success.

## Experimental evidence finalization and reviewed summary

Prepare Desktop pilot rounds outside any ancestor Git repository, normally under
`/tmp`. Forge resolves a nested working directory to its enclosing Git workspace;
an isolated `FORGE_HOME` alone does not isolate that workspace, project settings
or repository instructions. Do not add a Git marker to a frozen fixture to hide
this mismatch. `product-live.mjs` resolves the application's canonical workspace
identity for every selected task/round before any credential read, including
`--check` and local fixtures, and checks again before each execution. It rejects
a root different from the fixture directory and records the identity in the
check plan. This is a preflight check, not filesystem isolation against later
external changes. Retain contaminated attempts with a separate invalidation
record; do not turn them into baseline passes or overwrite their raw artifacts.

The real Desktop pilot accepts `--finalization-input continuation|evidence`;
default remains continuation. Only the isolated pilot's explicit host override
selects evidence input. Prepare fresh directories per mode/round, then use:

```bash
node apps/desktop/scripts/product-live.mjs --check --task E01 --task F03 --finalization-input evidence --recover-summary --round /tmp/fresh-evidence-round
```

Live execution of that same selection is explicit paid opt-in and must run from
apps/desktop (as existing pilot commands require). `--recover-summary` adds a
separate reviewed/confirmed one-step, zero-tool summary after each selected E01
or F03 run; it does not change source task budgets or automatically recover the
product. Original pilot-result/events stay immutable; recovery-result and review/
summary screenshots are separate, and projection-observation records trace intent
plus whether that model step started. A source run finishing early does not test
the reserved projection. Check command exit/verification, edit scope, independent
port assertions, source links, unknown outcomes and preserved draft separately.

### Bounded repair acceptance

Opt-in `desktop-product-faults-v5` adds model-authored regression tests for E01
(port validation) and E03 (duplicate submission and recovery). Prepare a fresh
round with that protocol, then use the direct Desktop launcher:

```bash
node apps/desktop/scripts/product-live.mjs --check --repair-acceptance --round /tmp/fresh-repair-round --task E01 --task E03
```

After prior user authorization for external calls, `--live` uses the same inputs
and flag. The profile has explicit ceilings of 16 model steps / 32 tool calls and
a 300-second host deadline per task (330-second launcher watchdog). This bounds
an experiment, not the monetary bill. It cannot combine with `--product-defaults`
and rejects other tasks or protocols before credentials. This profile does not
accept `--recover-summary`; request a summary as a separate reviewed operation.
The matrix launcher
still prepares bounded six-step diagnostics; it does not select this profile.

Only `workflow.mjs` and a model-created `regression.test.mjs` may be written.
Only the exact cwd-local `node --test regression.test.mjs` command is approved;
E01 additionally permits the separate original `node --test fixture.test.mjs`.
Original tests remain read-only. The frozen seed and original task prompts are
unchanged; no assertions or reference solution are provided. The supplemented
procedure/permissions make this a new protocol, not an unchanged baseline retry.
Require observed relevant red/green assertions with preserved test bytes,
independent behavioral probes and separate source/answer review. Keep the old
six-step E01 attempt partial, without rewriting its result. Product policies,
runtime guidance and previous protocols are unchanged.

### Product-default repair pilot

The opt-in Desktop launcher `apps/desktop/scripts/product-live.mjs` accepts
`--product-defaults` for E01/E02/E04/E05/D05 only. Both `--check` and `--live` must use
the flag. The isolated config omits total limits, using current product defaults
instead of the bounded six-step scenario. Plans and results record nullable
limits and the execution profile; bounded protocols and F03 are unchanged.
For faults-v3 E04 only the six-step wording is replaced; the regression-first
procedure and exact command/file approval scope remain unchanged.

A 600-second host experiment deadline and 630-second launcher watchdog bound
each attempt; these are test controls, not production total-count limits or a
monetary budget. Record interruption as failure, not completion. Fresh seeds,
no automatic whole-task retries, independent behavioral probes and source review
remain required. External calls require prior user authorization; `--check`
does not access credentials or call providers. Three sampled tasks cannot close
the 24-task/two-round or independent-user product gate.

### Held-out regression-contract diagnostic

Opt-in `desktop-product-faults-v4` permits E02/E05 to create their own
`regression.test.mjs` and edit only `workflow.mjs`. Only the exact cwd-local
`node --test regression.test.mjs` process is approved. The seed is unchanged; no
assertions, reference implementation or contract-map template is supplied.
Other tasks/protocols keep their existing authority. Pre-command source/test
hashes, red/green observations and separate independent probes use the existing
observer; a mechanical regression cycle does not establish task correctness.

For a guidance comparison, freeze two new tasks and run one fresh attempt per
task at each source version, with `--product-defaults`, the same model, prompts,
permissions and 10-minute experiment deadline. Retain all four attempts without
retrying to chase success. Review assertion relevance and preserved behavior,
not only exit codes or a completed runtime outcome. Such small nondeterministic
samples cannot establish a causal improvement or overall success rate. `--check`
validates the fixture and declares the plan without credentials/provider calls.

### Native response-language diagnostic

`evals/scripts/response-language.mjs` offers `--prepare`, `--fixture`, and opt-in
`--live`, with a fresh `--output` directory. Three fixed synthetic prompts cover
Chinese with English identifiers, an explicit English reply requested in Chinese,
and an English request. Preparation pins source, policy hash, prompts and model
without credentials or provider calls. Fixture results are scripted plumbing
evidence, never language-compliance measurements.

The shared `runTask` path is used with one model response per case. The diagnostic
adapter removes all tool definitions, requests `toolChoice=none`, and rejects
tool-call events before execution; no business workspace or history is supplied.
Live mode reads credentials only after input checks and explicit opt-in, retains
each result and stops on failure without whole-case retries. Reusing an attempted
directory is rejected before credential access. Human review checks language,
literal preservation and requested format separately from runtime completion.
HTTP attempts/retries and billing are not inferred from logical response counts.
These one-turn samples are not real Desktop coding-task or Codex acceptance.

The native policy also derives a narrow language hint from unambiguous English
or Chinese reply-language prefixes in the current user prompt. Quoted/code/log
text, negative directives, multiple recognized directives and alternative
languages do not select this hint. Unsupported phrasing/languages keep general
model guidance; this is not a complete natural-language intent parser or an
automatic translation guarantee. Reviewed recovery-summary locale is unchanged.

Use repeatable `--case` selections for a fresh targeted plan, for example
`--case explicit-en --case quoted-en`. The quoted case asks in Chinese about a
`Respond in English` log entry. Case-specific assembled-policy hashes are pinned.
Initial failed answers stay in their original directory; any paid follow-up is
a separately disclosed, explicitly authorized attempt, not an automatic retry.
