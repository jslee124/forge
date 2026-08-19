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
  type SessionSnapshot,
  type SessionSummary,
} from "@forge/persistence";

import type { RunMetadata } from "./run.js";

export interface InteractiveSessionPersistence {
  readonly messages: readonly ModelConversationMessage[];
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

  contextStatus(): string {
    if (!this.#snapshot || this.#snapshot.messages.length === 0) {
      return [
        `Context: ${this.#context.provider}/${this.#context.modelId} window=${this.#context.contextWindowTokens}.`,
        `Budget: output=${this.#context.reservedOutputTokens} buffer=${this.#context.bufferTokens} effectiveReserve=${Math.max(this.#context.reservedOutputTokens, this.#context.bufferTokens)} recentTail=${this.#context.recentTailTokens} summaryTarget=${this.#context.summaryTargetTokens}.`,
        "Canonical transcript: 0 messages.",
      ].join("\n");
    }
    const preview = previewSessionCompaction(this.#snapshot, this.#context);
    const checkpoint = this.#snapshot.contextCheckpoint;
    const checkpointStatus = checkpoint
      ? isCheckpointValid(this.#snapshot)
        ? `${checkpoint.strategy}, messages 0-${checkpoint.summarizedThroughMessageIndex - 1}, ${checkpoint.estimatedCheckpointTokens} estimated tokens`
        : "stale (not used)"
      : "none";
    return [
      `Model: ${this.#context.provider}/${this.#context.modelId} window=${this.#context.contextWindowTokens} availableInput=${Math.max(0, this.#context.contextWindowTokens - Math.max(this.#context.reservedOutputTokens, this.#context.bufferTokens))}.`,
      `Configured categories: output=${this.#context.reservedOutputTokens} buffer=${this.#context.bufferTokens} recentTail=${this.#context.recentTailTokens} summaryTarget=${this.#context.summaryTargetTokens}.`,
      `Context: ${this.#snapshot.messages.length} canonical messages (always retained).`,
      `Checkpoint: ${checkpointStatus}.`,
      `Active tail: ${preview.retainedMessageCount} messages from index ${preview.retainedTailStartIndex}.`,
      `Estimated transcript: ${preview.estimatedBeforeTokens} tokens; projected compact view: ${preview.estimatedAfterTokens} tokens.`,
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
