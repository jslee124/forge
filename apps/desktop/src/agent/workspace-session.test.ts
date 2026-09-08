import { randomUUID } from "node:crypto";
import {
  chmod,
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { FileSessionStore, recordRunInSession } from "@forge/persistence";
import { afterEach, expect, it } from "vitest";
import { DesktopApplication } from "./application.js";

const roots: string[] = [];
afterEach(async () => {
  for (const root of roots.splice(0))
    await rm(root, { recursive: true, force: true });
});
async function fixture() {
  const root = await realpath(await mkdtemp(join(tmpdir(), "forge-d06-")));
  roots.push(root);
  const cwd = join(root, "project");
  const home = join(root, "home");
  await mkdir(cwd);
  await mkdir(home);
  const env = { FORGE_HOME: home };
  return { root, cwd, home, env, app: new DesktopApplication(env, root) };
}
async function saved(home: string, cwd: string, root = cwd) {
  const store = new FileSessionStore(home);
  const snapshot = recordRunInSession(store.create({ root, cwd }), {
    prompt: "saved task",
    finalText: "answer",
    status: "completed",
    runId: randomUUID(),
  });
  await store.save(snapshot);
  return snapshot;
}
it("lists sessions at startup and resumes the original Git subdirectory", async () => {
  const f = await fixture();
  await mkdir(join(f.cwd, ".git"));
  const sub = join(f.cwd, "sub");
  await mkdir(sub);
  const snapshot = await saved(f.home, sub, f.cwd);
  expect((await f.app.state()).sessions.map((s) => s.id)).toContain(
    snapshot.id,
  );
  const state = await f.app.manage({ type: "resume", sessionId: snapshot.id });
  expect(state.cwd).toBe(sub);
  const next = await f.app.manage({ type: "create", prompt: "next" });
  expect(next.cwd).toBe(sub);
});
it("rejects missing directories and regular files without losing the current workspace", async () => {
  const f = await fixture();
  await f.app.manage({ type: "workspace", cwd: f.cwd });
  const file = join(f.root, "file");
  await writeFile(file, "plain");
  for (const cwd of [join(f.root, "missing"), file]) {
    await expect(f.app.manage({ type: "workspace", cwd })).rejects.toThrow(
      "workspace-unavailable",
    );
    expect((await f.app.state()).cwd).toBe(f.cwd);
  }
});
it("skips corrupt history in the list and rejects corrupt, missing and moved sessions", async () => {
  const f = await fixture();
  const snapshot = await saved(f.home, f.cwd);
  const path = join(f.home, "sessions", `${snapshot.id}.json`);
  await writeFile(join(f.home, "sessions", "corrupt.json"), "bad JSON");
  expect((await f.app.state()).sessions).toHaveLength(1);
  for (const sessionId of ["corrupt", "missing"])
    await expect(f.app.manage({ type: "resume", sessionId })).rejects.toThrow();
  const before = await readFile(path, "utf8");
  await mkdir(join(f.cwd, ".git"));
  await mkdir(join(f.root, ".git"));
  await rm(join(f.cwd, ".git"), { recursive: true });
  await expect(
    f.app.manage({ type: "resume", sessionId: snapshot.id }),
  ).rejects.toThrow("workspace-changed");
  expect(await readFile(path, "utf8")).toBe(before);
  await rm(f.cwd, { recursive: true });
  await expect(
    f.app.manage({ type: "resume", sessionId: snapshot.id }),
  ).rejects.toThrow("workspace-unavailable");
});
it("honors home configuration and rejects project authority overrides", async () => {
  const f = await fixture();
  await writeFile(
    join(f.home, "config.json"),
    JSON.stringify({ schemaVersion: 1, model: { id: "home-model" } }),
  );
  await mkdir(join(f.cwd, ".forge"));
  const config = join(f.cwd, ".forge", "config.json");
  await writeFile(
    config,
    JSON.stringify({ schemaVersion: 1, limits: { maxSteps: 3 } }),
  );
  expect((await f.app.manage({ type: "workspace", cwd: f.cwd })).model).toBe(
    "home-model",
  );
  await writeFile(
    config,
    JSON.stringify({ schemaVersion: 1, model: { id: "project-model" } }),
  );
  await expect(
    f.app.manage({ type: "create", prompt: "test" }),
  ).rejects.toThrow();
});
it("protects snapshots from stale writers even after a list refresh", async () => {
  const f = await fixture();
  const snapshot = await saved(f.home, f.cwd);
  const a = new FileSessionStore(f.home);
  const b = new FileSessionStore(f.home);
  const old = await a.load(snapshot.id);
  const current = await b.load(snapshot.id);
  await b.save({
    ...current,
    messages: current.messages,
    updatedAt: "2030-01-01T00:00:00.000Z",
  });
  const path = join(f.home, "sessions", `${snapshot.id}.json`);
  const before = await readFile(path, "utf8");
  await a.list();
  await expect(a.save(old)).rejects.toThrow();
  expect(await readFile(path, "utf8")).toBe(before);
});
it("rejects an occupied writer and recovers after a storage failure", async () => {
  const f = await fixture();
  const snapshot = await saved(f.home, f.cwd);
  const store = new FileSessionStore(f.home);
  const loaded = await store.load(snapshot.id);
  const path = join(f.home, "sessions", `${snapshot.id}.json`);
  const before = await readFile(path, "utf8");
  await mkdir(`${path}.write-lock`);
  await expect(store.save(loaded)).rejects.toThrow();
  expect(await readFile(path, "utf8")).toBe(before);
  await rm(`${path}.write-lock`, { recursive: true });
  await store.save(loaded);
  expect(await readFile(path, "utf8")).toBe(before);
});
it("rejects automatic workspace boundary expansion and invalid submission", async () => {
  const f = await fixture();
  await expect(f.app.manage({ type: "create", prompt: " " })).rejects.toThrow(
    "prompt-required",
  );
  expect((await f.app.state()).cwd).toBe("");
  await mkdir(join(f.root, ".git"));
  await expect(
    f.app.manage({ type: "create", prompt: "test" }),
  ).rejects.toThrow("auto-workspace-boundary");
  expect((await f.app.state()).cwd).toBe("");
});

it("serializes concurrent clients and preserves the successful writer", async () => {
  const f = await fixture();
  const snapshot = await saved(f.home, f.cwd);
  const a = new FileSessionStore(f.home);
  const b = new FileSessionStore(f.home);
  const left = await a.load(snapshot.id);
  const right = await b.load(snapshot.id);
  const results = await Promise.allSettled([
    a.save({
      ...left,
      messages: left.messages,
      updatedAt: "2030-01-01T00:00:00.000Z",
    }),
    b.save({
      ...right,
      messages: right.messages,
      updatedAt: "2031-01-01T00:00:00.000Z",
    }),
  ]);
  expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
  const final = await new FileSessionStore(f.home).load(snapshot.id);
  expect(final.updatedAt).toBe(
    results[0]?.status === "fulfilled"
      ? "2030-01-01T00:00:00.000Z"
      : "2031-01-01T00:00:00.000Z",
  );
});
it("keeps the old snapshot intact when the storage directory is not writable", async () => {
  const f = await fixture();
  const snapshot = await saved(f.home, f.cwd);
  const store = new FileSessionStore(f.home);
  const loaded = await store.load(snapshot.id);
  const directory = join(f.home, "sessions");
  const file = join(directory, `${snapshot.id}.json`);
  const before = await readFile(file, "utf8");
  await chmod(directory, 0o500);
  try {
    await expect(store.save(loaded)).rejects.toThrow();
    expect(await readFile(file, "utf8")).toBe(before);
  } finally {
    await chmod(directory, 0o700);
  }
  await store.save(loaded);
});
