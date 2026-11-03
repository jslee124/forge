import { constants } from "node:fs";
import {
  lstat,
  open,
  readdir,
  realpath,
  rm,
  unlink,
  writeFile,
} from "node:fs/promises";
import { join } from "node:path";
import { acquireWorkspaceLease, ExecutionLease } from "./execution-lease.js";
import { sessionSnapshotSchema, traceEnvelopeSchema } from "./schema.js";
import { FileSessionStore, PersistenceError } from "./session-store.js";

function missing(error: unknown): boolean {
  return error instanceof Error && "code" in error && error.code === "ENOENT";
}

async function directory(path: string): Promise<boolean> {
  const metadata = await lstat(path).catch((error: unknown) => {
    if (missing(error)) return undefined;
    throw error;
  });
  if (!metadata) return false;
  if (!metadata.isDirectory() || metadata.isSymbolicLink())
    throw new PersistenceError("Session storage directory is unsafe.");
  return true;
}

/** Deletes local history only. Never removes workspaces or external engine history.
 * A failed cleanup leaves the snapshot available for retry, but permanently blocks
 * stale writers. The marker contains no conversation content.
 */
export async function deleteSession(
  forgeHome: string,
  sessionId: string,
  workspaceRoot?: string,
): Promise<void> {
  sessionSnapshotSchema.shape.id.parse(sessionId);
  const home = await realpath(forgeHome);
  if (!(await directory(join(home, "sessions"))))
    throw new PersistenceError("Session storage is unavailable.");
  const file = join(home, "sessions", `${sessionId}.json`);
  const legacy = await lstat(
    join(home, "sessions", `${sessionId}.desktop-lock`),
  ).catch((error: unknown) => {
    if (missing(error)) return undefined;
    throw error;
  });
  if (legacy) throw new Error("session-busy");
  const sessionLease = await ExecutionLease.acquire(
    `desktop-session:${home}:${sessionId}`,
  ).catch(() => {
    throw new Error("session-busy");
  });
  let workspaceLease: ExecutionLease | undefined;
  let lock: Awaited<ReturnType<typeof open>> | undefined;
  try {
    const store = new FileSessionStore(home);
    if (!(await lstat(file)).isFile())
      throw new PersistenceError("Session snapshot is unsafe.");
    const snapshot = await store.load(sessionId);
    if (workspaceRoot !== undefined && snapshot.workspaceRoot !== workspaceRoot)
      throw new PersistenceError("Session belongs to a different workspace.");
    workspaceLease = await acquireWorkspaceLease(snapshot.workspaceRoot)
      .catch(async (error: unknown) => {
        if (!missing(error)) throw error;
        return ExecutionLease.acquire(`workspace:${snapshot.workspaceRoot}`);
      })
      .catch((error: unknown) => {
        if (
          error instanceof Error &&
          error.message.startsWith("workspace-busy")
        )
          throw new Error("session-busy", { cause: error });
        throw error;
      });
    lock = await open(`${file}.write-lock`, "wx", 0o600);
    // Recheck after taking both locks; a concurrent writer may have just finished.
    const current = await store.load(sessionId);
    if (current.workspaceRoot !== snapshot.workspaceRoot)
      throw new PersistenceError("Session workspace changed; retry deletion.");
    await writeFile(`${file}.deleted`, "", { mode: 0o600, flag: "wx" }).catch(
      async (error: unknown) => {
        if (
          !(
            error instanceof Error &&
            "code" in error &&
            error.code === "EEXIST"
          )
        )
          throw error;
        if (!(await lstat(`${file}.deleted`)).isFile())
          throw new PersistenceError("Session deletion marker is unsafe.");
      },
    );
    const runIds = new Set(current.runIds);
    const records = join(home, "run-records");
    if (await directory(records)) {
      const sessionRecords = join(records, sessionId);
      if (await directory(sessionRecords)) {
        for (const entry of await readdir(sessionRecords))
          if (traceEnvelopeSchema.shape.runId.safeParse(entry).success)
            runIds.add(entry);
      }
    }
    const traces = join(home, "runs");
    if (await directory(traces)) {
      const candidates: {
        target: string;
        runId: string;
        parentRunId?: string;
      }[] = [];
      // Include uncommitted runs and subagents, including older child envelopes
      // that carry only a parent run ID. Read identity before the event payload.
      for (const entry of await readdir(traces)) {
        if (!entry.endsWith(".jsonl")) continue;
        const runId = entry.slice(0, -6);
        if (!traceEnvelopeSchema.shape.runId.safeParse(runId).success) continue;
        const target = join(traces, entry);
        if (runIds.has(runId)) {
          candidates.push({ target, runId });
          continue;
        }
        const handle = await open(
          target,
          constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0),
        );
        try {
          const buffer = Buffer.alloc(4096);
          const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
          const prefix = buffer.subarray(0, bytesRead).toString("utf8");
          const eventIndex = prefix.indexOf('"event":');
          if (eventIndex < 0) continue;
          let identity: { sessionId?: string; parentRunId?: string };
          try {
            identity = JSON.parse(
              `${prefix.slice(0, eventIndex)}"event":null}`,
            );
          } catch {
            continue;
          }
          if (identity.sessionId === sessionId) runIds.add(runId);
          // An explicit different session ID always wins over parent linkage.
          candidates.push({
            target,
            runId,
            ...(identity.sessionId === undefined &&
            traceEnvelopeSchema.shape.parentRunId
              .unwrap()
              .safeParse(identity.parentRunId).success
              ? { parentRunId: identity.parentRunId }
              : {}),
          });
        } finally {
          await handle.close();
        }
      }
      let expanded = true;
      while (expanded) {
        expanded = false;
        for (const candidate of candidates) {
          if (
            candidate.parentRunId &&
            runIds.has(candidate.parentRunId) &&
            !runIds.has(candidate.runId)
          ) {
            runIds.add(candidate.runId);
            expanded = true;
          }
        }
      }
      for (const candidate of candidates)
        if (runIds.has(candidate.runId)) await unlink(candidate.target);
    }
    if (await directory(records)) {
      const sessionRecords = join(records, sessionId);
      if (await directory(sessionRecords))
        await rm(sessionRecords, { recursive: true });
    }
    await unlink(file);
  } finally {
    try {
      if (lock) {
        try {
          await lock.close();
        } finally {
          await unlink(`${file}.write-lock`);
        }
      }
    } finally {
      try {
        await workspaceLease?.release();
      } finally {
        await sessionLease.release();
      }
    }
  }
}
