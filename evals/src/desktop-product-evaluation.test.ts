import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import {
  loadDesktopProductCorpus,
  prepareDesktopProductRound,
} from "./desktop-product-evaluation.js";

it("freezes 24 independent cases and prepares two identical pending baseline rounds", async () => {
  const root = await mkdtemp(join(tmpdir(), "forge-product-corpus-"));
  try {
    const corpus = await loadDesktopProductCorpus();
    expect(
      corpus.tasks.filter((task) => task.critical).map((task) => task.id),
    ).toEqual(["D05", "F01", "F02", "F03", "F05", "F06"]);
    const first = await prepareDesktopProductRound(join(root, "round-1"), 1);
    const second = await prepareDesktopProductRound(join(root, "round-2"), 2);
    expect(first.fixtureSha256).toEqual(second.fixtureSha256);
    expect(first.primaryModel).toEqual(second.primaryModel);
    expect(
      JSON.parse(
        await readFile(join(root, "round-1", "F06", "assessment.json"), "utf8"),
      ),
    ).toMatchObject({ status: "not_run", critical: true, evidence: [] });
    expect(
      await readFile(
        join(root, "round-1", "Q04", "workspace", "large.ts"),
        "utf8",
      ),
    ).toContain("locateMiddle");
    await expect(
      prepareDesktopProductRound(join(root, "round-1"), 1),
    ).rejects.toThrow();
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

it("adds a versioned D02 specimen without changing the frozen v1 seed or other tasks", async () => {
  const root = await mkdtemp(join(tmpdir(), "forge-fault-protocol-"));
  try {
    const original = await prepareDesktopProductRound(
      join(root, "original"),
      1,
    );
    const first = await prepareDesktopProductRound(
      join(root, "first"),
      1,
      "desktop-product-faults-v1",
    );
    const second = await prepareDesktopProductRound(
      join(root, "second"),
      2,
      "desktop-product-faults-v1",
    );
    expect(first.fixtureSha256).toEqual(original.fixtureSha256);
    expect(first.taskFixtureSha256).toEqual(second.taskFixtureSha256);
    expect(Object.keys(first.taskFixtureSha256 ?? {})).toEqual(["D02"]);
    expect(Object.keys(first.taskFixtureSha256?.["D02"] ?? {}).sort()).toEqual([
      "mock-implementation.mjs",
      "mock.mjs",
      "mock.test.mjs",
    ]);
    expect(
      await readFile(join(root, "first/D02/workspace/mock.test.mjs"), "utf8"),
    ).toContain("assert.deepEqual(mockTool(), actualTool())");
    await expect(
      readFile(join(root, "first/Q01/workspace/mock.mjs")),
    ).rejects.toMatchObject({ code: "ENOENT" });
    await expect(
      readFile(join(root, "original/D02/workspace/mock.mjs")),
    ).rejects.toMatchObject({ code: "ENOENT" });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
