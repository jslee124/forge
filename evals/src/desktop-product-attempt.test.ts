import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";

const { collectAttemptEvidence } = await import(
  new URL("../scripts/desktop-product-attempt.mjs", import.meta.url).href
);
it("inventories raw interrupted journals without reconciliation, credentials or false billing counts", async () => {
  const root = await mkdtemp(join(tmpdir(), "forge-attempt-records-"));
  const home = join(root, "home");
  try {
    await mkdir(join(home, "runs"), { recursive: true });
    await mkdir(join(home, "run-records/session/run"), { recursive: true });
    const trace =
      JSON.stringify({ event: { type: "model.started" } }) + '\n{"torn":';
    await writeFile(join(home, "runs/run.jsonl"), trace);
    const summary = JSON.stringify({ state: "running" });
    await writeFile(
      join(home, "run-records/session/run/summary.json"),
      summary,
    );
    await writeFile(
      join(home, "run-records/session/run/events.jsonl"),
      "original incomplete events",
    );
    await writeFile(join(home, "auth.json"), "must not be inventoried");
    const result = await collectAttemptEvidence(home, root);
    expect(result).toMatchObject({
      modelStartsObserved: 1,
      malformedTraceLines: 1,
      traceCoverage: "partial",
    });
    expect(result.files).toHaveLength(3);
    expect(
      result.files.some((f: { path: string }) => f.path.includes("auth")),
    ).toBe(false);
    expect(
      result.files.find((f: { path: string }) => f.path === "runs/run.jsonl")
        ?.sha256,
    ).toBe(createHash("sha256").update(trace).digest("hex"));
    expect(
      await readFile(
        join(home, "run-records/session/run/summary.json"),
        "utf8",
      ),
    ).toBe(summary);
    await expect(collectAttemptEvidence(home, root)).rejects.toMatchObject({
      code: "EEXIST",
    });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
