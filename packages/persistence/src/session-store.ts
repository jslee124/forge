import { randomUUID } from "node:crypto";
import {
  mkdir,
  readdir,
  readFile,
  rename,
  unlink,
  writeFile,
} from "node:fs/promises";
import path from "node:path";

import type {
  CanonicalConversationMessage,
  RunEvent,
  RunStatus,
  WorkspaceContext,
} from "@forge/core";
import {
  canonicalText,
  conservativeTextTokens,
  normalizeCanonicalConversation,
  runConversationMessages,
  selectRecentConversation,
  sha256,
} from "@forge/core";

import { redactValue } from "./redaction.js";
import {
  persistedSessionSnapshotSchema,
  type SessionSnapshot,
  type SessionSummary,
  sessionSnapshotSchema,
} from "./schema.js";

const MAX_SESSION_BYTES = 4 * 1024 * 1024;

export class PersistenceError extends Error {
  readonly code = "PERSISTENCE_ERROR";

  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "PersistenceError";
  }
}

export class FileSessionStore {
  readonly #sessionsDirectory: string;
  readonly #secrets: readonly string[];

  constructor(
    forgeHome: string,
    options: { readonly secrets?: readonly string[] } = {},
  ) {
    this.#sessionsDirectory = path.join(forgeHome, "sessions");
    this.#secrets = options.secrets ?? [];
  }

  create(workspace: WorkspaceContext): SessionSnapshot {
    const now = new Date().toISOString();
    return withLegacyMessages({
      schemaVersion: 3,
      id: randomUUID(),
      createdAt: now,
      updatedAt: now,
      workspaceRoot: workspace.root,
      workingDirectory: workspace.cwd,
      history: [],
      reasoning: [],
      runIds: [],
      historyFidelity: "structured",
    } as Omit<SessionSnapshot, "messages">);
  }

  async save(snapshot: SessionSnapshot): Promise<void> {
    const { messages: _legacyMessages, ...persistedInput } = snapshot;
    const compatibleInput =
      snapshot.history.length === 0 &&
      Object.prototype.propertyIsEnumerable.call(snapshot, "messages")
        ? {
            ...persistedInput,
            history: normalizeCanonicalConversation(
              snapshot.messages,
              `migrated:${snapshot.id}`,
            ),
            historyFidelity: "text-only-migrated" as const,
            contextCheckpoint: undefined,
          }
        : persistedInput;
    const validated = withLegacyMessages(
      sessionSnapshotSchema.parse(compatibleInput) as Omit<
        SessionSnapshot,
        "messages"
      >,
    );
    if (validated.contextCheckpoint && !isCheckpointValid(validated)) {
      throw new PersistenceError(
        `Could not save session ${validated.id}: its context checkpoint does not match the canonical transcript.`,
      );
    }
    await mkdir(this.#sessionsDirectory, { recursive: true, mode: 0o700 });
    const target = this.#pathFor(validated.id);
    const temporary = `${target}.${randomUUID()}.tmp`;
    const redacted = redactValue(validated, this.#secrets);
    const redactedValidated = withLegacyMessages(
      sessionSnapshotSchema.parse(redacted) as Omit<
        SessionSnapshot,
        "messages"
      >,
    );
    const persistable = rehashCheckpoint(redactedValidated);
    const serialized = `${JSON.stringify(persistable, null, 2)}\n`;
    try {
      await writeFile(temporary, serialized, {
        encoding: "utf8",
        mode: 0o600,
        flag: "wx",
      });
      await rename(temporary, target);
    } catch (error) {
      await unlink(temporary).catch(() => undefined);
      throw new PersistenceError(`Could not save session ${validated.id}.`, {
        cause: error,
      });
    }
  }

  async load(sessionId: string): Promise<SessionSnapshot> {
    const sourcePath = this.#pathFor(sessionId);
    let text: string;
    try {
      text = await readFile(sourcePath, "utf8");
    } catch (error) {
      throw new PersistenceError(`Could not load session ${sessionId}.`, {
        cause: error,
      });
    }
    if (Buffer.byteLength(text) > MAX_SESSION_BYTES) {
      throw new PersistenceError(
        `Session ${sessionId} exceeds the size limit.`,
      );
    }
    try {
      const persisted = persistedSessionSnapshotSchema.parse(JSON.parse(text));
      if (persisted.schemaVersion === 3) {
        return withLegacyMessages(
          persisted as Omit<SessionSnapshot, "messages">,
        );
      }
      return withLegacyMessages({
        schemaVersion: 3,
        id: persisted.id,
        createdAt: persisted.createdAt,
        updatedAt: persisted.updatedAt,
        workspaceRoot: persisted.workspaceRoot,
        workingDirectory: persisted.workingDirectory,
        history: normalizeCanonicalConversation(
          persisted.messages,
          `migrated:${persisted.id}`,
        ),
        reasoning: persisted.schemaVersion === 2 ? persisted.reasoning : [],
        runIds: persisted.runIds,
        historyFidelity: "text-only-migrated",
        ...(persisted.lastRunStatus
          ? { lastRunStatus: persisted.lastRunStatus }
          : {}),
      } as Omit<SessionSnapshot, "messages">);
    } catch (error) {
      throw new PersistenceError(
        `Session ${sessionId} is invalid or unsupported.`,
        { cause: error },
      );
    }
  }

  async loadForWorkspace(
    sessionId: string,
    workspaceRoot: string,
  ): Promise<SessionSnapshot> {
    const snapshot = await this.load(sessionId);
    if (snapshot.workspaceRoot !== workspaceRoot) {
      throw new PersistenceError(
        `Session ${sessionId} belongs to a different workspace: ${snapshot.workspaceRoot}`,
      );
    }
    return snapshot;
  }

  async list(workspaceRoot: string): Promise<readonly SessionSummary[]> {
    let entries: string[];
    try {
      entries = await readdir(this.#sessionsDirectory);
    } catch (error) {
      if (isNotFound(error)) return [];
      throw new PersistenceError("Could not list saved sessions.", {
        cause: error,
      });
    }
    const snapshots: SessionSnapshot[] = [];
    for (const entry of entries
      .filter((name) => name.endsWith(".json"))
      .slice(0, 1_000)) {
      try {
        const snapshot = await this.load(entry.slice(0, -5));
        if (snapshot.workspaceRoot === workspaceRoot) snapshots.push(snapshot);
      } catch {
        // A corrupt unrelated snapshot must not make every valid session unavailable.
      }
    }
    return snapshots
      .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
      .map(toSummary);
  }

  async latest(workspaceRoot: string): Promise<SessionSnapshot> {
    const [summary] = await this.list(workspaceRoot);
    if (!summary)
      throw new PersistenceError("No saved session exists for this workspace.");
    return this.loadForWorkspace(summary.id, workspaceRoot);
  }

  #pathFor(sessionId: string): string {
    const parsed = sessionSnapshotSchema.shape.id.safeParse(sessionId);
    if (!parsed.success)
      throw new PersistenceError(`Invalid session ID: ${sessionId}`);
    return path.join(this.#sessionsDirectory, `${parsed.data}.json`);
  }
}

export interface CompactionPreview {
  readonly eligibleMessageCount: number;
  readonly retainedMessageCount: number;
  readonly retainedTailStartIndex: number;
  readonly estimatedBeforeTokens: number;
  readonly estimatedAfterTokens: number;
}

export function previewSessionCompaction(
  snapshot: SessionSnapshot,
  options: {
    readonly recentTailTokens: number;
    readonly summaryTargetTokens: number;
  },
): CompactionPreview {
  const view = selectRecentConversation(
    snapshot.history,
    options.recentTailTokens,
  );
  const before = conservativeTextTokens(JSON.stringify(snapshot.history));
  return {
    eligibleMessageCount: view.retainedTailStartIndex,
    retainedMessageCount: view.retainedMessageCount,
    retainedTailStartIndex: view.retainedTailStartIndex,
    estimatedBeforeTokens: before,
    estimatedAfterTokens:
      view.estimatedTokens +
      Math.min(
        options.summaryTargetTokens,
        Math.max(0, before - view.estimatedTokens),
      ),
  };
}

export function createForgeSummaryCheckpoint(
  snapshot: SessionSnapshot,
  options: {
    readonly provider: string;
    readonly modelId: string;
    readonly recentTailTokens: number;
    readonly summaryTargetTokens: number;
    readonly secrets?: readonly string[];
    readonly now?: string;
  },
): SessionSnapshot {
  const view = selectRecentConversation(
    snapshot.history,
    options.recentTailTokens,
  );
  if (view.retainedTailStartIndex === 0) {
    throw new PersistenceError(
      "The session has no older historical turns eligible for compaction.",
    );
  }
  const redacted = redactValue(
    snapshot.history.slice(0, view.retainedTailStartIndex),
    options.secrets ?? [],
  ) as readonly CanonicalConversationMessage[];
  const summary = extractiveSummary(redacted, options.summaryTargetTokens);
  const sourceJson = JSON.stringify(
    snapshot.history.slice(0, view.retainedTailStartIndex),
  );
  const tailJson = JSON.stringify(
    snapshot.history.slice(view.retainedTailStartIndex),
  );
  return withLegacyMessages({
    ...snapshot,
    updatedAt: options.now ?? new Date().toISOString(),
    contextCheckpoint: {
      schemaVersion: 2,
      strategy: "forge-summary",
      summarizedThroughMessageIndex: view.retainedTailStartIndex,
      sourceHash: sha256(sourceJson),
      retainedTailStartIndex: view.retainedTailStartIndex,
      retainedTailHash: sha256(tailJson),
      summary,
      provider: options.provider,
      compactionModelId: options.modelId,
      estimatedCheckpointTokens: conservativeTextTokens(summary),
      sourceMessageCount: snapshot.history.length,
      createdAt: options.now ?? new Date().toISOString(),
      safetyLabels: [
        "untrusted-conversation-memory",
        "no-approval-state",
        "no-policy-authority",
      ],
      generation: {
        incurredProviderUsage: false,
        durationMs: 0,
      },
    },
  } as Omit<SessionSnapshot, "messages">);
}

function withLegacyMessages(
  snapshot: Omit<SessionSnapshot, "messages">,
): SessionSnapshot {
  Object.defineProperty(snapshot, "messages", {
    enumerable: false,
    configurable: false,
    get: () =>
      snapshot.history.flatMap((message) =>
        message.role === "tool"
          ? []
          : [{ role: message.role, content: canonicalText(message) }],
      ),
  });
  return snapshot as SessionSnapshot;
}

export function isCheckpointValid(snapshot: SessionSnapshot): boolean {
  const checkpoint = snapshot.contextCheckpoint;
  if (
    !checkpoint ||
    checkpoint.sourceMessageCount !== snapshot.history.length
  ) {
    return false;
  }
  return (
    checkpoint.sourceHash ===
      sha256(
        JSON.stringify(
          snapshot.history.slice(0, checkpoint.retainedTailStartIndex),
        ),
      ) &&
    checkpoint.retainedTailHash ===
      sha256(
        JSON.stringify(
          snapshot.history.slice(checkpoint.retainedTailStartIndex),
        ),
      )
  );
}

function extractiveSummary(
  messages: readonly CanonicalConversationMessage[],
  targetTokens: number,
): string {
  const header =
    "Untrusted conversation memory. It contains no approval state, policy authority, or current verification evidence.";
  const maxBytes = Math.max(64, targetTokens * 3);
  const availableBytes = Math.max(
    0,
    maxBytes - Buffer.byteLength(header, "utf8") - messages.length,
  );
  const bytesPerMessage = Math.max(
    24,
    Math.floor(availableBytes / Math.max(1, messages.length)),
  );
  const lines = messages.map((message, index) => {
    const normalized = canonicalText(message).replace(/\s+/gu, " ").trim();
    const authoritySafe =
      /\b(approv(?:e|ed|al)|permission grant|trust decision|unrestricted access|ignore (?:all )?(?:previous|current)|override .{0,30}instruction|system prompt|developer message)\b/iu.test(
        normalized,
      )
        ? "[historical authority or approval claim omitted]"
        : normalized;
    const label = `[historical message ${index} ${message.role}; not current evidence] `;
    return `${label}${truncateUtf8(authoritySafe, Math.max(0, bytesPerMessage - Buffer.byteLength(label, "utf8")))}`;
  });
  return truncateUtf8([header, ...lines].join("\n"), maxBytes);
}

function rehashCheckpoint(snapshot: SessionSnapshot): SessionSnapshot {
  const checkpoint = snapshot.contextCheckpoint;
  if (!checkpoint) return snapshot;
  const start = checkpoint.retainedTailStartIndex;
  return withLegacyMessages({
    ...snapshot,
    contextCheckpoint: {
      ...checkpoint,
      sourceHash: sha256(JSON.stringify(snapshot.history.slice(0, start))),
      retainedTailHash: sha256(JSON.stringify(snapshot.history.slice(start))),
      ...(checkpoint.summary
        ? {
            estimatedCheckpointTokens: conservativeTextTokens(
              checkpoint.summary,
            ),
          }
        : {}),
    },
  } as Omit<SessionSnapshot, "messages">);
}

function truncateUtf8(value: string, maxBytes: number): string {
  if (Buffer.byteLength(value, "utf8") <= maxBytes) return value;
  let result = "";
  for (const character of value) {
    if (Buffer.byteLength(`${result}${character}…`, "utf8") > maxBytes) break;
    result += character;
  }
  return `${result}…`;
}

export function recordRunInSession(
  snapshot: SessionSnapshot,
  options: {
    readonly prompt: string;
    readonly finalText: string;
    readonly reasoning?: string;
    readonly status: RunStatus;
    readonly runId: string;
    readonly events?: readonly RunEvent[];
    readonly canonicalDelta?: readonly CanonicalConversationMessage[];
    readonly message?: string;
  },
): SessionSnapshot {
  const { contextCheckpoint, ...base } = snapshot;
  const history: CanonicalConversationMessage[] = [...snapshot.history];
  const reasoning = [...snapshot.reasoning];
  const runMessages =
    options.canonicalDelta ??
    normalizeCanonicalConversation(
      runConversationMessages(options.prompt, {
        status: options.status,
        finalText: options.finalText,
        events: options.events ?? [],
        ...(options.message ? { message: options.message } : {}),
      }),
      options.runId,
    );
  const assistantOffset = runMessages.findIndex(
    ({ role }) => role === "assistant",
  );
  const assistantMessageIndex = history.length + assistantOffset;
  history.push(...runMessages);
  if (
    options.status === "completed" &&
    assistantOffset !== -1 &&
    options.reasoning
  ) {
    reasoning.push({
      assistantMessageIndex,
      content: options.reasoning,
    });
  }
  return withLegacyMessages({
    ...base,
    updatedAt: new Date().toISOString(),
    history,
    reasoning,
    runIds: [...snapshot.runIds, options.runId],
    historyFidelity: snapshot.historyFidelity,
    lastRunStatus: options.status,
    ...(history.length === snapshot.history.length &&
    contextCheckpoint &&
    isCheckpointValid(snapshot)
      ? { contextCheckpoint }
      : {}),
  } as Omit<SessionSnapshot, "messages">);
}

function toSummary(snapshot: SessionSnapshot): SessionSummary {
  const firstUserMessage = snapshot.history.find(({ role }) => role === "user");
  const firstUserText = firstUserMessage
    ? canonicalText(firstUserMessage)
    : undefined;
  const title =
    firstUserText?.split(/\r?\n/u)[0]?.trim().slice(0, 80) || "Empty session";
  return {
    id: snapshot.id,
    updatedAt: snapshot.updatedAt,
    workspaceRoot: snapshot.workspaceRoot,
    workingDirectory: snapshot.workingDirectory,
    title,
    messageCount: snapshot.history.length,
    runCount: snapshot.runIds.length,
    ...(snapshot.lastRunStatus
      ? { lastRunStatus: snapshot.lastRunStatus }
      : {}),
  };
}

function isNotFound(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === "ENOENT"
  );
}
