import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { expect, it } from "vitest";
import { prepareDesktopProductRound } from "./desktop-product-evaluation.js";

it("checks the frozen pilot without credentials or live calls, and refuses extra workspace data", async () => {
  const root = await mkdtemp(join(tmpdir(), "forge-product-pilot-check-"));
  const round = join(root, "round");
  const script = fileURLToPath(
    new URL("../../apps/desktop/scripts/product-live.mjs", import.meta.url),
  );
  const cwd = fileURLToPath(new URL("../../", import.meta.url));
  const run = (extra: string[] = []) =>
    promisify(execFile)(
      process.execPath,
      [script, "--check", "--round", round, ...extra],
      {
        cwd,
        env: {
          PATH: process.env["PATH"] ?? "",
          HOME: root,
          FORGE_HOME: join(root, "no-credentials"),
        },
      },
    );
  try {
    await prepareDesktopProductRound(round, 1);
    expect((await run()).stdout).toContain(
      "no credential access or provider calls",
    );
    const plan = JSON.parse(
      await readFile(join(round, "pilot-plan.json"), "utf8"),
    );
    expect(plan).toMatchObject({
      externalCallsMade: 0,
      fullBaselineComplete: false,
    });
    expect(plan.tasks.map((task: { task: string }) => task.task)).toEqual([
      "Q02",
      "E01",
      "F03",
    ]);
    await expect(run(["--locale", "unsupported"])).rejects.toThrow(
      "Invalid pilot locale",
    );
    await run(["--task", "F03", "--recover-summary", "--locale", "en"]);
    const english = JSON.parse(
      await readFile(join(round, "pilot-plan.json"), "utf8"),
    );
    expect(english.tasks[0]).toMatchObject({
      task: "F03",
      locale: "en",
      recoverySummary: { maxModelSteps: 1, maxToolCalls: 0 },
    });
    await run(["--task", "D01", "--task", "F01"]);
    const faults = JSON.parse(
      await readFile(join(round, "pilot-plan.json"), "utf8"),
    );
    expect(faults.tasks.map((t: { task: string }) => t.task)).toEqual([
      "D01",
      "F01",
    ]);
    expect(
      faults.tasks.every(
        (t: { scenario: { supplement: string } }) =>
          t.scenario.supplement.length > 0,
      ),
    ).toBe(true);
    await expect(run(["--task", "F02"])).rejects.toThrow("cancel-stage");
    await expect(
      run(["--task", "Q02", "--cancel-stage", "model"]),
    ).rejects.toThrow("requires F02");
    await run(["--task", "F02", "--cancel-stage", "model"]);
    expect(
      JSON.parse(await readFile(join(round, "pilot-plan.json"), "utf8"))
        .tasks[0],
    ).toMatchObject({
      task: "F02",
      modelSteps: 2,
      toolCalls: 1,
      scenario: { cancelStage: "model" },
    });
    await run(["--task", "F02", "--cancel-stage", "command"]);
    expect(
      JSON.parse(await readFile(join(round, "pilot-plan.json"), "utf8"))
        .tasks[0],
    ).toMatchObject({
      task: "F02",
      modelSteps: 3,
      toolCalls: 2,
      scenario: { cancelStage: "command" },
    });
    await run(["--task", "Q02"]);
    const selected = JSON.parse(
      await readFile(join(round, "pilot-plan.json"), "utf8"),
    );
    expect(selected.tasks.map((task: { task: string }) => task.task)).toEqual([
      "Q02",
    ]);
    await run(["--task", "Q05", "--task", "Q06", "--task", "F03"]);
    const expanded = JSON.parse(
      await readFile(join(round, "pilot-plan.json"), "utf8"),
    );
    expect(expanded.tasks).toEqual([
      expect.objectContaining({
        task: "Q05",
        modelSteps: 6,
        toolCalls: 8,
        status: "not_run",
      }),
      expect.objectContaining({
        task: "Q06",
        modelSteps: 6,
        toolCalls: 8,
        status: "not_run",
      }),
      expect.objectContaining({
        task: "F03",
        modelSteps: 2,
        toolCalls: 8,
        status: "not_run",
      }),
    ]);
    expect(expanded.externalCallsMade).toBe(0);
    expect(expanded.fullBaselineComplete).toBe(false);
    for (const task of ["Q05", "Q06"])
      await expect(
        stat(join(round, task, "runtime-home")),
      ).rejects.toMatchObject({ code: "ENOENT" });
    await run([
      "--task",
      "F03",
      "--finalization-input",
      "evidence",
      "--recover-summary",
    ]);
    const experiment = JSON.parse(
      await readFile(join(round, "pilot-plan.json"), "utf8"),
    );
    expect(experiment.tasks).toEqual([
      expect.objectContaining({
        task: "F03",
        finalizationInput: "evidence",
        modelSteps: 2,
        toolCalls: 8,
        recoverySummary: {
          maxModelSteps: 1,
          maxToolCalls: 0,
          wallClockMs: 90000,
        },
      }),
    ]);
    await run([
      "--task",
      "E01",
      "--finalization-input",
      "evidence",
      "--recover-summary",
    ]);
    const editPlan = JSON.parse(
      await readFile(join(round, "pilot-plan.json"), "utf8"),
    );
    expect(editPlan.tasks).toEqual([
      expect.objectContaining({
        task: "E01",
        modelSteps: 6,
        toolCalls: 16,
        recoverySummary: {
          maxModelSteps: 1,
          maxToolCalls: 0,
          wallClockMs: 90000,
        },
      }),
    ]);
    await expect(
      run(["--finalization-input", "unknown"]),
    ).rejects.toMatchObject({
      stderr: expect.stringContaining("Invalid finalization input"),
    });
    await expect(
      run(["--task", "Q06", "--recover-summary"]),
    ).rejects.toMatchObject({
      stderr: expect.stringContaining("requires E01 or F03"),
    });
    await expect(run(["--task", "Q02", "--task", "Q02"])).rejects.toMatchObject(
      { stderr: expect.stringContaining("must be unique") },
    );
    await expect(run(["--task", "D02"])).rejects.toMatchObject({
      stderr: expect.stringContaining("must be unique"),
    });
    await expect(
      stat(join(round, "E01", "runtime-home")),
    ).rejects.toMatchObject({ code: "ENOENT" });
    await writeFile(
      join(round, "Q02", "workspace", "unrelated-private.txt"),
      "must not be sent",
    );
    await expect(run()).rejects.toMatchObject({
      stderr: expect.stringContaining("Workspace has extra or missing files"),
    });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
