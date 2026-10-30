import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { expect, it } from "vitest";

it("prepares a complete offline proposal without implying execution or monetary control", async () => {
  const directory = await mkdtemp(join(tmpdir(), "forge-acceptance-plan-"));
  const script = fileURLToPath(
    new URL(
      "../../apps/desktop/scripts/product-acceptance-plan.mjs",
      import.meta.url,
    ),
  );
  const output = join(directory, "plan.json");
  const run = (...args: string[]) =>
    promisify(execFile)(process.execPath, [script, ...args], {
      env: {
        PATH: process.env["PATH"] ?? "",
        HOME: directory,
        FORGE_HOME: join(directory, "no-auth"),
      },
    });
  try {
    await run("--output", output);
    const plan = JSON.parse(await readFile(output, "utf8"));
    expect(plan).toMatchObject({
      taskRows: 48,
      executionLanes: 50,
      externalCallsMade: 0,
      executionReady: false,
      fullBaselineComplete: false,
      budget: { currencyCap: null, tokenCap: null },
    });
    for (const round of [1, 2]) {
      const lanes = plan.lanes.filter(
        (lane: { round: number }) => lane.round === round,
      );
      expect(
        new Set(lanes.map((lane: { task: string }) => lane.task)).size,
      ).toBe(24);
      expect(
        lanes
          .filter((lane: { task: string }) => lane.task === "F02")
          .map((lane: { stage: string }) => lane.stage),
      ).toEqual(["model", "command"]);
    }
    expect(
      plan.lanes.find((lane: { task: string }) => lane.task === "E04"),
    ).toMatchObject({
      protocol: "desktop-product-faults-v3",
      requiresBudgetWiring: true,
      expectedWrites: ["workflow.mjs", "regression.test.mjs"],
      proposedLimits: { maxSteps: 16, maxToolCalls: 32 },
    });
    expect(
      plan.lanes.find((lane: { task: string }) => lane.task === "F03")
        .proposedLimits.maxSteps,
    ).toBe(2);
    expect(
      plan.lanes
        .filter((lane: { task: string }) =>
          ["F04", "F05", "F06", "D03"].includes(lane.task),
        )
        .every(
          (lane: { maxPaidLogicalSteps: number }) =>
            lane.maxPaidLogicalSteps === 0,
        ),
    ).toBe(true);
    // Per round: 17 ordinary tasks * 16, F01 * 6, F02 * (2+3), F03 * 2.
    expect(plan.budget.maxPaidLogicalSteps).toBe(570);
    expect(
      plan.inputSnapshot.sha256[
        "evals/fixtures/desktop-product/seed/workflow.mjs"
      ],
    ).toMatch(/^[a-f0-9]{64}$/);
    await expect(run("--output", output)).rejects.toThrow();
    await expect(
      run("--live", "--output", join(directory, "live.json")),
    ).rejects.toThrow();
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
