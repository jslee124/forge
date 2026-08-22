import { loadForgeConfig } from "@forge/config";
import type {
  ModelConversationMessage,
  RunResult,
  WorkspaceContext,
} from "@forge/core";
import { deepSeekModelContext } from "@forge/model-deepseek";
import { openAIModelContext } from "@forge/model-openai";
import {
  type ContextCheckpoint,
  configuredSecrets,
  createForgeSummaryCheckpoint,
  FileSessionStore,
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
  prepareRun(): Promise<string>;
  recordRun(
    prompt: string,
    result: RunResult,
    metadata: RunMetadata,
  ): Promise<void>;
  clear(): void;
  list(): Promise<readonly SessionSummary[]>;
  resume(sessionId: string): Promise<readonly ModelConversationMessage[]>;
  contextDetails?(): ContextStatus;
  contextStatus?(): string;
  compact?(dryRun: boolean): Promise<string>;
  selectModel?(provider: string, modelId: string): void;
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
}

export interface ContextStatus {
  readonly provider: string;
  readonly modelId: string;
  readonly mode: PersistentContextOptions["mode"];
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
  readonly #workspace: WorkspaceContext;
  #snapshot: SessionSnapshot | undefined;
  #context: PersistentContextOptions;

  constructor(options: {
    readonly store: FileSessionStore;
    readonly workspace: WorkspaceContext;
    readonly snapshot?: SessionSnapshot;
    readonly context: PersistentContextOptions;
  }) {
    this.#store = options.store;
    this.#workspace = options.workspace;
    this.#snapshot = options.snapshot;
    this.#context = options.context;
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

  async prepareRun(): Promise<string> {
    if (!this.#snapshot) {
      this.#snapshot = this.#store.create(this.#workspace);
    }
    if (
      this.#context.mode === "compact" &&
      this.#snapshot.messages.length > 0 &&
      !isCheckpointValid(this.#snapshot)
    ) {
      const preview = previewSessionCompaction(this.#snapshot, this.#context);
      if (preview.eligibleMessageCount > 0) {
        const compacted = createForgeSummaryCheckpoint(
          this.#snapshot,
          this.#context,
        );
        await this.#store.save(compacted);
        this.#snapshot = compacted;
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
      reasoning: result.events
        .flatMap((event) =>
          event.type === "model.reasoning" ? [event.text] : [],
        )
        .join(""),
      status: result.status,
      runId: metadata.runId,
    });
    if (this.#snapshot.messages.length > 0) {
      await this.#store.save(this.#snapshot);
    }
  }

  clear(): void {
    this.#snapshot = undefined;
  }

  list(): Promise<readonly SessionSummary[]> {
    return this.#store.list(this.#workspace.root);
  }

  async resume(
    sessionId: string,
  ): Promise<readonly ModelConversationMessage[]> {
    this.#snapshot = await this.#store.loadForWorkspace(
      sessionId,
      this.#workspace.root,
    );
    return this.#snapshot.messages;
  }

  contextDetails(): ContextStatus {
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

    return {
      provider: this.#context.provider,
      modelId: this.#context.modelId,
      mode: this.#context.mode,
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
    return `Compacted ${preview.eligibleMessageCount} completed messages into an untrusted conversation-memory checkpoint. Retained ${preview.retainedMessageCount} recent messages verbatim; the full canonical transcript is unchanged.`;
  }

  selectModel(provider: string, modelId: string): void {
    this.#context = {
      ...this.#context,
      provider,
      modelId,
      contextWindowTokens: contextWindowFor(provider, modelId),
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
  let snapshot: SessionSnapshot | undefined;
  if (options.sessionId) {
    snapshot = await store.loadForWorkspace(options.sessionId, workspace.root);
  } else if (options.last) {
    snapshot = await store.latest(workspace.root);
  }
  return new PersistentInteractiveSession({
    store,
    workspace,
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
      ),
      secrets: configuredSecrets(options.env),
    },
  });
}

function contextWindowFor(provider: string, modelId: string): number {
  return (
    (provider === "deepseek"
      ? deepSeekModelContext(modelId)
      : openAIModelContext(modelId)
    )?.window ?? 32_768
  );
}
