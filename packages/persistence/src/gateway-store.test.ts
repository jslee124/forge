import { spawn } from "node:child_process";
import {
  mkdtemp,
  readFile,
  realpath,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it } from "vitest";
import { acquireWorkspaceLease, ExecutionLease } from "./execution-lease.js";
import { GatewayStore } from "./gateway-store.js";

const roots: string[] = [];
afterEach(async () => {
  for (const root of roots.splice(0))
    await rm(root, { recursive: true, force: true });
});
async function root() {
  const value = await realpath(
    await mkdtemp(join(tmpdir(), "forge-gateway-store-")),
  );
  roots.push(value);
  return value;
}
it("serializes snapshots, keeps state private and rejects changed bindings/corruption", async () => {
  const store = new GatewayStore(await root());
  const state = await store.load("binding");
  const first = store.save(state);
  state.offset = 9;
  const second = store.save(state);
  await Promise.all([first, second]);
  expect((await store.load("binding")).offset).toBe(9);
  if (process.platform !== "win32")
    expect((await stat(store.path)).mode & 0o777).toBe(0o600);
  await expect(store.load("different")).rejects.toThrow("binding-changed");
  await writeFile(store.path, "broken");
  await expect(store.load("binding")).rejects.toThrow();
});
it("does not advance a checkpoint after an earlier durable write failed", async () => {
  const directory = await root();
  const store = new GatewayStore(directory);
  const state = await store.load("a");
  await writeFile(join(directory, "gateway"), "blocks directory creation");
  await expect(store.save(state)).rejects.toThrow();
  await rm(join(directory, "gateway"));
  state.offset = 99;
  await expect(store.save(state)).rejects.toThrow();
  await expect(readFile(store.path)).rejects.toThrow();
});
it("leases coordinate processes and homes, isolate roots, and reject a released capability", async () => {
  const directory = await root();
  const other = await root();
  const lease = await acquireWorkspaceLease(directory);
  try {
    await expect(acquireWorkspaceLease(directory)).rejects.toThrow(
      "workspace-busy",
    );
    const independent = await acquireWorkspaceLease(other);
    await independent.release();
    await lease.assertWorkspace(directory);
    await expect(lease.assertWorkspace(other)).rejects.toThrow();
  } finally {
    await lease.release();
  }
  await expect(lease.assertWorkspace(directory)).rejects.toThrow();
  const next = await acquireWorkspaceLease(directory);
  await next.release();
});
it("reclaims a dead process lease without replacing a live owner", async () => {
  const key = `test:${await root()}`;
  const module = new URL("../dist/execution-lease.js", import.meta.url).href;
  const child = spawn(
    process.execPath,
    [
      "--input-type=module",
      "-e",
      `import { ExecutionLease } from ${JSON.stringify(module)}; await ExecutionLease.acquire(${JSON.stringify(key)});`,
    ],
    { stdio: "pipe" },
  );
  const exit = await new Promise<number | null>((resolve) =>
    child.once("exit", resolve),
  );
  expect(exit).toBe(0);
  const reclaimed = await ExecutionLease.acquire(key);
  try {
    await expect(ExecutionLease.acquire(key)).rejects.toThrow("workspace-busy");
  } finally {
    await reclaimed.release();
  }
});
