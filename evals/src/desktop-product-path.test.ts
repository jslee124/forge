import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { expect, it } from "vitest";
import { prepareDesktopProductRound } from "./desktop-product-evaluation.js";

const { checkProductEdit } = await import(
  new URL("../scripts/desktop-product-assertions.mjs", import.meta.url).href
);

it("discloses a read-only path regression overlay while retaining independent rejection probes", async () => {
  const root = await mkdtemp(join(tmpdir(), "forge-path-protocol-"));
  const script = fileURLToPath(
    new URL("../../apps/desktop/scripts/product-live.mjs", import.meta.url),
  );
  const run = (args: string[], cwd = root) =>
    promisify(execFile)(process.execPath, args, {
      cwd,
      env: {
        PATH: process.env["PATH"] ?? "",
        HOME: root,
        FORGE_HOME: join(root, "no-credentials"),
      },
    });
  try {
    const original = await prepareDesktopProductRound(
      join(root, "original"),
      1,
      "desktop-product-faults-v1",
    );
    const round = join(root, "diagnostic");
    const diagnostic = await prepareDesktopProductRound(
      round,
      1,
      "desktop-product-faults-v2",
    );
    const matrix = join(root, "matrix");
    const matrixScript = fileURLToPath(
      new URL("../../apps/desktop/scripts/product-matrix.mjs", import.meta.url),
    );
    await run([
      matrixScript,
      "--prepare",
      "--output",
      matrix,
      "--task",
      "E04",
      "--fault-protocol",
      "desktop-product-faults-v2",
    ]);
    const matrixPlan = JSON.parse(
      await readFile(join(matrix, "matrix-plan.json"), "utf8"),
    );
    expect(matrixPlan).toMatchObject({
      faultProtocol: "desktop-product-faults-v2",
      selectedTasks: ["E04"],
      maxLogicalModelSteps: 12,
      fullBaselineComplete: false,
    });
    expect(matrixPlan.lanes).toHaveLength(2);
    expect(matrixPlan.lanes[0].scenario.supplement).toContain("path.test.mjs");
    expect(diagnostic.fixtureSha256).toEqual(original.fixtureSha256);
    expect(diagnostic.taskFixtureSha256?.["D02"]).toEqual(
      original.taskFixtureSha256?.["D02"],
    );
    expect(Object.keys(diagnostic.taskFixtureSha256?.["E04"] ?? {})).toEqual([
      "path.test.mjs",
    ]);
    await expect(
      readFile(join(root, "original/E04/workspace/path.test.mjs")),
    ).rejects.toMatchObject({ code: "ENOENT" });
    const command = [script, "--check", "--round", round, "--task", "E04"];
    await run(command);
    const plan = JSON.parse(
      await readFile(join(round, "pilot-plan.json"), "utf8"),
    );
    expect(plan.tasks[0]).toMatchObject({
      faultProtocol: "desktop-product-faults-v2",
      modelSteps: 6,
    });
    expect(plan.tasks[0].scenario.supplement).toContain("path.test.mjs");
    const workspace = join(round, "E04/workspace");
    const testPath = join(workspace, "path.test.mjs");
    const testBefore = await readFile(testPath, "utf8");
    await expect(run(["--test", "path.test.mjs"], workspace)).rejects.toThrow();
    expect((await checkProductEdit("E04", workspace, root)).status).toBe(
      "failed",
    );

    const sourcePath = join(workspace, "workflow.mjs");
    const seed = await readFile(sourcePath, "utf8");
    // A superficial public-test repair still fails the unseen Windows/type probes.
    const superficial = `if (value.startsWith('/') || value.split('/').includes('..')) throw new Error('outside'); return value;`;
    await writeFile(
      sourcePath,
      seed.replace('return value.trim().split(" ")[0];', superficial),
    );
    await run(["--test", "path.test.mjs"], workspace);
    expect((await checkProductEdit("E04", workspace, root)).status).toBe(
      "failed",
    );

    const reference = `if (typeof value !== 'string' || /^[a-z]:|^[\\\\/]/i.test(value) || value.split(/[\\\\/]/).includes('..')) throw new Error('invalid relative path'); return value;`;
    await writeFile(
      sourcePath,
      seed.replace('return value.trim().split(" ")[0];', reference),
    );
    await run(["--test", "path.test.mjs"], workspace);
    expect((await checkProductEdit("E04", workspace, root)).status).toBe(
      "passed",
    );
    expect(await readFile(testPath, "utf8")).toBe(testBefore);
    // Restore the original exercise, then prove modified public tests fail preflight.
    await writeFile(sourcePath, seed);
    await writeFile(testPath, testBefore + "\n// modified\n");
    await expect(run(command)).rejects.toThrow("Modified task overlay");
    await expect(
      readFile(join(round, "E04/runtime-home")),
    ).rejects.toMatchObject({ code: "ENOENT" });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
