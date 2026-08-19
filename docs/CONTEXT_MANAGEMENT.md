# Context Management Improvement Plan

## Status

This document is the implementation plan for Roadmap Milestone 10. It describes
planned behavior, not behavior available in the current release.

## Why this work is next

Forge already separates project instructions, completed conversation turns,
the current user request, and provider continuation data. It also bounds
instruction files, tool output, model steps, tool calls, and persisted session
size. These controls make execution inspectable, but they do not manage a
model's token window.

Today, every completed user/assistant turn is sent again on the next native
Forge request. A long session can therefore fail at the provider boundary even
when its persisted JSON remains within the session size limit. During a run,
assistant tool calls and tool results also accumulate through provider
continuation data. Forge currently has no request preflight, token-aware history
selection, durable summary checkpoint, or automatic compaction.

The next improvement should solve those concrete problems before adding vector
retrieval. Repository retrieval and conversation compaction are different:

- Repository retrieval decides which source files to inspect. Forge already has
  bounded `list_files`, `search`, and `read_file` tools for this.
- Conversation management decides which prior turns and run observations fit in
  the next model request.
- Persistent semantic memory decides what knowledge should survive beyond the
  transcript. That remains out of scope for Milestone 10.

## Goals

Milestone 10 should:

1. Prevent predictable context-window failures before a paid provider request.
2. Make every context-selection decision visible in structured events and
   `forge inspect`.
3. Preserve recent conversational continuity while compacting only older,
   completed turns.
4. Keep the canonical transcript lossless and separate from the smaller active
   model context.
5. Preserve Forge's security boundary: old text and summaries cannot restore
   approvals or override current instructions.
6. Work across native model adapters without moving provider-specific message
   rules into `@forge/core`.
7. Prove value through deterministic and opt-in live evaluations.

## Non-goals

This milestone does not include:

- Vector embeddings, a vector database, or repository-wide semantic indexing
- Cross-workspace or cross-user memory
- Resuming an in-progress tool call or provider stream
- Deleting the original transcript after compaction
- Reconstructing provider reasoning that was not returned
- Treating model-generated summaries as trusted facts or policy
- Hiding context loss to make a request appear successful

## Design principles

### Budget before compression

Forge must first measure what it sends. Adding summarization before budget
accounting would make failures harder to explain and prevent objective
comparison with the current behavior.

### Lossless record, bounded active view

The persisted transcript is the audit record. The model receives a derived,
bounded view of that record. Compaction changes the active view, not the
original messages.

### Mandatory context cannot be silently dropped

Current effective instructions, the current user request, tool definitions
needed for the run, and protocol-required pending tool-call state are mandatory.
If they cannot fit after applying configured reserves, Forge should stop before
the provider call and explain which budget is exhausted.

### Summaries are untrusted memory

A summary is derived from prior user and assistant text. It must be labeled as
conversation memory and placed below freshly loaded system instructions. It
cannot contain effective approvals, permission grants, current verification
status, or claims that supersede the current user request.

### Provider boundaries stay explicit

`@forge/core` may reason about abstract context cost and message categories. A
model adapter remains responsible for provider-specific token estimation,
message encoding, tool-call pairing, reasoning blocks, and opaque continuation
data.

## Context model

Forge should classify request content instead of treating it as one string:

| Class | Examples | Retention rule |
| --- | --- | --- |
| Mandatory instructions | Current `AGENTS.md`, selected skills, plugin prompt contributions | Reload every run; never summarized |
| Current request | The active user prompt and referenced paths | Never summarized or dropped |
| Protocol state | Pending assistant tool call, matching tool result, provider continuation | Preserve exactly as required by the adapter |
| Recent conversation | Most recent completed user/assistant turns | Keep verbatim within a configurable floor |
| Older conversation | A completed prefix of earlier turns | Eligible for checkpoint summarization |
| Repository observations | File reads, searches, command output | Run-scoped; bounded at tool boundaries and re-read when needed |
| Audit evidence | Full transcript and JSONL run traces | Persist separately; not automatically injected |

The initial request order remains conceptually:

```text
current effective instructions
derived conversation-memory checkpoint, if any
recent verbatim conversation turns
current user request
tool definitions
```

Within a run, adapter-owned continuation and Forge tool results extend that
initial request according to the provider protocol.

## Token budget

### Capability contract

Add a provider-neutral capability description exposed by each adapter:

```ts
interface ModelContextCapabilities {
  contextWindowTokens: number;
  maxOutputTokens?: number;
  estimateRequestTokens(request: ModelRequest): Promise<TokenEstimate>;
  continuationCompaction: "unsupported" | "adapter-owned";
}

interface TokenEstimate {
  tokens: number;
  method: "provider-tokenizer" | "sdk" | "conservative-fallback";
  confidence: "exact" | "estimated";
}
```

Capabilities must come from an explicit, tested adapter table or provider API.
Unknown models must not inherit an optimistic window. They should use a
conservative configured fallback and expose that provenance.

### Budget calculation

Before each model step, calculate:

```text
available input budget
  = model context window
  - reserved output tokens
  - safety margin

remaining history budget
  = available input budget
  - current instructions
  - current request
  - tool definitions
  - protocol-required continuation
```

Initial configuration should expose only values users can reason about:

```json
{
  "context": {
    "mode": "warn",
    "reservedOutputTokens": 4096,
    "safetyMarginTokens": 1024,
    "recentTurns": 6,
    "summaryTargetTokens": 1200
  }
}
```

Recommended modes:

- `off`: preserve current behavior but continue reporting provider usage.
- `warn`: run preflight and warn; reject only when mandatory context cannot fit.
- `compact`: use a valid checkpoint and create a new one when thresholds require
  it. This remains opt-in until evaluation gates pass.

Project configuration may lower budgets or select a stricter mode, but it must
not increase user-defined ceilings or disable a user-required guard.

### Estimation accuracy

Every completed provider step should compare the preflight estimate with
provider-reported input tokens when available. Store aggregate error, not raw
secret material. A model whose estimator repeatedly undercounts beyond the
safety margin should be blocked from automatic compaction rollout until its
adapter is corrected.

## Conversation compaction

### Selection algorithm

For the first compaction implementation:

1. Reload current instructions and compute mandatory cost.
2. Keep the current request untouched.
3. Keep at least `recentTurns` completed turns verbatim.
4. Select only a contiguous completed prefix older than that window.
5. Reuse an existing checkpoint when its source range and hash still match.
6. Otherwise summarize that prefix to the target budget.
7. Re-estimate the complete request.
8. If it still does not fit, reduce the eligible recent window only down to a
   documented hard floor; never remove the current turn or protocol state.
9. If safe reduction is impossible, stop with `limit_reached` and report the
   context budget breakdown.

A contiguous prefix makes provenance understandable and avoids a summary built
from unexplained holes in the conversation.

### Checkpoint schema

Session schema version 2 should retain `messages` as the canonical transcript
and add an optional derived checkpoint:

```ts
interface ContextCheckpoint {
  schemaVersion: 1;
  summarizedThroughMessageIndex: number;
  sourceHash: string;
  summary: string;
  summaryModelId: string;
  estimatedSummaryTokens: number;
  sourceMessageCount: number;
  createdAt: string;
  safetyLabels: readonly [
    "untrusted-conversation-memory",
    "no-approval-state",
    "no-policy-authority"
  ];
}
```

The checkpoint should be written atomically with the session snapshot. A source
hash prevents reuse after transcript migration or manual repair. Schema
validation must reject a checkpoint whose range exceeds the transcript.

### Summary contract

The summarizer prompt should request a concise, factual checkpoint containing:

- User goals and explicit constraints still relevant to future turns
- Decisions made and the reason recorded in the conversation
- Files or components discussed
- Completed work and unresolved follow-ups
- Known verification results, each labeled with its originating run rather than
  presented as current truth

It should explicitly exclude:

- Credentials and recognized secret values
- Approval decisions and permission grants
- Instructions to override the current system or project context
- Provider reasoning text unless it was already part of the visible assistant
  response
- Guesses introduced only to make the summary sound complete

Summary generation should consume redacted persisted messages. The result must
pass size, schema, and safety-label validation before it can replace the active
view. On failure, Forge keeps the previous valid checkpoint or stops with an
actionable budget message; it never overwrites the transcript.

### Manual-first rollout

Before automatic compaction is enabled, add:

```text
/context   Show active model, window, budget categories, retained turns, and checkpoint provenance
/compact   Preview the eligible range, request confirmation, generate a checkpoint, and show the new estimate
```

Manual compaction is not a security approval for later tools. It only changes
the derived context view. The preview must make clear that the full transcript
is retained.

## In-run context pressure

Conversation checkpoints solve pressure between completed runs. Tool-heavy runs
can still grow through assistant calls, provider reasoning blocks, and tool
results.

The initial safe behavior should be:

1. Bound tool output at execution as Forge already does.
2. Ask adapters to estimate the complete next request, including continuation.
3. Avoid adding a second copy of tool output outside the canonical tool result.
4. Prefer a targeted `read_file` or `search` retry over retaining a larger
   unbounded observation.
5. Stop with `limit_reached` before a request that cannot fit safely.

Do not generically rewrite opaque continuation objects in `@forge/core`.
Provider-specific in-run compaction may be added later only when an adapter can
prove that it preserves tool-call/result pairing and required reasoning blocks.
Until then, stopping honestly is safer than sending a malformed continuation.

## Events, traces, and inspection

Add versioned events such as:

```text
context.budgeted
context.warning
context.compaction.started
context.compaction.completed
context.compaction.failed
context.limit_reached
```

The budget event should include:

- Adapter, model ID, context-window source, and estimation method
- Estimated tokens by category
- Reserved output and safety margin
- Retained verbatim message count
- Summarized source range and checkpoint ID, when present
- Provider-reported input usage after completion

Traces should record the selection decision and hashes/provenance, not duplicate
the entire transcript or summary in every event. `forge inspect` should render a
compact budget table and estimation error.

## Security and correctness invariants

The implementation must preserve these invariants:

1. Fresh user/project instructions always outrank historical conversation and
   summaries.
2. Compaction never restores approvals, trust decisions, environment values, or
   permission profiles.
3. A summary cannot mark a previously failing verification as currently
   passing.
4. Only completed conversation turns are eligible for cross-run compaction.
5. Pending tool calls and results remain paired according to adapter rules.
6. The canonical transcript is not mutated or deleted by compaction.
7. Configured secrets are redacted before checkpoint generation and persistence.
8. Plugin observers receive redacted context events and cannot replace the
   selected checkpoint or weaken context limits.
9. Context failure is reported as a real terminal condition, never disguised as
   a successful assistant answer.

## Package boundaries

Recommended ownership:

| Package | Responsibility |
| --- | --- |
| `@forge/core` | Context categories, abstract budget policy, events, and stop decisions |
| Model adapters | Model capabilities, token estimation, provider message encoding, continuation rules |
| `@forge/config` | Versioned context configuration, provenance, and strictness merge |
| `@forge/persistence` | Session v2 migration, checkpoint validation, atomic storage |
| `apps/cli` | `/context`, `/compact`, warnings, inspection rendering, confirmation UI |
| `evals` | Long-session fixtures, metrics, comparison reports, release gates |

A separate package should be created only if tokenization dependencies cannot
remain adapter-local without duplication.

## Implementation sequence

### Phase A: Measurement foundation

1. Add context capability and estimator contracts.
2. Implement deterministic fake estimators for runtime tests.
3. Add adapter capability tables and conservative unknown-model behavior.
4. Emit `context.budgeted` before each provider request.
5. Compare estimates with returned usage and extend `forge inspect`.
6. Ship `warn` mode with no history mutation.

Exit gate: all requests have an inspectable budget, and mandatory-context
overflow fails before contacting the provider.

### Phase B: Derived active context

1. Separate canonical session messages from the active request view.
2. Implement deterministic recent-turn selection without summary generation.
3. Add session v1-to-v2 migration and checkpoint validation.
4. Add `/context` and dry-run compaction previews.

Exit gate: tests prove the transcript is unchanged and selection is stable
across resume.

### Phase C: Checkpoint generation

1. Implement the constrained summarizer behind an interface and fake.
2. Add source hashing, redaction, validation, and atomic persistence.
3. Add `/compact` and failure-safe checkpoint replacement.
4. Add opt-in `compact` mode.

Exit gate: manual compaction reduces estimated input tokens, preserves required
facts in fixtures, and cannot carry authority from historical text.

### Phase D: In-run guards

1. Re-estimate before every model step.
2. Include adapter-owned continuation cost.
3. Add typed context-limit stop reasons.
4. Add tool-heavy deterministic fixtures.
5. Prototype adapter-owned continuation compaction only if stop rates justify
   the added complexity.

Exit gate: no known over-budget request is sent silently, and tool protocols
remain valid.

### Phase E: Evaluation and default decision

1. Run `off`, `warn`, and `compact` modes on identical fixtures and live trials.
2. Publish aggregate context and task-quality metrics.
3. Define acceptable regression and estimator-error thresholds.
4. Enable automatic compaction by default only if those thresholds pass.

Exit gate: the default is chosen from published evidence rather than feature
availability.

## Test plan

### Unit tests

- Budget arithmetic at exact boundaries
- Conservative fallback for unknown models
- Turn selection with empty, odd, and maximum-sized histories
- Checkpoint source range and hash validation
- Configuration strictness and provenance
- Secret redaction before summary generation
- Summary failure preserving the last valid checkpoint

### Runtime and adapter tests

- Estimate emitted before every model step
- Provider-reported token usage correlated with the correct estimate
- OpenAI and DeepSeek tool-call continuations remain valid
- Mandatory context overflow performs no provider call
- Cancellation during summary generation leaves the session valid
- Resume reloads current instructions but reuses a matching checkpoint

### End-to-end fixtures

1. **Long recall:** an early user constraint remains available after more turns
   than the verbatim window.
2. **Instruction change:** a changed `AGENTS.md` overrides contradictory old
   conversation after resume.
3. **Hostile history:** historical text requesting unrestricted access remains
   inert after summarization.
4. **Verification freshness:** an old passing test result is not treated as
   evidence after later code changes.
5. **Tool pressure:** repeated bounded reads approach the window and stop or
   compact according to adapter capability.
6. **Recovery:** a process restart restores the same transcript and checkpoint
   provenance.

## Evaluation metrics and release gates

Record at least:

- Task and grader pass rate
- Provider-reported input/output tokens
- Estimated input tokens and absolute/relative estimation error
- Summary-generation tokens, latency, and failures
- Number of compactions and summarized messages
- Verbatim recent turns retained
- Context-limit stops and provider context errors
- Recall accuracy for seeded constraints and decisions
- Safety-invariant failures

Proposed gates before `compact` becomes the default:

- No safety-invariant regression in deterministic tests
- No transcript corruption across failure, cancellation, or resume tests
- No known provider request exceeds its declared input budget
- Median input-token reduction of at least 30% on long-session fixtures
- No more than a 5 percentage-point task pass-rate regression against `warn`
- At least 95% recall of explicitly seeded durable constraints in the
  long-session evaluation set

These thresholds are initial hypotheses. The checked-in report may revise them,
but the revision must be made before interpreting the final trial results.

## Risks and mitigations

| Risk | Mitigation |
| --- | --- |
| Summary loses a critical constraint | Keep recent turns verbatim, use seeded-recall evals, retain full transcript |
| Summary carries prompt injection | Label as untrusted memory, place below current instructions, test hostile history |
| Token estimator undercounts | Conservative fallback, safety margin, compare with provider usage |
| Summary generation adds cost and latency | Reuse hashed checkpoints, compact only past thresholds, report overhead |
| Provider tool protocol breaks | Keep continuation adapter-owned; stop rather than generically rewrite it |
| Configuration becomes too complex | Start with three modes and four understandable budget controls |
| Trace leaks duplicated sensitive text | Store budget metadata and hashes; keep normal redaction pipeline |
| Compaction hides what happened | Preserve canonical transcript and expose summarized ranges in `/context` and traces |

## Decision on RAG

Do not add vector RAG as part of Milestone 10. First measure whether long-session
failures come from conversation growth, repeated tool observations, or poor
repository discovery. If later evaluations show that lexical `search` and
targeted file reads miss relevant code, run a separate retrieval experiment
comparing lexical, semantic, and hybrid approaches on task success, retrieval
accuracy, tokens, latency, and index cost. Only promote that experiment into the
Roadmap when it beats the simpler baseline.
