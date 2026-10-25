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
