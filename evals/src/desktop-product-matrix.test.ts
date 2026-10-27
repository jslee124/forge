import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { expect, it } from "vitest";

it("prepares 48 honest task rows, pins both stages and refuses an incomplete full live gate", async () => {
  const root = await mkdtemp(join(tmpdir(), "forge-matrix-"));
  const output = join(root, "matrix");
  const script = fileURLToPath(
    new URL("../../apps/desktop/scripts/product-matrix.mjs", import.meta.url),
  );
  const run = (mode: string) =>
    promisify(execFile)(process.execPath, [script, mode, "--output", output], {
      env: {
        PATH: process.env["PATH"] ?? "",
        HOME: root,
        FORGE_HOME: join(root, "no-credentials"),
      },
    });
  try {
    await run("--prepare");
    const plan = JSON.parse(
      await readFile(join(output, "matrix-plan.json"), "utf8"),
    );
    expect(plan.lanes).toHaveLength(44);
    expect(plan.maxLogicalModelSteps).toBe(230);
    expect(Object.keys(plan.missing)).toEqual(["F04", "F05", "F06"]);
    const report = JSON.parse(
      await readFile(join(output, "matrix-results.json"), "utf8"),
    );
    expect(report.rows).toHaveLength(48);
    expect(report.fullBaselineComplete).toBe(false);
    expect(
      report.rows.filter(
        (r: { status: string }) => r.status === "not_run_missing_protocol",
      ),
    ).toHaveLength(6);
    expect(report.recordedLogicalModelSteps).toBe(0);
    expect(
      plan.lanes.filter((l: { task: string }) => l.task === "F02"),
    ).toHaveLength(4);
    await expect(run("--live")).rejects.toThrow("three missing task protocols");
    for (const lane of plan.lanes)
      await expect(
        stat(join(lane.directory, lane.task, "runtime-home")),
      ).rejects.toMatchObject({ code: "ENOENT" });
    await run("--report");
    await expect(run("--prepare")).rejects.toThrow();
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
