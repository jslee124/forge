# Evaluation Guide

## Purpose

Forge separates deterministic runtime correctness from live-model capability.
The default test suite never makes a paid request. Live DeepSeek trials are a
separate, explicit operation whose failures remain part of the report.

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
export DEEPSEEK_API_KEY="your-api-key"
FORGE_EVAL_LIVE=1 pnpm eval:live
```

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

The default `deepseek-v4-flash` ID was revalidated on 2026-08-19 against the
[official DeepSeek API documentation](https://api-docs.deepseek.com/api/create-chat-completion).
The API currently lists `deepseek-v4-flash` and `deepseek-v4-pro`; thinking mode
is selected explicitly by Forge.

## v0.1 evidence

The 2026-08-19 release evaluation used `deepseek-v4-flash` with thinking enabled
at Forge commit `65c0a51`. It recorded nine fresh trials and passed seven:

| Task | Passed | Pass rate |
| --- | ---: | ---: |
| `config-merge` | 3/3 | 100.0% |
| `retry-cache` | 2/3 | 66.7% |
| `validation-bug` | 2/3 | 66.7% |

The two failed runs are intentionally retained. In both, the patch reached the
grader, but the model requested `timeoutMs: 120000`; the narrow evaluation
approval allowed only 60000ms and Forge denied the command. One failed
`validation-bug` patch also failed the hidden grader.

The [published JSON report](../evals/reports/v0.1/report.json),
[Markdown summary](../evals/reports/v0.1/report.md), and all nine JSONL traces
are checked in. Every trace was revalidated for schema, sequence, run ID, and
terminal-status consistency, and the configured API key was not present.
