import { randomUUID } from "node:crypto";
import {
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  realpath,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it } from "vitest";
import { acquireWorkspaceLease, ExecutionLease } from "./execution-lease.js";
import { deleteSession } from "./session-deletion.js";
import { FileSessionStore } from "./session-store.js";
import { JsonlTraceWriter } from "./trace-store.js";

const roots: string[] = [];
afterEach(async () => {
  for (const root of roots.splice(0))
    await rm(root, { recursive: true, force: true });
});
async function fixture() {
  const root = await realpath(await mkdtemp(join(tmpdir(), "forge-delete-")));
  roots.push(root);
  const home = join(root, "home");
  const store = new FileSessionStore(home);
  const snapshot = store.create({ root, cwd: root });
  await store.save(snapshot);
  return { root, home, store, snapshot };
}

it("removes canonical, journal, orphan and child traces while preserving other sessions and files", async () => {
  const { root, home, store, snapshot } = await fixture();
  const runId = randomUUID();
  const childId = randomUUID();
  const journalId = randomUUID();
  const legacyChild = randomUUID();
  const other = store.create({ root, cwd: root });
  await store.save(other);
  await writeFile(join(root, "project.txt"), "keep");
  for (const [id, sessionId] of [
    [runId, snapshot.id],
    [childId, snapshot.id],
    [other.id, other.id],
  ] as const) {
    await new JsonlTraceWriter({
      forgeHome: home,
      runId: id,
      sessionId,
    }).append({ type: "run.started", prompt: "secret" });
  }
  await new JsonlTraceWriter({
    forgeHome: home,
    runId: legacyChild,
    parentRunId: runId,
    subagentName: "legacy-child",
  }).append({ type: "run.started", prompt: "legacy" });
  await mkdir(join(home, "run-records", snapshot.id, journalId), {
    recursive: true,
  });
  await writeFile(
    join(home, "runs", `${journalId}.jsonl`),
    "legacy journal trace",
  );
  await deleteSession(home, snapshot.id);
  expect((await store.list()).map(({ id }) => id)).toEqual([other.id]);
  expect(await readdir(join(home, "runs"))).toEqual([`${other.id}.jsonl`]);
  expect(await readdir(join(home, "run-records"))).toEqual([]);
  expect(await readFile(join(root, "project.txt"), "utf8")).toBe("keep");
  expect(
    await readFile(
      join(home, "sessions", `${snapshot.id}.json.deleted`),
      "utf8",
    ),
  ).toBe("");
  // Both the original store and a fresh writer must reject resurrection.
  await expect(store.save(snapshot)).rejects.toThrow();
  await expect(new FileSessionStore(home).save(snapshot)).rejects.toThrow();
  await expect(new FileSessionStore(home).load(snapshot.id)).rejects.toThrow();
});

it("refuses deletion while another process holds a workspace or desktop session lease", async () => {
  const { root, home, store, snapshot } = await fixture();
  for (const lease of [await acquireWorkspaceLease(root)]) {
    try {
      await expect(deleteSession(home, snapshot.id)).rejects.toThrow();
    } finally {
      await lease.release();
    }
  }
  const lease = await ExecutionLease.acquire(
    `desktop-session:${home}:${snapshot.id}`,
  );
  try {
    await expect(deleteSession(home, snapshot.id)).rejects.toThrow(
      "session-busy",
    );
  } finally {
    await lease.release();
  }
  expect(await store.load(snapshot.id)).toMatchObject({ id: snapshot.id });
  expect(
    (await readdir(join(home, "sessions"))).some((name) =>
      name.endsWith(".deleted"),
    ),
  ).toBe(false);
});

it("rejects invalid IDs, workspace mismatch and a concurrent save without deleting history", async () => {
  const { home, store, snapshot } = await fixture();
  await expect(deleteSession(home, "../outside")).rejects.toThrow();
  await expect(
    deleteSession(home, snapshot.id, "/different"),
  ).rejects.toThrow();
  await writeFile(join(home, "sessions", `${snapshot.id}.json.write-lock`), "");
  await expect(deleteSession(home, snapshot.id)).rejects.toThrow();
  expect(await store.load(snapshot.id)).toMatchObject({ id: snapshot.id });
});

it("can delete history after its workspace directory has been removed", async () => {
  const { root, home, store, snapshot } = await fixture();
  const gone = join(root, "gone");
  await mkdir(gone);
  const saved = { ...snapshot, workspaceRoot: gone, workingDirectory: gone };
  await store.save(saved);
  await rm(gone, { recursive: true });
  await deleteSession(home, saved.id);
  expect(await store.list()).toEqual([]);
});

it("leaves a retryable snapshot on cleanup failure and never follows a journal symlink", async () => {
  const { root, home, store, snapshot } = await fixture();
  const outside = join(root, "outside");
  await mkdir(outside);
  await writeFile(join(outside, "keep"), "untouched");
  await symlink(outside, join(home, "run-records"));
  await expect(deleteSession(home, snapshot.id)).rejects.toThrow("unsafe");
  expect(await store.load(snapshot.id)).toMatchObject({ id: snapshot.id });
  expect(await readFile(join(outside, "keep"), "utf8")).toBe("untouched");
  await rm(join(home, "run-records"));
  await deleteSession(home, snapshot.id);
  expect(await store.list()).toEqual([]);
});

it("lists sessions beyond the former 1000-entry cutoff", async () => {
  const { root, home, store } = await fixture();
  const template = store.create({ root, cwd: root });
  for (let index = 0; index < 1001; index++) {
    const id = randomUUID();
    await writeFile(
      join(home, "sessions", `${id}.json`),
      JSON.stringify({ ...template, id }),
    );
  }
  expect(await store.list()).toHaveLength(1002);
});
