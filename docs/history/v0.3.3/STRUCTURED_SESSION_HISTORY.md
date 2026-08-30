# Structured Session History and Resume Implementation Plan

[简体中文](../../zh-CN/history/v0.3.3/STRUCTURED_SESSION_HISTORY.md) · [Roadmap](../../ROADMAP.md) · [Current session behavior](../../SESSIONS.md)

> **Document role: historical design record.** This records the Milestone 14
> implementation decision. Current behavior is defined by source, tests, and
> the current session and architecture guides.

## Status

Milestone 14 is implemented in the current tree. Session schema v3, checkpoint
v2, runtime canonical deltas, provider projection, trace-assisted migration,
structured resume fallback, closed-exchange context selection, tests, and
current-product documentation now form the authoritative contract. Publication
and live-provider validation remain separate release actions.

The OpenAI API adapter remains in scope. This plan changes session history and
provider projection; it does not remove `@forge/model-openai`, DeepSeek, custom
compatible routes, or ChatGPT subscription access through Codex App Server.

## Decision

Forge will keep two related but non-interchangeable durable records:

```text
Canonical model history                  RunEvent trace
-------------------------------------    -----------------------------------
user messages                            reasoning and text streaming deltas
assistant text                           tool proposal and approval UI state
assistant tool calls                     tool start/progress/completion events
paired tool results and failures         context/cache/update diagnostics
bounded terminal run outcomes            timing, usage, and terminal status
```

The canonical history is the provider-neutral source used to continue a model
conversation. The trace is the inspectable execution record used by the TUI,
`forge inspect`, plugins, and migration recovery. A trace event does not become
model context merely because it was displayed, and canonical history never
restores authority, approval state, a process, or an unfinished provider turn.

## Current baseline and gap

Today:

- `ModelConversationMessage` supports only string `user` and `assistant`
  messages.
- Session snapshots use `schemaVersion: 2`, store those messages plus separate
  display reasoning, and reference append-only JSONL run traces.
- The runtime sends tool results back to the provider during the active run by
  using adapter continuation plus `ModelToolResult`.
- `recordRunInSession()` reduces a completed run to user text, final assistant
  text, and a bounded failure suffix.
- `/resume` can replay complete tool history in the TUI when all traces exist,
  but the next model request receives only the reduced text conversation.
- Codex App Server receives the same reduced conversation serialized into an
  explicitly historical JSON wrapper.
- Checkpoint hashes, token estimates, titles, migration, and cache observations
  all assume the text-only message shape.

Consequently, after restart the model may know that a tool failed without
receiving the exact model-visible call/result pair that caused the failure. It
can repeat commands, reread files, or make a different assumption from the one
it made during the original run.

## Goals

1. Persist complete, provider-neutral, model-visible history for completed
   tool exchanges across prompts and process restarts.
2. Let `/resume` present the same historical tool timeline as a normal active
   session whenever traces are available.
3. Give every native provider adapter enough typed information to encode the
   history using its own wire protocol without provider branches in core.
4. Keep the canonical transcript lossless within existing bounded tool-output
   limits, while deriving smaller active views through checkpoints.
5. Preserve old session readability and migrate only when reconstruction is
   deterministic and complete.
6. Keep approvals, permission grants, policy decisions, pending calls, child
   processes, and current verification state out of resumed model authority.
7. Preserve stable request ordering and make cache invalidation caused by the
   schema migration explicit and measurable.

## Non-goals

- Resuming an active stream, tool process, approval prompt, or provider-native
  continuation
- Sending raw `RunEvent` JSON, terminal rendering, approval choices, timing, or
  update notices to a model
- Reconstructing hidden chain of thought or replaying unsigned reasoning across
  providers
- Guaranteeing byte-identical wire history after switching provider families
- Making historical tool output current evidence without revalidation
- Adding session branching, cross-machine synchronization, or trace encryption
- Changing the default context compaction mode

## Canonical data model

### Core contract

Replace the text-only conversation contract with a content-block model owned by
`@forge/core`. Names are provisional until implementation review:

```ts
type CanonicalConversationMessage =
  | {
      id: string;
      runId: string;
      role: "user";
      content: readonly CanonicalUserContent[];
    }
  | {
      id: string;
      runId: string;
      step: number;
      role: "assistant";
      content: readonly CanonicalAssistantContent[];
    }
  | {
      id: string;
      runId: string;
      step: number;
      role: "tool";
      toolCallId: string;
      toolName: string;
      content: readonly CanonicalToolContent[];
      isError: boolean;
    };

type CanonicalUserContent =
  | { type: "text"; text: string }
  | CanonicalAttachmentReference;

type CanonicalAssistantContent =
  | { type: "text"; text: string }
  | {
      type: "tool-call";
      id: string;
      name: string;
      input: unknown;
      providerMetadata?: CanonicalProviderMetadata;
    };

type CanonicalToolContent =
  | { type: "text"; text: string }
  | CanonicalImageContent;
```

`id` and `runId` provide durable correlation but are not sent to providers.
`toolCallId` is protocol-significant and must remain stable. Tool calls stay in
the assistant message that produced them; each result is a later `tool` message
paired by ID. Parallel calls preserve original call order followed by original
result order.

### Reasoning and provider metadata

Reasoning remains separate from portable canonical content by default:

- Provider-exposed reasoning summaries remain displayable and addressable by
  durable assistant message ID rather than array index.
- An adapter may persist bounded provider metadata only when it declares that
  the metadata is replayable, JSON-safe, redacted, and required to continue a
  completed tool exchange.
- Replayable metadata carries its source provider, protocol, model family, and
  schema version. It is dropped from the model projection when the target
  adapter does not explicitly accept it.
- Unsigned reasoning text may be retained for display but must not be promoted
  into a hidden-thinking block on another provider.
- Opaque response IDs and provider continuations remain run-scoped unless an
  adapter defines a versioned durable projection with validation and fallback.

### Tool outcomes

Canonical tool results contain exactly the observation returned to the model,
after normal tool-output bounds and persistence redaction. They do not contain
the approval descriptor or grant that permitted execution.

- Success: preserve bounded text/image output and `isError: false`.
- Execution failure: preserve the bounded model-facing error and
  `isError: true`.
- User denial: preserve a generic paired denial result plus bounded user
  feedback only when that feedback was returned to the model.
- Cancellation or crash before a result reached the model: omit the dangling
  tool call from canonical history and retain the existing authority-free run
  outcome summary.
- Limit reached after completed calls: retain every closed pair, remove the
  unclosed suffix, then append the bounded terminal outcome.

The canonicalizer must validate unique call IDs, causal ordering, known tool
names, serializable inputs, paired results, and deterministic parallel-call
ordering before persistence.

## Session schema v3

Introduce `schemaVersion: 3` with these logical fields:

```ts
interface SessionSnapshotV3 {
  schemaVersion: 3;
  id: string;
  createdAt: string;
  updatedAt: string;
  workspaceRoot: string;
  workingDirectory: string;
  history: readonly CanonicalConversationMessage[];
  reasoning: readonly SessionReasoningV2[];
  runIds: readonly string[];
  historyFidelity: "structured" | "text-only-migrated";
  lastRunStatus?: RunStatus;
  contextCheckpoint?: ContextCheckpointV2;
}
```

Required invariants:

- Snapshot validation rejects orphan tool results, dangling persisted calls,
  duplicate message/call IDs, invalid role/content combinations, and reasoning
  references to non-assistant messages.
- Per-item and aggregate limits prevent a valid JSON document from becoming an
  unbounded allocation. Tool content reuses the runtime's configured output
  bound; provider metadata receives a separate small bound.
- Session writes remain atomic and secrets are redacted before validation of
  the final persisted representation.
- Titles and list summaries derive from the first user text block, not raw JSON.
- A v3 checkpoint hashes the canonical history serialization and retained tail.
  Migrating a v2 snapshot invalidates its v1 checkpoint instead of pretending
  that hashes over two different schemas are equivalent.

### Migration

1. Read v1 and v2 snapshots with their existing strict schemas.
2. Always migrate their user/assistant text losslessly into v3 content blocks.
3. Attempt structured tool-history backfill only when every referenced trace is
   readable, ordered, valid, and matches the existing text transcript as an
   exact subsequence.
4. Reconstruct only completed model-visible exchanges. Ignore approval and UI
   events and reject any ambiguous or unpaired reconstruction.
5. If backfill cannot be proven complete, save or return a
   `text-only-migrated` snapshot without inventing tool history.
6. Make migration idempotent, preserve the original file on validation/write
   failure, and test interrupted atomic replacement.
7. Do not rewrite every session during startup. Migrate on successful load and
   save only after validation.

Trace files remain schema v1 unless implementation discovers information that
cannot be represented by existing ordered events. The canonical v3 snapshot,
not the trace, becomes the primary continuation source.

## Runtime capture

`@forge/core` should produce a typed canonical delta directly from the agent
loop rather than making persistence infer the primary record from observability
events.

1. Add a canonical-history builder beside the runtime's provider continuation.
2. Start each run delta with the current user message.
3. On every completed model step, capture assistant text and tool calls in the
   order observed from the adapter.
4. Append a tool result only after the exact result has been returned to the
   model continuation path.
5. Track a commit boundary after each closed provider turn. On cancellation or
   failure, discard the uncommitted suffix.
6. Return the validated delta on `RunResult`; `recordRunInSession()` appends that
   delta atomically with the run ID and terminal status.
7. Continue emitting the existing granular `RunEvent` sequence. Runtime output,
   inspection, and plugin observation must not depend on snapshot serialization.

The implementation must include an invariant test showing that the canonical
delta is semantically equivalent to the model-visible in-run message sequence,
excluding provider-only opaque state and explicitly display-only reasoning.

## Provider projection

Change `ModelRequest.conversation` to accept canonical messages. Add one shared
validator/grouping helper in core or a narrowly owned model-message package;
do not put provider wire types in core.

### `@forge/model-openai`

- Map assistant tool calls to Responses `function_call` items.
- Map tool messages to `function_call_output` using the original call ID.
- Retain supported replayable OpenAI metadata only for the same compatible
  protocol/model family.
- Keep `store: false`, adapter-owned continuation, cache reporting, and current
  error mapping unchanged.

### `@forge/model-deepseek`

- Map canonical messages through the supported DeepSeek/OpenAI Responses shape.
- Preserve reasoning/tool-call state only when the endpoint returned replayable
  metadata; otherwise emit the existing honest warning and continue from
  portable text/tool content when valid.
- Cover text-only and vision-capable models without persisting raw local image
  paths as provider payloads.

### `@forge/model-compat`

- Support both configured `openai-responses` and `openai-chat-completions`
  routes.
- Responses routes use function-call items; chat routes use assistant
  `tool_calls` followed by `role: "tool"` messages.
- Validate route/model changes before accepting provider metadata. Portable
  tool history must continue even when metadata is dropped.
- Preserve route-specific reasoning-gear and model-discovery behavior.

### Codex App Server / ChatGPT subscription

Codex App Server is a separate engine and does not consume Forge's native model
adapter. In the first delivery:

- Serialize the bounded canonical active view into the existing untrusted
  historical wrapper.
- Use a stable compact schema that identifies user, assistant text, tool call,
  and tool result without including approvals or raw trace events.
- State explicitly that historical tool output is not current verification and
  that a new action still requires current inspection and approval.
- Include canonical history in wrapper token estimates and checkpoint hashes.

A persistent one-session-to-one-Codex-thread mapping remains a separate later
experiment because it changes lifecycle, deletion, model switching, and
security semantics.

## Resume and TUI behavior

Resume has two projections from the same session:

1. **Model projection:** derive the active canonical view from snapshot v3 and
   its valid checkpoint, then pass typed messages to the selected engine.
2. **Display projection:** replay ordered run traces when all are readable. If
   any trace is missing, render a clearly marked canonical fallback that still
   shows persisted tool calls/results but omits unavailable approvals, timing,
   streaming deltas, and diagnostics.

The UI must never duplicate the final answer when trace replay and canonical
fallback overlap. It should retain current tool labels and status presentation,
not dump persisted JSON. A resumed session should look like an uninterrupted
session at both wide and narrow terminal widths, except for a small historical
boundary marker when needed.

## Context, compaction, and cache behavior

- Update token estimation to count assistant tool inputs, tool-result text and
  images, and only the provider metadata that the target adapter will replay.
- Select recent history at closed exchange boundaries; never split a tool call
  from its result or retain a result without its assistant call.
- Update checkpoint v2 source/tail hashes to use deterministic canonical JSON.
- Compact old completed tool results before broader conversation summary when
  this reclaims enough context, while retaining tool name, success/error,
  truncation state, hash, and a bounded excerpt.
- A summary must describe tool facts as historical observations, not current
  filesystem or test evidence.
- Increment the prompt schema version. Record a cache invalidation reason for
  the canonical-history schema change; do not present the first post-upgrade
  cache miss as a provider regression.
- Verify that resume produces the same stable dynamic-history serialization as
  the equivalent uninterrupted session.

## Security and privacy requirements

- Run the configured-secret and known-sensitive-field redactor over canonical
  tool inputs, outputs, provider metadata, migration results, and fallback UI.
- Never persist approval descriptors, allowed scopes, use counts, trust state,
  policy internals, pending prompts, OAuth tokens, API keys, or process handles
  in canonical messages.
- Treat every restored user, assistant, and tool block as untrusted historical
  content below current system/developer/project instructions.
- Never interpret a historical successful command as proof that the current
  checkout still passes; the model must revalidate when the current request
  depends on it.
- Reject provider metadata with prototypes, non-JSON values, excessive depth,
  excessive bytes, or an unrecognized version.
- Keep session and trace files documented as sensitive local data even after
  redaction.
- Fuzz schema migration and provider projection with hostile role strings,
  duplicate call IDs, malformed tool inputs, injected approval claims, and
  oversized nested values.

## Package and file map

| Area | Expected changes |
| --- | --- |
| `packages/core/src/model.ts` | Canonical content/message types and adapter-facing conversation contract |
| `packages/core/src/runtime.ts` | Build and commit canonical run deltas at model-visible boundaries |
| `packages/core/src/context.ts` | Estimate and retain closed tool exchanges atomically |
| `packages/persistence/src/schema.ts` | Session v3 and checkpoint v2 schemas, strict invariants |
| `packages/persistence/src/session-store.ts` | v1/v2 migration, canonical append, title/hash/summary updates |
| `packages/model-openai/` | Responses projection and metadata compatibility |
| `packages/model-deepseek/` | DeepSeek projection and replayability handling |
| `packages/model-compat/` | Responses/chat projection and route portability |
| `apps/cli/src/run.ts` | Pass canonical active view to native runs |
| `apps/cli/src/codex-command.ts` | Stable canonical wrapper for Codex Engine |
| `apps/cli/src/persistent-session.ts` | Resume/migrate, trace replay, canonical fallback, context status |
| `apps/cli/src/interactive-ui.tsx` | Historical boundary and fallback rendering without duplication |
| `evals/` | Resume continuity, model-switch, compaction, cache, and safety fixtures |
| `docs/` | Current behavior only after implementation; keep this plan marked planned |

## Delivery sequence

### 14.0 Contract and fixtures

- Freeze representative traces for success, tool failure, denial with feedback,
  parallel calls, cancellation, limit reached, missing traces, and subagents.
- Add golden canonical histories and provider projections before changing the
  persisted schema.
- Record current v2 migration, resume rendering, context estimates, and cache
  prefix hashes as baselines.

### 14.1 Core canonical history

- Add content-block types, validation helpers, stable serialization, and a
  canonical delta builder.
- Keep the old text conversation adapter temporarily so callers migrate in
  small reviewable changes.
- Prove commit-boundary behavior for cancellation and incomplete calls.

### 14.2 Persistence v3

- Add strict v3 read/write schemas and v1/v2 migration.
- Append runtime-produced deltas instead of reconstructing normal writes from
  events.
- Add trace-assisted backfill with all-or-nothing fidelity checks.
- Invalidate/rebuild checkpoints safely and preserve atomic-write guarantees.

### 14.3 Native provider adapters

- Implement OpenAI, DeepSeek, compat Responses, and compat Chat projections.
- Add adapter contract tests for ordering, parallel calls, errors, images,
  provider metadata, and provider/model switches.
- Remove the temporary text-only bridge after every native call site migrates.

### 14.4 Codex Engine and resume UI

- Replace the text-only Codex wrapper with stable canonical serialization.
- Add trace-first replay and structured canonical fallback.
- Verify `/resume`, `resume --last`, model switching, `/new`, and session picker
  behavior across narrow/wide snapshots.

### 14.5 Context and compaction

- Move selection, estimates, hashing, summary generation, and pressure status to
  canonical exchange boundaries.
- Add old-tool-result projection and checkpoint v2 migration.
- Increment prompt schema/cache diagnostics and compare uninterrupted versus
  resumed stable prefixes.

### 14.6 Security, evaluations, and documentation

- Run hostile migration, redaction, authority, malformed metadata, and orphan
  pairing fixtures.
- Add deterministic tasks where a resumed model must use a prior command
  failure, file read, edit result, and test result without blindly repeating it.
- Run live provider checks only through explicit opt-in and report protocol,
  model, token/cache fields, and any dropped metadata.
- Update `SESSIONS.md`, `ARCHITECTURE.md`, `CONTEXT_MANAGEMENT.md`, `SECURITY.md`,
  CLI help, English/Chinese mirrors, and packaged current-product docs only
  after the behavior is implemented.

## Test matrix

Minimum deterministic coverage:

| Dimension | Cases |
| --- | --- |
| Status | completed, failed, denied, cancelled, limit reached |
| Tool shape | no tool, one tool, parallel tools, repeated tool name, nested subagent |
| Outcome | success, typed error, thrown error, denial feedback, truncated output, image output |
| Integrity | duplicate ID, orphan result, dangling call, reordered result, malformed metadata |
| Persistence | fresh v3, v1 migration, v2 text migration, trace backfill, missing/corrupt trace, interrupted save |
| Resume | trace replay, canonical fallback, no duplicate answer, current instructions reloaded, approvals empty |
| Provider | OpenAI Responses, DeepSeek, compat Responses, compat Chat, Codex wrapper |
| Switching | same model, same protocol/new model, new route, Responses to Chat, native to Codex |
| Context | no checkpoint, valid checkpoint, stale checkpoint, tool-heavy compaction, overflow retry |
| Cache | uninterrupted prefix, resumed prefix, schema invalidation, checkpoint invalidation, unavailable metrics |
| Security | injected approval claim, secret in args/output/metadata, hostile role, oversized/deep JSON |

## Acceptance and release gates

The work is complete only when all of the following hold:

- A resumed deterministic fixture receives the same portable user/assistant/
  tool history as an uninterrupted run, modulo documented provider metadata.
- Every persisted tool result has exactly one earlier assistant tool call; no
  session load or compaction can create an orphan or dangling pair.
- A failed command's bounded model-facing error survives restart and can change
  the next model decision without being converted into approval or current
  verification.
- Missing traces reduce display fidelity but do not erase structured canonical
  history or prevent a safe resume.
- v1/v2 sessions remain readable; ambiguous traces never cause invented tool
  history; failed migration leaves the original snapshot recoverable.
- Resuming reloads current instructions/configuration and creates empty approval
  state. No previous grant, process, or pending call is restored.
- Context accounting includes canonical tool history, compaction preserves pair
  boundaries, and cache telemetry reports the schema transition honestly.
- OpenAI, DeepSeek, compat, and Codex paths pass offline contract tests. Any live
  provider validation is explicit, bounded, redacted, and not part of default
  tests.
- Build, Biome, typecheck, full offline tests, docs/link checks, deterministic
  evaluations, package verification, and installed CLI smoke tests pass.
- Current-product documentation is changed from text-only to structured resume
  claims only in the same release that ships and verifies the implementation.

## Rollback strategy

- Keep v1/v2 readers for at least one compatibility window.
- Write only v3 after the feature lands; do not dual-write two canonical
  histories that can diverge.
- If provider projection regresses before release, disable structured projection
  behind one internal compatibility switch while continuing to read v3 and
  derive its text-only view. Do not downgrade or destructively rewrite snapshots.
- If migration reveals an unhandled legacy shape, leave that session unchanged,
  report an actionable error or text-only fallback, and add a fixture before
  expanding the migrator.
