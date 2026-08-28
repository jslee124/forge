import {
  loadForgeConfig,
  type ProviderProfile,
  saveUserContextMode,
} from "@forge/config";
import type {
  ContextPressureSnapshot,
  ModelConversationMessage,
  RunResult,
  WorkspaceContext,
} from "@forge/core";
import { conservativeTextTokens } from "@forge/core";
import { deepSeekModelContext } from "@forge/model-deepseek";
import { openAIModelContext } from "@forge/model-openai";
import {
  type ContextCheckpoint,
  configuredSecrets,
  createForgeSummaryCheckpoint,
  FileSessionStore,
  FileTraceStore,
  isCheckpointValid,
  previewSessionCompaction,
  recordRunInSession,
  type SessionReasoning,
  type SessionSnapshot,
  type SessionSummary,
} from "@forge/persistence";

import type { RunMetadata } from "./run.js";

export interface InteractiveSessionPersistence {
  readonly messages: readonly ModelConversationMessage[];
  readonly reasoning?: readonly SessionReasoning[];
  readonly sessionId: string | undefined;
  readonly contextCheckpoint?: ContextCheckpoint | undefined;
  prepareRun(prompt?: string, imageCount?: number): Promise<string>;
  recordRun(
    prompt: string,
    result: RunResult,
    metadata: RunMetadata,
  ): Promise<void>;
  clear(): void;
  list(): Promise<readonly SessionSummary[]>;
  resume(sessionId: string): Promise<readonly ModelConversationMessage[]>;
  contextDetails?(draft?: string, imageCount?: number): ContextStatus;
  contextStatus?(): string;
  compact?(dryRun: boolean): Promise<string>;
  enableAutoForSession?(): void;
  saveAutoDefault?(): Promise<string>;
  pauseAuto?(): void;
  selectModel?(
    provider: string,
    modelId: string,
    contextWindowTokens?: number,
  ): void;
}

interface PersistentContextOptions {
  readonly mode: "off" | "warn" | "compact";
  readonly provider: string;
  readonly modelId: string;
  readonly recentTailTokens: number;
  readonly summaryTargetTokens: number;
  readonly reservedOutputTokens: number;
  readonly bufferTokens: number;
  readonly contextWindowTokens: number;
  readonly secrets: readonly string[];
  readonly activationThreshold: number;
  readonly minimumReclaimTokens: number;
  readonly minimumReclaimRatio: number;
}

export interface ContextStatus {
  readonly provider: string;
  readonly modelId: string;
  readonly mode: PersistentContextOptions["mode"];
  readonly pressure: ContextPressureSnapshot;
  readonly activationThreshold: number;
  readonly contextWindowTokens: number;
  readonly reservedOutputTokens: number;
  readonly bufferTokens: number;
  readonly effectiveReserveTokens: number;
  readonly availableInputTokens: number;
  readonly recentTailTokens: number;
  readonly summaryTargetTokens: number;
  readonly canonicalMessageCount: number;
  readonly activeTailMessageCount: number;
  readonly activeTailStartIndex: number;
  readonly estimatedTranscriptTokens: number;
  readonly projectedCompactedTokens: number;
  readonly lastCompaction?: {
    readonly estimatedBeforeTokens: number;
    readonly estimatedAfterTokens: number;
    readonly reclaimedTokens: number;
    readonly strategy: string;
  };
  readonly checkpoint:
    | {
        readonly status: "none";
      }
    | {
        readonly status: "valid" | "stale";
        readonly strategy: ContextCheckpoint["strategy"];
        readonly summarizedMessageCount: number;
        readonly estimatedTokens: number;
      };
}

export class PersistentInteractiveSession
  implements InteractiveSessionPersistence
{
  readonly #store: FileSessionStore;
  readonly #traceStore: FileTraceStore;
  readonly #workspace: WorkspaceContext;
  #snapshot: SessionSnapshot | undefined;
  #context: PersistentContextOptions;
  readonly #cwd: string;
  readonly #env: NodeJS.ProcessEnv;
  #sessionMode: ContextPressureSnapshot["mode"];
  #lastPressure: ContextPressureSnapshot | undefined;
  #lastCompaction: ContextStatus["lastCompaction"] | undefined;

  constructor(options: {
    readonly store: FileSessionStore;
    readonly traceStore: FileTraceStore;
    readonly workspace: WorkspaceContext;
    readonly snapshot?: SessionSnapshot;
    readonly context: PersistentContextOptions;
    readonly cwd: string;
    readonly env: NodeJS.ProcessEnv;
  }) {
    this.#store = options.store;
    this.#traceStore = options.traceStore;
    this.#workspace = options.workspace;
    this.#snapshot = options.snapshot;
    this.#context = options.context;
    this.#cwd = options.cwd;
    this.#env = options.env;
    this.#sessionMode =
      options.context.mode === "compact"
        ? "auto-default"
        : options.context.mode;
  }

  get messages(): readonly ModelConversationMessage[] {
    return this.#snapshot?.messages ?? [];
  }

  get sessionId(): string | undefined {
    return this.#snapshot?.id;
  }

  get reasoning(): readonly SessionReasoning[] {
    return this.#snapshot?.reasoning ?? [];
  }

  get contextCheckpoint(): ContextCheckpoint | undefined {
    return this.#snapshot?.contextCheckpoint;
  }

  async prepareRun(prompt = "", imageCount = 0): Promise<string> {
    if (!this.#snapshot) {
      this.#snapshot = this.#store.create(this.#workspace);
    }
    const pressure = this.contextDetails(prompt, imageCount).pressure;
    if (
      (this.#sessionMode === "auto-session" ||
        this.#sessionMode === "auto-default") &&
      pressure.ratio >= this.#context.activationThreshold &&
      this.#snapshot.messages.length > 0 &&
      !isCheckpointValid(this.#snapshot)
    ) {
      const preview = previewSessionCompaction(this.#snapshot, this.#context);
      if (preview.eligibleMessageCount > 0) {
        const reclaimed = Math.max(
          0,
          preview.estimatedBeforeTokens - preview.estimatedAfterTokens,
        );
        const minimumUseful = Math.max(
          this.#context.minimumReclaimTokens,
          Math.ceil(
            pressure.estimatedInputTokens * this.#context.minimumReclaimRatio,
          ),
        );
        if (reclaimed < minimumUseful) {
          this.#sessionMode = "paused";
          return this.#snapshot.id;
        }
        const compacted = createForgeSummaryCheckpoint(
          this.#snapshot,
          this.#context,
        );
        await this.#store.save(compacted);
        this.#snapshot = compacted;
        this.#lastCompaction = {
          estimatedBeforeTokens: preview.estimatedBeforeTokens,
          estimatedAfterTokens: preview.estimatedAfterTokens,
          reclaimedTokens: reclaimed,
          strategy: "forge-summary",
        };
      }
    }
    return this.#snapshot.id;
  }

  async recordRun(
    prompt: string,
    result: RunResult,
    metadata: RunMetadata,
  ): Promise<void> {
    if (!this.#snapshot) {
      this.#snapshot = this.#store.create(this.#workspace);
    }
    this.#snapshot = recordRunInSession(this.#snapshot, {
      prompt,
      finalText: result.finalText,
      reasoning: persistedReasoning(result.events),
      status: result.status,
      runId: metadata.runId,
    });
    const lastPressure = [...result.events]
      .reverse()
      .find(
        (
          event,
        ): event is Extract<
          (typeof result.events)[number],
          { readonly type: "context.pressure" }
        > => event.type === "context.pressure",
      );
    if (lastPressure) this.#lastPressure = lastPressure.snapshot;
    const lastCompaction = [...result.events]
      .reverse()
      .find(
        (
          event,
        ): event is Extract<
          (typeof result.events)[number],
          { readonly type: "context.compaction.completed" }
        > => event.type === "context.compaction.completed",
      );
    if (lastCompaction) this.#lastCompaction = lastCompaction;
    if (
      result.events.some(({ type }) => type === "context.auto-paused") ||
      result.status === "cancelled"
    ) {
      this.#sessionMode = "paused";
    }
    if (this.#snapshot.messages.length > 0) {
      await this.#store.save(this.#snapshot);
    }
  }

  clear(): void {
    this.#snapshot = undefined;
    this.#resetTransientContext();
  }

  list(): Promise<readonly SessionSummary[]> {
    return this.#store.list(this.#workspace.root);
  }

  async resume(
    sessionId: string,
  ): Promise<readonly ModelConversationMessage[]> {
    this.#resetTransientContext();
    this.#snapshot = await this.#store.loadForWorkspace(
      sessionId,
      this.#workspace.root,
    );
    const restored = await restoreReasoningFromTraces(
      this.#snapshot,
      this.#traceStore,
    );
    if (restored !== this.#snapshot) {
      this.#snapshot = restored;
      await this.#store.save(restored);
    }
    return this.#snapshot.messages;
  }

  contextDetails(draft = "", imageCount = 0): ContextStatus {
    const effectiveReserveTokens = Math.max(
      this.#context.reservedOutputTokens,
      this.#context.bufferTokens,
    );
    const availableInputTokens = Math.max(
      0,
      this.#context.contextWindowTokens - effectiveReserveTokens,
    );
    const messageCount = this.#snapshot?.messages.length ?? 0;
    const preview = this.#snapshot
      ? previewSessionCompaction(this.#snapshot, this.#context)
      : undefined;
    const checkpoint = this.#snapshot?.contextCheckpoint;
    const activeTranscriptTokens =
      checkpoint && this.#snapshot && isCheckpointValid(this.#snapshot)
        ? (preview?.estimatedAfterTokens ?? 0)
        : (preview?.estimatedBeforeTokens ?? 0);
    const previousFixedTokens = this.#lastPressure
      ? Math.max(
          0,
          this.#lastPressure.estimatedInputTokens -
            this.#lastPressure.estimates.conversationHistory -
            this.#lastPressure.estimates.currentRequest,
        )
      : 0;
    const currentRequestTokens =
      conservativeTextTokens(draft) + imageCount * 4_096;
    const estimatedInputTokens =
      previousFixedTokens + activeTranscriptTokens + currentRequestTokens;
    const ratio =
      availableInputTokens === 0
        ? estimatedInputTokens > 0
          ? 1
          : 0
        : estimatedInputTokens / availableInputTokens;
    const pressureState =
      this.#sessionMode === "paused"
        ? "paused"
        : ratio >= 0.9
          ? "critical"
          : ratio >= this.#context.activationThreshold
            ? "compact-soon"
            : ratio >= 0.5
              ? "elevated"
              : "normal";
    const pressure: ContextPressureSnapshot = {
      schemaVersion: 1,
      provider: this.#context.provider,
      modelId: this.#context.modelId,
      estimatedInputTokens,
      availableInputTokens,
      ratio,
      confidence: this.#lastPressure ? "estimated" : "unavailable",
      mode: this.#sessionMode,
      state: pressureState,
      estimates: {
        instructions: this.#lastPressure?.estimates.instructions ?? 0,
        currentRequest: currentRequestTokens,
        toolSchemas: this.#lastPressure?.estimates.toolSchemas ?? 0,
        conversationHistory: activeTranscriptTokens,
        continuation: 0,
        toolResults: 0,
      },
    };

    return {
      provider: this.#context.provider,
      modelId: this.#context.modelId,
      mode: this.#context.mode,
      pressure,
      activationThreshold: this.#context.activationThreshold,
      contextWindowTokens: this.#context.contextWindowTokens,
      reservedOutputTokens: this.#context.reservedOutputTokens,
      bufferTokens: this.#context.bufferTokens,
      effectiveReserveTokens,
      availableInputTokens,
      recentTailTokens: this.#context.recentTailTokens,
      summaryTargetTokens: this.#context.summaryTargetTokens,
      canonicalMessageCount: messageCount,
      activeTailMessageCount: preview?.retainedMessageCount ?? 0,
      activeTailStartIndex: preview?.retainedTailStartIndex ?? 0,
      estimatedTranscriptTokens: preview?.estimatedBeforeTokens ?? 0,
      projectedCompactedTokens: preview?.estimatedAfterTokens ?? 0,
      ...(this.#lastCompaction ? { lastCompaction: this.#lastCompaction } : {}),
      checkpoint: checkpoint
        ? {
            status:
              this.#snapshot && isCheckpointValid(this.#snapshot)
                ? "valid"
                : "stale",
            strategy: checkpoint.strategy,
            summarizedMessageCount: checkpoint.summarizedThroughMessageIndex,
            estimatedTokens: checkpoint.estimatedCheckpointTokens,
          }
        : { status: "none" },
    };
  }

  contextStatus(): string {
    const status = this.contextDetails();
    const checkpoint = status.checkpoint;
    const checkpointText =
      checkpoint.status === "none"
        ? "none"
        : `${checkpoint.status} ${checkpoint.strategy}, ${checkpoint.summarizedMessageCount} summarized messages, ${checkpoint.estimatedTokens} estimated tokens`;
    return [
      `Model: ${status.provider}/${status.modelId}.`,
      `Window: ${status.contextWindowTokens} tokens; available input ${status.availableInputTokens}; mode ${status.mode}.`,
      `Reserve: ${status.effectiveReserveTokens} tokens; recent tail ${status.recentTailTokens}; summary target ${status.summaryTargetTokens}.`,
      `Transcript: ${status.canonicalMessageCount} canonical messages; estimated ${status.estimatedTranscriptTokens} tokens.`,
      `Active tail: ${status.activeTailMessageCount} messages from index ${status.activeTailStartIndex}.`,
      `Projected compact view: ${status.projectedCompactedTokens} tokens.`,
      `Checkpoint: ${checkpointText}.`,
    ].join("\n");
  }

  async compact(dryRun: boolean): Promise<string> {
    if (!this.#snapshot) {
      throw new Error("No active session exists to compact.");
    }
    const preview = previewSessionCompaction(this.#snapshot, this.#context);
    if (dryRun) {
      return `Compaction preview: summarize ${preview.eligibleMessageCount} completed messages, retain ${preview.retainedMessageCount} recent messages; estimated ${preview.estimatedBeforeTokens} -> ${preview.estimatedAfterTokens} tokens. The canonical transcript will remain unchanged.`;
    }
    const next = createForgeSummaryCheckpoint(this.#snapshot, this.#context);
    await this.#store.save(next);
    this.#snapshot = next;
    const reclaimed = Math.max(
      0,
      preview.estimatedBeforeTokens - preview.estimatedAfterTokens,
    );
    this.#lastCompaction = {
      estimatedBeforeTokens: preview.estimatedBeforeTokens,
      estimatedAfterTokens: preview.estimatedAfterTokens,
      reclaimedTokens: reclaimed,
      strategy: "forge-summary",
    };
    return `Context compacted · ${preview.estimatedBeforeTokens} -> ${preview.estimatedAfterTokens} tokens · Forge summary · retained ${preview.retainedMessageCount} recent messages. The full canonical transcript is unchanged.`;
  }

  enableAutoForSession(): void {
    this.#sessionMode = "auto-session";
  }

  pauseAuto(): void {
    this.#sessionMode = "paused";
  }

  async saveAutoDefault(): Promise<string> {
    const saved = await saveUserContextMode({
      cwd: this.#cwd,
      env: this.#env,
      mode: "compact",
    });
    this.#context = { ...this.#context, mode: "compact" };
    this.#sessionMode = "auto-default";
    return saved;
  }

  #resetTransientContext(): void {
    this.#sessionMode =
      this.#context.mode === "compact" ? "auto-default" : this.#context.mode;
    this.#lastPressure = undefined;
    this.#lastCompaction = undefined;
  }

  selectModel(
    provider: string,
    modelId: string,
    contextWindowTokens?: number,
  ): void {
    this.#lastPressure = undefined;
    this.#context = {
      ...this.#context,
      provider,
      modelId,
      contextWindowTokens:
        contextWindowTokens ?? contextWindowFor(provider, modelId),
    };
  }
}

export async function createPersistentInteractiveSession(options: {
  readonly cwd: string;
  readonly env: NodeJS.ProcessEnv;
  readonly sessionId?: string;
  readonly last?: boolean;
}): Promise<PersistentInteractiveSession> {
  const loaded = await loadForgeConfig({ cwd: options.cwd, env: options.env });
  const workspace = {
    root: loaded.workspaceRoot,
    cwd: loaded.workingDirectory,
  };
  const store = new FileSessionStore(loaded.forgeHome, {
    secrets: configuredSecrets(options.env),
  });
  const traceStore = new FileTraceStore(loaded.forgeHome);
  let snapshot: SessionSnapshot | undefined;
  if (options.sessionId) {
    snapshot = await store.loadForWorkspace(options.sessionId, workspace.root);
  } else if (options.last) {
    snapshot = await store.latest(workspace.root);
  }
  if (snapshot) {
    const restored = await restoreReasoningFromTraces(snapshot, traceStore);
    if (restored !== snapshot) {
      snapshot = restored;
      await store.save(restored);
    }
  }
  return new PersistentInteractiveSession({
    store,
    traceStore,
    workspace,
    cwd: options.cwd,
    env: options.env,
    ...(snapshot ? { snapshot } : {}),
    context: {
      mode: loaded.config.context.mode,
      provider: loaded.config.model.provider,
      modelId: loaded.config.model.id,
      recentTailTokens: loaded.config.context.recentTailTokens,
      summaryTargetTokens: loaded.config.context.summaryTargetTokens,
      reservedOutputTokens: loaded.config.context.reservedOutputTokens,
      bufferTokens: loaded.config.context.bufferTokens,
      contextWindowTokens: contextWindowFor(
        loaded.config.model.provider,
        loaded.config.model.id,
        loaded.config.providers,
      ),
      secrets: configuredSecrets(options.env),
      activationThreshold: loaded.config.context.activationThreshold,
      minimumReclaimTokens: loaded.config.context.minimumReclaimTokens,
      minimumReclaimRatio: loaded.config.context.minimumReclaimRatio,
    },
  });
}

async function restoreReasoningFromTraces(
  snapshot: SessionSnapshot,
  traceStore: FileTraceStore,
): Promise<SessionSnapshot> {
  if (snapshot.runIds.length === 0 || snapshot.messages.length === 0) {
    return snapshot;
  }

  const assistantMessageIndices = snapshot.messages.flatMap((message, index) =>
    message.role === "assistant" ? [index] : [],
  );
  const reasoning = [...snapshot.reasoning];
  const savedIndexes = new Set(
    reasoning.map((entry) => entry.assistantMessageIndex),
  );
  let assistantCursor = 0;

  for (const runId of snapshot.runIds) {
    let events: Awaited<ReturnType<FileTraceStore["read"]>>;
    try {
      events = await traceStore.read(runId);
    } catch {
      // Traces are optional. A missing or old trace must not prevent resume.
      continue;
    }

    const answer = events
      .flatMap(({ event }) => (event.type === "model.text" ? [event.text] : []))
      .join("");
    if (answer === "") continue;
    const completed = events.some(
      ({ event }) =>
        event.type === "run.completed" || event.type === "model.completed",
    );
    if (!completed) continue;

    const assistantMessageIndex = assistantMessageIndices[assistantCursor];
    assistantCursor += 1;
    if (
      assistantMessageIndex === undefined ||
      savedIndexes.has(assistantMessageIndex)
    ) {
      continue;
    }

    const reasoningText = events
      .flatMap(({ event }) =>
        event.type === "model.reasoning" ? [event.text] : [],
      )
      .join("");
    const unavailable = events
      .flatMap(({ event }) =>
        event.type === "model.reasoning-unavailable"
          ? [
              `Provider used ${event.reasoningTokens} reasoning tokens but did not return reasoning text.`,
            ]
          : [],
      )
      .join("\n");
    const content = reasoningText || unavailable;
    if (content === "") continue;
    reasoning.push({ assistantMessageIndex, content });
    savedIndexes.add(assistantMessageIndex);
  }

  return reasoning.length === snapshot.reasoning.length
    ? snapshot
    : { ...snapshot, reasoning };
}

function persistedReasoning(
  events: readonly RunResult["events"][number][],
): string {
  const reasoningText = events
    .flatMap((event) => (event.type === "model.reasoning" ? [event.text] : []))
    .join("");
  if (reasoningText !== "") return reasoningText;
  return events
    .flatMap((event) =>
      event.type === "model.reasoning-unavailable"
        ? [
            `Provider used ${event.reasoningTokens} reasoning tokens but did not return reasoning text.`,
          ]
        : [],
    )
    .join("\n");
}

function contextWindowFor(
  provider: string,
  modelId: string,
  providers: Readonly<Record<string, ProviderProfile>> = {},
): number {
  const configured = providers[provider]?.models?.find(
    (model) => model.id === modelId,
  )?.contextWindow;
  if (configured !== undefined) return configured;
  return (
    (provider === "deepseek"
      ? deepSeekModelContext(modelId)
      : provider === "openai"
        ? openAIModelContext(modelId)
        : undefined
    )?.window ?? 32_768
  );
}
