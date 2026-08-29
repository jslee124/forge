import {
  loadForgeConfig,
  type ProviderProfile,
  saveUserContextMode,
} from "@forge/config";
import type {
  CanonicalConversationMessage,
  ContextPressureSnapshot,
  ModelConversationMessage,
  RunEvent,
  RunResult,
  RunStatus,
  WorkspaceContext,
} from "@forge/core";
import {
  canonicalText,
  conservativeTextTokens,
  runConversationMessages,
} from "@forge/core";
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
  readonly history?: readonly ModelConversationMessage[];
  readonly reasoning?: readonly SessionReasoning[];
  readonly historyEvents?: readonly RunEvent[];
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
  #historyEvents: readonly RunEvent[] | undefined;
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
    readonly historyEvents?: readonly RunEvent[];
    readonly context: PersistentContextOptions;
    readonly cwd: string;
    readonly env: NodeJS.ProcessEnv;
  }) {
    this.#store = options.store;
    this.#traceStore = options.traceStore;
    this.#workspace = options.workspace;
    this.#snapshot = options.snapshot;
    this.#historyEvents = options.historyEvents;
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

  get history(): readonly ModelConversationMessage[] {
    return this.#snapshot?.history ?? [];
  }

  get sessionId(): string | undefined {
    return this.#snapshot?.id;
  }

  get reasoning(): readonly SessionReasoning[] {
    return this.#snapshot?.reasoning ?? [];
  }

  get historyEvents(): readonly RunEvent[] {
    return this.#historyEvents ?? [];
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
      this.#snapshot.history.length > 0 &&
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
      events: result.events,
      ...(result.canonicalDelta
        ? { canonicalDelta: result.canonicalDelta }
        : {}),
      ...(result.message ? { message: result.message } : {}),
    });
    if (this.#historyEvents) {
      this.#historyEvents = [...this.#historyEvents, ...result.events];
    }
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
    if (this.#snapshot.history.length > 0) {
      await this.#store.save(this.#snapshot);
    }
  }

  clear(): void {
    this.#snapshot = undefined;
    this.#historyEvents = undefined;
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
    const migrated = await restoreSessionHistoryFromTraces(
      this.#snapshot,
      this.#traceStore,
    );
    const restored =
      migrated !== this.#snapshot
        ? migrated
        : await restoreReasoningFromTraces(this.#snapshot, this.#traceStore);
    if (restored !== this.#snapshot) {
      await this.#store.save(restored);
      this.#snapshot = await this.#store.load(restored.id);
    }
    this.#historyEvents = await readSessionHistoryEvents(
      this.#snapshot,
      this.#traceStore,
    );
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
    const messageCount = this.#snapshot?.history.length ?? 0;
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
      return `Compaction preview: summarize ${preview.eligibleMessageCount} historical messages, retain ${preview.retainedMessageCount} recent messages; estimated ${preview.estimatedBeforeTokens} -> ${preview.estimatedAfterTokens} tokens. The canonical transcript will remain unchanged.`;
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
  let historyEvents: readonly RunEvent[] | undefined;
  if (options.sessionId) {
    snapshot = await store.loadForWorkspace(options.sessionId, workspace.root);
  } else if (options.last) {
    snapshot = await store.latest(workspace.root);
  }
  if (snapshot) {
    const migrated = await restoreSessionHistoryFromTraces(
      snapshot,
      traceStore,
    );
    const restored =
      migrated !== snapshot
        ? migrated
        : await restoreReasoningFromTraces(snapshot, traceStore);
    if (restored !== snapshot) {
      await store.save(restored);
      snapshot = await store.load(restored.id);
    }
    historyEvents = await readSessionHistoryEvents(snapshot, traceStore);
  }
  return new PersistentInteractiveSession({
    store,
    traceStore,
    workspace,
    cwd: options.cwd,
    env: options.env,
    ...(snapshot ? { snapshot } : {}),
    ...(historyEvents ? { historyEvents } : {}),
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

async function readSessionHistoryEvents(
  snapshot: SessionSnapshot,
  traceStore: FileTraceStore,
): Promise<readonly RunEvent[] | undefined> {
  if (snapshot.runIds.length === 0) return undefined;
  const events: RunEvent[] = [];
  for (const runId of snapshot.runIds) {
    try {
      const envelopes = await traceStore.read(runId);
      events.push(...envelopes.map(({ event }) => event));
    } catch {
      // A partial replay is more misleading than the canonical-message fallback.
      return undefined;
    }
  }
  return events.length > 0 ? events : undefined;
}

async function restoreSessionHistoryFromTraces(
  snapshot: SessionSnapshot,
  traceStore: FileTraceStore,
): Promise<SessionSnapshot> {
  if (
    snapshot.runIds.length === 0 ||
    snapshot.historyFidelity === "structured"
  ) {
    return snapshot;
  }

  const history: CanonicalConversationMessage[] = [];
  const reasoning: SessionReasoning[] = [];
  for (const runId of snapshot.runIds) {
    let envelopes: Awaited<ReturnType<FileTraceStore["read"]>>;
    try {
      envelopes = await traceStore.read(runId);
    } catch {
      // Migration must be lossless. One missing trace leaves the old snapshot intact.
      return snapshot;
    }
    const events = envelopes.map(({ event }) => event);
    const prompt = events.find(
      (
        event,
      ): event is Extract<
        (typeof events)[number],
        { readonly type: "run.started" }
      > => event.type === "run.started",
    )?.prompt;
    const status = terminalRunStatus(events);
    if (!prompt || !status) return snapshot;

    const messageStart = history.length;
    const runMessages = canonicalTraceRun(runId, prompt, status, events);
    if (!runMessages) return snapshot;
    history.push(...runMessages);
    const reasoningText = persistedReasoning(events);
    const assistantOffset = runMessages.findIndex(
      ({ role }) => role === "assistant",
    );
    if (status === "completed" && reasoningText && assistantOffset !== -1) {
      reasoning.push({
        assistantMessageIndex: messageStart + assistantOffset,
        content: reasoningText,
      });
    }
  }

  if (!isMessageSubsequence(snapshot.messages, history)) {
    return snapshot;
  }
  const { contextCheckpoint, ...base } = snapshot;
  return {
    ...base,
    updatedAt: new Date().toISOString(),
    history,
    messages: history.flatMap((message) =>
      message.role === "tool"
        ? []
        : [{ role: message.role, content: canonicalText(message) }],
    ),
    reasoning,
    historyFidelity: "structured",
  };
}

function canonicalTraceRun(
  runId: string,
  prompt: string,
  status: RunStatus,
  events: readonly RunEvent[],
): readonly CanonicalConversationMessage[] | undefined {
  const history: CanonicalConversationMessage[] = [
    {
      id: `${runId}:user`,
      runId,
      role: "user",
      content: [{ type: "text", text: prompt }],
    },
  ];
  const completedSteps = events.flatMap((event) =>
    event.type === "model.completed" ? [event.step] : [],
  );
  for (const step of completedSteps) {
    const text = events
      .flatMap((event) =>
        event.type === "model.text" && event.step === step ? [event.text] : [],
      )
      .join("");
    const calls = events.flatMap((event) =>
      event.type === "tool.proposed" && event.step === step ? [event.call] : [],
    );
    if (calls.length === 0) {
      if (status === "completed" && text) {
        history.push({
          id: `${runId}:assistant:${step}`,
          runId,
          step,
          role: "assistant",
          content: [{ type: "text", text }],
        });
      }
      continue;
    }
    const returnedToModel = events.some(
      (event) => event.type === "model.started" && event.step > step,
    );
    if (!returnedToModel) continue;
    const results = calls.map((call) =>
      events.find(
        (
          event,
        ): event is Extract<
          RunEvent,
          { readonly type: "tool.completed" | "tool.failed" }
        > =>
          (event.type === "tool.completed" || event.type === "tool.failed") &&
          event.step === step &&
          event.call.id === call.id,
      ),
    );
    if (results.some((result) => result === undefined)) return undefined;
    history.push({
      id: `${runId}:assistant:${step}`,
      runId,
      step,
      role: "assistant",
      content: [
        ...(text ? [{ type: "text" as const, text }] : []),
        ...calls.map((call) => ({
          type: "tool-call" as const,
          id: call.id,
          name: call.name,
          input: call.input,
        })),
      ],
    });
    for (const [index, result] of results.entries()) {
      if (!result) return undefined;
      history.push({
        id: `${runId}:tool:${step}:${index}`,
        runId,
        step,
        role: "tool",
        toolCallId: result.call.id,
        toolName: result.call.name,
        content: [{ type: "text", text: JSON.stringify(result.result) }],
        isError: !result.result.ok,
      });
    }
  }
  if (status === "completed") {
    const finalTextEvents = events.flatMap((event) =>
      event.type === "model.text"
        ? [{ step: event.step, text: event.text }]
        : [],
    );
    const finalStep = finalTextEvents.at(-1)?.step;
    if (
      finalStep !== undefined &&
      !history.some(
        (message) => message.role === "assistant" && message.step === finalStep,
      )
    ) {
      const text = finalTextEvents
        .filter(({ step }) => step === finalStep)
        .map(({ text }) => text)
        .join("");
      if (text) {
        history.push({
          id: `${runId}:assistant:${finalStep}`,
          runId,
          step: finalStep,
          role: "assistant",
          content: [{ type: "text", text }],
        });
      }
    }
  }
  if (status !== "completed") {
    const outcome = runConversationMessages(prompt, {
      status,
      finalText: "",
      events,
    }).at(-1);
    if (outcome?.role === "assistant") {
      history.push({
        id: `${runId}:outcome`,
        runId,
        step: Number.MAX_SAFE_INTEGER,
        role: "assistant",
        content: [{ type: "text", text: canonicalText(outcome) }],
      });
    }
  }
  return history;
}

function terminalRunStatus(
  events: readonly RunResult["events"][number][],
): RunStatus | undefined {
  for (const event of [...events].reverse()) {
    switch (event.type) {
      case "run.completed":
        return "completed";
      case "run.failed":
        return "failed";
      case "run.cancelled":
        return "cancelled";
      case "run.denied":
        return "denied";
      case "run.limit_reached":
        return "limit_reached";
      default:
        break;
    }
  }
  return undefined;
}

function isMessageSubsequence(
  existing: readonly ModelConversationMessage[],
  reconstructed: readonly ModelConversationMessage[],
): boolean {
  let cursor = 0;
  for (const message of reconstructed) {
    const expected = existing[cursor];
    if (
      expected &&
      expected.role === message.role &&
      canonicalText(expected) === canonicalText(message)
    ) {
      cursor += 1;
    }
  }
  return cursor === existing.length;
}

async function restoreReasoningFromTraces(
  snapshot: SessionSnapshot,
  traceStore: FileTraceStore,
): Promise<SessionSnapshot> {
  if (snapshot.runIds.length === 0 || snapshot.history.length === 0) {
    return snapshot;
  }

  const assistantMessageIndices = snapshot.history.flatMap((message, index) =>
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
