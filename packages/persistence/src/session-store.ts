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
  ModelConversationMessage,
  RunStatus,
  WorkspaceContext,
} from "@forge/core";

import { redactValue } from "./redaction.js";
import {
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
    return {
      schemaVersion: 1,
      id: randomUUID(),
      createdAt: now,
      updatedAt: now,
      workspaceRoot: workspace.root,
      workingDirectory: workspace.cwd,
      messages: [],
      runIds: [],
    };
  }

  async save(snapshot: SessionSnapshot): Promise<void> {
    const validated = sessionSnapshotSchema.parse(snapshot) as SessionSnapshot;
    await mkdir(this.#sessionsDirectory, { recursive: true, mode: 0o700 });
    const target = this.#pathFor(validated.id);
    const temporary = `${target}.${randomUUID()}.tmp`;
    const serialized = `${JSON.stringify(redactValue(validated, this.#secrets), null, 2)}\n`;
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
      return sessionSnapshotSchema.parse(JSON.parse(text)) as SessionSnapshot;
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

export function recordRunInSession(
  snapshot: SessionSnapshot,
  options: {
    readonly prompt: string;
    readonly finalText: string;
    readonly status: RunStatus;
    readonly runId: string;
  },
): SessionSnapshot {
  const messages: ModelConversationMessage[] = [...snapshot.messages];
  if (options.status === "completed") {
    messages.push({ role: "user", content: options.prompt });
    if (options.finalText !== "") {
      messages.push({ role: "assistant", content: options.finalText });
    }
  }
  return {
    ...snapshot,
    updatedAt: new Date().toISOString(),
    messages,
    runIds: [...snapshot.runIds, options.runId],
    lastRunStatus: options.status,
  };
}

function toSummary(snapshot: SessionSnapshot): SessionSummary {
  const firstUserMessage = snapshot.messages.find(
    ({ role }) => role === "user",
  )?.content;
  const title =
    firstUserMessage?.split(/\r?\n/u)[0]?.trim().slice(0, 80) ||
    "Empty session";
  return {
    id: snapshot.id,
    updatedAt: snapshot.updatedAt,
    workspaceRoot: snapshot.workspaceRoot,
    workingDirectory: snapshot.workingDirectory,
    title,
    messageCount: snapshot.messages.length,
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
