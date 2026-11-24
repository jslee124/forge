# Context Management

简体中文 · Documentation index

Long coding sessions eventually run out of model context window. Forge handles that without losing history or compromising security: **the saved transcript stays lossless on disk, while the model receives a smaller derived active view.**

## The core mental model

```text
On disk (Canonical transcript — lossless)
┌────────────────────────────────────────────────────────┐
│ User/assistant turns + paired tool calls/results       │  ◄── Audit truth, never deleted by compaction
└────────────────────────────────────────────────────────┘
                           │
         derive active view before each model step
                           ▼
Sent to model (Bounded active view)
┌────────────────────────────────────────────────────────┐
│ 1. Freshly loaded instructions (AGENTS.md + tool defs) │  ◄── Highest authority
│ 2. Optional checkpoint summary (untrusted memory)      │  ◄── Strictly below instructions
│ 3. Recent verbatim conversation tail (~12k tokens)     │
│ 4. Current user request & images                       │
└────────────────────────────────────────────────────────┘
```

Three design principles follow from this split:

1. **Lossless record, bounded active view**: `/compact` creates a derived checkpoint to shrink future requests; it never deletes or rewrites earlier messages in the session file.
2. **Mandatory context cannot be silently dropped**: Fresh instructions, tool definitions, the active prompt, and paired pending tool calls must fit after subtracting reserve budgets. If they don't, Forge fails honestly with `limit_reached` instead of dropping system constraints.
3. **Summaries are untrusted memory**: A compaction summary is derived from old conversation text. It sits below fresh instructions, carries explicit safety labels (`untrusted-conversation-memory`, `no-approval-state`, `no-policy-authority`), and can never grant permissions, restore approvals, or turn an old failed test into current truth.

## Modes and budget defaults

The product default is **Manual**—Forge measures pressure and asks before compacting rather than compacting behind your back.

| Mode (`context.mode`) | Behavior |
| --- | --- |
| `manual` *(default)* | Computes projected input budget, displays pressure warnings past the threshold, and blocks only when mandatory context cannot fit. User triggers compaction explicitly via `/compact` or the context pressure prompt. |
| `automatic` *(opt-in)* | Reuses valid checkpoints or creates a new checkpoint automatically when projected usage reaches the threshold (`0.78`). Enable per session via `/context` or persist in user config. |
| `off` | Disables active-view eviction/compaction while still reporting token usage returned by providers. |

> Legacy `warn` and `compact` config values from older versions are normalized to `manual` and `automatic` on load. Project `.forge/config.json` can select a stricter mode or lower token budgets, never weaken user limits.

Default budget settings live in user configuration (`~/.forge/config.json`):

```json
{
  "context": {
    "mode": "manual",
    "reservedOutputTokens": 4096,
    "bufferTokens": 8192,
    "recentTailTokens": 12000,
    "summaryTargetTokens": 1200
  }
}
```

### How available input capacity is computed

Before every model step, Forge reserves output/safety headroom once (using `max(reservedOutputTokens, bufferTokens)` rather than subtracting both and wasting window space):

```text
availableInputBudget
  = modelContextWindow - max(reservedOutputTokens, bufferTokens)

remainingHistoryBudget
  = availableInputBudget - currentInstructions - toolSchemas - currentRequest - continuation
```

When available, each completed provider response reports real input tokens so Forge tracks estimation error in the run trace instead of guessing blindly.

## Interactive controls

In the terminal UI (`apps/cli`), three commands inspect and manage context:

- **`/context`** — Shows the active model window, category breakdown (instructions, tool schemas, history, draft/images), retained active tail, checkpoint status/strategy, and a selector to toggle `manual` / `automatic` for the session or user default.
- **`/compact --dry-run`** — Previews how many messages would be summarized and the projected token savings without writing anything or calling a model.
- **`/compact`** — Builds a redacted checkpoint from the eligible older conversation prefix while preserving a clean recent verbatim tail up to `recentTailTokens` (never splitting a tool call from its tool result).

## Checkpoint strategies and safety guards

Forge supports two checkpoint strategies in session schema v3 (`ContextCheckpoint` v2):

1. **Deterministic Forge summary (`forge-summary`)**: A redacted extractive summarizer that preserves user goals, explicit constraints, decisions, referenced files, and historical verification notes (explicitly tagged with their originating run) while stripping credentials and approval claims. Because it is deterministic, manual `/compact` and offline tests make zero paid model calls.
2. **Provider-native compaction (`provider-native`)**: When an adapter supports server-side opaque compaction items (for instance encrypted compaction state), Forge stores the opaque payload alongside its source hash and binds it strictly to that provider/model. If you switch providers or models, Forge ignores the incompatible payload and rebuilds cleanly from the lossless transcript. *(Currently shipped AI SDK DeepSeek and OpenAI adapters declare native compaction unsupported and use `forge-summary`.)*

### Safety stops & auto-pause

Automatic compaction includes strict no-progress protection so it never loops endlessly when fixed instructions or schemas fill the window:

- If a compaction is cancelled, fails schema/size validation, hits a duplicate source hash for the same step, or reclaims fewer than **`max(8,000 tokens, 20% of projected input)`**, automatic compaction transitions into **`paused`** (`context.auto-paused`) and informs the user instead of retrying blindly.
- If a provider rejects a clean mid-run continuation attempt for context overflow before any reasoning, assistant text, or tool call has been streamed (and the adapter supports `projectContinuation`), Forge projects completed tool results via `projectContinuation(continuation, 0)` and retries that single request once with the same user input (no duplicate messages or repeated side effects). A second overflow fails immediately.

## Codex Engine vs. native tools

- **Codex Engine (`apps/cli` / `apps/desktop`)**: When handing a multi-turn session to `codexPrompt`, Forge passes a **bounded active view** of the Forge transcript rather than an unbounded full log, and measures the wrapper cost. Codex App Server owns its own internal context management and compaction thresholds once running.
- **In-run tool pressure & why not vector RAG**: Tool outputs are already truncated at tool boundaries (`list_files`, `search`, `read_file`). Rather than hiding lost code behind vector embeddings or unrequested RAG indexes, Forge prefers targeted lexical `search` and `read_file` ranges so evidence remains verifiable against current workspace files.

## Core security invariants

1. Fresh `AGENTS.md` and system instructions always outrank conversation history and summaries.
2. Compaction never restores approvals, permission profiles, environment variables, or trust grants.
3. Redaction runs on persisted messages **before** checkpoint generation and trace emission.
4. Opaque provider items are never exposed to plugins or treated as plain text.
5. Context exhaustion stops explicitly with `limit_reached`—never hidden behind a synthetic success.
