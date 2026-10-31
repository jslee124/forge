import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
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
      requiresBudgetWiring: false,
      currentProfile: "full-acceptance-v1",
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

it("freezes two acceptance rounds and rejects missing quota, cost acknowledgement and tampered lanes before credentials", async () => {
  const directory = await mkdtemp(join(tmpdir(), "forge-acceptance-matrix-"));
  const script = fileURLToPath(
    new URL("../../apps/desktop/scripts/product-matrix.mjs", import.meta.url),
  );
  const output = join(directory, "matrix");
  const run = (...args: string[]) =>
    promisify(execFile)(process.execPath, [script, ...args], {
      env: {
        PATH: process.env["PATH"] ?? "",
        HOME: directory,
        FORGE_HOME: join(directory, "no-auth"),
      },
    });
  try {
    await run("--prepare", "--acceptance", "--output", output);
    const planPath = join(output, "matrix-plan.json");
    const original = await readFile(planPath, "utf8");
    const plan = JSON.parse(original);
    expect(plan).toMatchObject({
      acceptanceProfile: "full-acceptance-v1",
      maxPaidLogicalModelSteps: 570,
      maxSerialLauncherMs: 15620000,
      fullBaselineComplete: false,
    });
    expect(plan.lanes).toHaveLength(50);
    for (const task of ["E01", "E02", "E03", "E04", "E05"]) {
      const lane = plan.lanes.find(
        (entry: { task: string }) => entry.task === task,
      );
      expect(lane.scenario).toMatchObject({
        expectedWrites: ["workflow.mjs", "regression.test.mjs"],
        limits: { maxSteps: 16, maxToolCalls: 32 },
      });
      const liveScript = fileURLToPath(
        new URL("../../apps/desktop/scripts/product-live.mjs", import.meta.url),
      );
      await promisify(execFile)(process.execPath, [
        liveScript,
        "--check",
        "--full-acceptance",
        "--round",
        lane.directory,
        "--task",
        task,
      ]);
      const preflight = JSON.parse(
        await readFile(join(lane.directory, "pilot-plan.json"), "utf8"),
      );
      expect(preflight.externalCallsMade).toBe(0);
      expect(preflight.tasks[0]).toMatchObject({
        executionProfile: "full-acceptance-v1",
        modelSteps: 16,
        wallClockMs: 300000,
      });
    }
    const liveArgs = ["--live", "--supported-only", "--output", output];
    for (const invalid of [undefined, "1", "571", "NaN", "2.5", "-1"]) {
      await expect(
        run(...liveArgs, ...(invalid ? ["--max-paid-steps", invalid] : [])),
      ).rejects.toThrow("--max-paid-steps");
    }
    await expect(run(...liveArgs, "--max-paid-steps", "570")).rejects.toThrow(
      "--acknowledge-variable-cost",
    );
    plan.lanes[0].scenario.expectedWrites.push("outside.mjs");
    await writeFile(planPath, JSON.stringify(plan));
    await expect(
      run(
        ...liveArgs,
        "--max-paid-steps",
        "570",
        "--acknowledge-variable-cost",
      ),
    ).rejects.toThrow("Modified acceptance lane");
    await writeFile(planPath, original);
    // Seed hashes participate in drift checks even though the corpus revision is unchanged.
    const drifted = JSON.parse(original);
    drifted.sha256["evals/fixtures/desktop-product/seed/workflow.mjs"] =
      "0".repeat(64);
    await writeFile(planPath, JSON.stringify(drifted));
    await expect(
      run(
        ...liveArgs,
        "--max-paid-steps",
        "570",
        "--acknowledge-variable-cost",
      ),
    ).rejects.toThrow(/Source\/build drift|Desktop build missing/);
    expect(
      JSON.parse(await readFile(join(output, "matrix-results.json"), "utf8"))
        .recordedLogicalModelSteps,
    ).toBe(0);
    // Existing reservations block a zero-call batch before Electron can start.
    const localOutput = join(directory, "local-matrix");
    await run(
      "--prepare",
      "--acceptance",
      "--output",
      localOutput,
      "--task",
      "D03",
    );
    const budgetPath = join(localOutput, "matrix-budget.json");
    await writeFile(budgetPath, "existing reservation\n");
    await expect(
      run(
        "--live",
        "--supported-only",
        "--output",
        localOutput,
        "--max-paid-steps",
        "0",
      ),
    ).rejects.toThrow(/EEXIST|Desktop build missing/);
    expect(await readFile(budgetPath, "utf8")).toBe("existing reservation\n");
    await expect(
      readFile(join(localOutput, "matrix-attempts.json")),
    ).rejects.toMatchObject({ code: "ENOENT" });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}, 30000);

it("prepares v2 as a separate full matrix with clarified paths, local cancellation and pending review", async () => {
  const root = await mkdtemp(join(tmpdir(), "forge-full-v2-"));
  const script = fileURLToPath(
    new URL("../../apps/desktop/scripts/product-matrix.mjs", import.meta.url),
  );
  const output = join(root, "matrix");
  const run = (...args: string[]) =>
    promisify(execFile)(process.execPath, [script, ...args], {
      env: {
        PATH: process.env["PATH"] ?? "",
        HOME: root,
        FORGE_HOME: join(root, "no-auth"),
      },
    });
  try {
    await run("--prepare", "--acceptance-v2", "--output", output);
    const path = join(output, "matrix-plan.json");
    const plan = JSON.parse(await readFile(path, "utf8"));
    expect(plan).toMatchObject({
      acceptanceProfile: "full-acceptance-v2",
      maxPaidLogicalModelSteps: 560,
      fullBaselineComplete: false,
    });
    expect(plan.lanes).toHaveLength(50);
    expect(
      plan.lanes.filter((l: { task: string }) =>
        ["E04", "F02"].includes(l.task),
      ),
    ).toHaveLength(6);
    for (const lane of plan.lanes.filter((l: { task: string }) =>
      ["E04", "F02"].includes(l.task),
    )) {
      expect(lane).toMatchObject({
        faultProtocol: "desktop-product-faults-v6",
        profile: "contract-acceptance",
        scenario: { localOnly: lane.task === "F02" },
      });
      const live = fileURLToPath(
        new URL("../../apps/desktop/scripts/product-live.mjs", import.meta.url),
      );
      await promisify(execFile)(process.execPath, [
        live,
        "--check",
        "--contract-acceptance",
        "--round",
        lane.directory,
        "--task",
        lane.task,
        ...(lane.stage ? ["--cancel-stage", lane.stage] : []),
      ]);
      const check = JSON.parse(
        await readFile(join(lane.directory, "pilot-plan.json"), "utf8"),
      );
      expect(check.externalCallsMade).toBe(0);
      if (lane.task === "F02") expect(check.externalDestination).toBeNull();
    }
    const review = JSON.parse(
      await readFile(join(output, "matrix-review.json"), "utf8"),
    );
    expect(review.rows).toHaveLength(48);
    expect(review.independentHumanReviewComplete).toBe(false);
    expect(
      review.rows.every(
        (row: { outcome: string }) => row.outcome === "pending",
      ),
    ).toBe(true);
    const args = ["--live", "--supported-only", "--output", output];
    await expect(run(...args, "--max-paid-steps", "559")).rejects.toThrow(
      "--max-paid-steps",
    );
    await expect(run(...args, "--max-paid-steps", "561")).rejects.toThrow(
      "maximum 560",
    );
    await expect(run(...args, "--max-paid-steps", "560")).rejects.toThrow(
      "--acknowledge-variable-cost",
    );
    const lane = plan.lanes.find((l: { task: string }) => l.task === "F02");
    lane.faultProtocol = "desktop-product-faults-v5";
    await writeFile(path, JSON.stringify(plan));
    await expect(
      run(...args, "--max-paid-steps", "560", "--acknowledge-variable-cost"),
    ).rejects.toThrow("Modified acceptance lane");
    await expect(
      run(
        "--prepare",
        "--acceptance",
        "--acceptance-v2",
        "--output",
        join(root, "invalid"),
      ),
    ).rejects.toThrow("Choose one");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}, 30000);
