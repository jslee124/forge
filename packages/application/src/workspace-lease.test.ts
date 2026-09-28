import { mkdtemp, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { acquireWorkspaceLease } from "@forge/persistence";
import { expect, it, vi } from "vitest";
import { runCodexTask } from "./codex.js";
import { runTask } from "./run.js";

it("blocks the native and Codex entry paths before model/client initialization across FORGE_HOME values", async () => {
  const root = await realpath(
    await mkdtemp(join(tmpdir(), "forge-entry-lease-")),
  );
  const lease = await acquireWorkspaceLease(root);
  try {
    const connect = vi.fn();
    const createAdapter = vi.fn();
    const errors: string[] = [];
    const shared = {
      cwd: root,
      env: { FORGE_HOME: join(root, "other-home") },
      signal: new AbortController().signal,
      stderr: { write: (text: string) => errors.push(text) },
    };
    expect(await runTask("test", {}, { ...shared, createAdapter })).toBe(1);
    expect(
      await runCodexTask(
        "test",
        {},
        { ...shared, stdout: { write: () => {} }, isTTY: false, connect },
      ),
    ).toBe(1);
    expect(connect).not.toHaveBeenCalled();
    expect(createAdapter).not.toHaveBeenCalled();
    expect(errors.join(" ")).toContain("busy");
  } finally {
    await lease.release();
    await rm(root, { recursive: true, force: true });
  }
});
