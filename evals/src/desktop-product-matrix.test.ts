import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { expect, it } from "vitest";

const { snapshotMatrixInputs } = await import(
  new URL(
    "../../apps/desktop/scripts/product-matrix-inputs.mjs",
    import.meta.url,
  ).href
);

it("prepares 48 honest task rows, pins both stages and refuses an incomplete full live gate", async () => {
  const root = await mkdtemp(join(tmpdir(), "forge-matrix-"));
  const output = join(root, "matrix");
  const script = fileURLToPath(
    new URL("../../apps/desktop/scripts/product-matrix.mjs", import.meta.url),
  );
  const run = (mode: string, ...args: string[]) =>
    promisify(execFile)(
      process.execPath,
      [script, mode, "--output", output, ...args],
      {
        env: {
          PATH: process.env["PATH"] ?? "",
          HOME: root,
          FORGE_HOME: join(root, "no-credentials"),
        },
      },
    );
  try {
    await run("--prepare");
    const plan = JSON.parse(
      await readFile(join(output, "matrix-plan.json"), "utf8"),
    );
    expect(plan.lanes).toHaveLength(50);
    expect(plan.maxLogicalModelSteps).toBe(242);
    expect(Object.keys(plan.missing)).toEqual([]);
    expect(plan.maxPaidLogicalModelSteps).toBe(230);
    const report = JSON.parse(
      await readFile(join(output, "matrix-results.json"), "utf8"),
    );
    expect(report.rows).toHaveLength(48);
    expect(report.fullBaselineComplete).toBe(false);
    expect(
      report.rows.filter(
        (r: { status: string }) => r.status === "not_run_missing_protocol",
      ),
    ).toHaveLength(0);
    expect(report.recordedLogicalModelSteps).toBe(0);
    expect(
      plan.lanes.filter((l: { task: string }) => l.task === "F02"),
    ).toHaveLength(4);
    await expect(run("--live")).rejects.toThrow("requires --supported-only");
    if (plan.missingBuildArtifacts.length) {
      for (const file of plan.missingBuildArtifacts)
        expect(plan.sha256[file]).toBeNull();
      await expect(run("--live", "--supported-only")).rejects.toThrow(
        "Desktop build missing at preparation",
      );
    }
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

it("records absent build artifacts explicitly and still requires every source input", async () => {
  const root = await mkdtemp(join(tmpdir(), "forge-matrix-inputs-"));
  try {
    await writeFile(join(root, "source.mjs"), "source");
    const unbuilt = await snapshotMatrixInputs(
      root,
      ["source.mjs"],
      ["main.js", "agent.js"],
    );
    expect(unbuilt).toMatchObject({
      sha256: {
        "source.mjs": expect.stringMatching(/^[a-f0-9]{64}$/u),
        "main.js": null,
        "agent.js": null,
      },
      missingBuildArtifacts: ["main.js", "agent.js"],
    });
    await writeFile(join(root, "main.js"), "main");
    await writeFile(join(root, "agent.js"), "agent");
    const built = await snapshotMatrixInputs(
      root,
      ["source.mjs"],
      ["main.js", "agent.js"],
    );
    expect(built.missingBuildArtifacts).toEqual([]);
    expect(built.sha256["main.js"]).toMatch(/^[a-f0-9]{64}$/u);
    expect(built.sha256).not.toEqual(unbuilt.sha256);
    await writeFile(join(root, "agent.js"), "changed build");
    expect(
      (
        await snapshotMatrixInputs(
          root,
          ["source.mjs"],
          ["main.js", "agent.js"],
        )
      ).sha256,
    ).not.toEqual(built.sha256);
    await expect(
      snapshotMatrixInputs(root, ["missing-source.mjs"], ["main.js"]),
    ).rejects.toMatchObject({ code: "ENOENT" });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
