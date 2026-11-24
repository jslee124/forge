import {
  appendFile,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import {
  blockControlJournal,
  changedPaths,
  waitFor,
  workspaceHashes,
} from "./product-control-faults.js";

it("injects a real reversible append failure and preserves the original journal bytes", async () => {
  const home = await mkdtemp(join(tmpdir(), "forge-control-storage-"));
  const directory = join(home, "run-records/session/run");
  try {
    await mkdir(directory, { recursive: true });
    const file = join(directory, "events.jsonl");
    await writeFile(file, "original journal\n");
    const before = await workspaceHashes(home);
    const fault = await blockControlJournal(home, "session", "run");
    await expect(appendFile(file, "must not append")).rejects.toThrow();
    expect(
      await readFile(join(directory, "events.before-injection.jsonl"), "utf8"),
    ).toBe("original journal\n");
    await fault.restore();
    await fault.restore();
    expect(await readFile(file, "utf8")).toBe("original journal\n");
    expect(changedPaths(before, await workspaceHashes(home))).toEqual([]);
    await expect(blockControlJournal(home, "../escape", "run")).rejects.toThrow(
      "Invalid",
    );
  } finally {
    await rm(home, { recursive: true, force: true });
  }
});
it("detects preservation failures and bounds trigger waiting", async () => {
  expect(
    changedPaths(
      { a: "old", b: "same" },
      { a: "new", b: "same", c: "created" },
    ),
  ).toEqual(["a", "c"]);
  expect(await waitFor(async () => false, "valid false", 10)).toBe(false);
  await expect(
    waitFor(async () => undefined, "never started", 1),
  ).rejects.toThrow("timed out");
});
