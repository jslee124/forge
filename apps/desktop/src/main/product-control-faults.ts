import { createHash } from "node:crypto";
import {
  lstat,
  mkdir,
  readdir,
  readFile,
  rename,
  rmdir,
} from "node:fs/promises";
import { join } from "node:path";

export async function workspaceHashes(root: string) {
  const result: Record<string, string> = {};
  async function walk(directory: string, prefix = "") {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.isDirectory())
        await walk(join(directory, entry.name), relative);
      else if (entry.isFile())
        result[relative] = createHash("sha256")
          .update(await readFile(join(directory, entry.name)))
          .digest("hex");
      else throw new Error("Nonregular control fixture entry");
    }
  }
  await walk(root);
  return result;
}
export function changedPaths(
  before: Record<string, string>,
  after: Record<string, string>,
) {
  return [...new Set([...Object.keys(before), ...Object.keys(after)])].filter(
    (path) => before[path] !== after[path],
  );
}
/** Reversible test-only write failure. Keep the original journal bytes intact. */
export async function blockControlJournal(
  home: string,
  sessionId: string,
  runId: string,
) {
  for (const id of [sessionId, runId])
    if (!/^[a-zA-Z0-9_-]{1,128}$/.test(id))
      throw new Error("Invalid control run identity");
  const directory = join(home, "run-records", sessionId, runId);
  const journal = join(directory, "events.jsonl");
  const saved = join(directory, "events.before-injection.jsonl");
  const metadata = await lstat(journal);
  if (!metadata.isFile() || metadata.isSymbolicLink())
    throw new Error("Expected a regular journal");
  await lstat(saved).then(
    () => {
      throw new Error("Original injection already retained");
    },
    (error: NodeJS.ErrnoException) => {
      if (error.code !== "ENOENT") throw error;
    },
  );
  const bytes = await readFile(journal);
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  await rename(journal, saved);
  try {
    await mkdir(journal);
  } catch (error) {
    await rename(saved, journal);
    throw error;
  }
  let restored = false;
  return {
    journal,
    sha256,
    async restore() {
      if (restored) return;
      // Remove only our empty blocker; unexpected new content is never recursively deleted.
      await rmdir(journal);
      await rename(saved, journal);
      restored = true;
      if (
        createHash("sha256")
          .update(await readFile(journal))
          .digest("hex") !== sha256
      )
        throw new Error("Original journal changed during injection");
    },
  };
}
export async function waitFor<T>(
  read: () => Promise<T | undefined>,
  label: string,
  milliseconds = 5000,
): Promise<T> {
  const deadline = Date.now() + milliseconds;
  do {
    const value = await read();
    if (value !== undefined) return value;
    await new Promise((resolve) => setTimeout(resolve, 20));
  } while (Date.now() < deadline);
  throw new Error(`Control fixture timed out: ${label}`);
}
export async function commandPid(workspace: string, marker: string) {
  return waitFor(async () => {
    try {
      const value = JSON.parse(
        await readFile(join(workspace, marker), "utf8"),
      ).pid;
      if (!Number.isSafeInteger(value) || value <= 1)
        throw new Error("Invalid control PID");
      process.kill(value, 0);
      return value as number;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      return undefined;
    }
  }, "command PID");
}
export async function waitForPidExit(pid: number) {
  await waitFor(async () => {
    try {
      process.kill(pid, 0);
      return undefined;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ESRCH") return true;
      throw error;
    }
  }, "owned process exit");
}
