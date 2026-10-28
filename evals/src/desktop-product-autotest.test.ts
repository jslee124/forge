import { execFile } from "node:child_process";
import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { expect, it } from "vitest";
import { prepareDesktopProductRound } from "./desktop-product-evaluation.js";

const { checkProductEdit } = await import(
  new URL("../scripts/desktop-product-assertions.mjs", import.meta.url).href
);

it("does not treat a regression cycle with incorrect whitespace assertions as task correctness", async () => {
  const root = await mkdtemp(join(tmpdir(), "forge-autotest-contract-"));
  try {
    const workspace = join(root, "workspace");
    await cp(
      fileURLToPath(
        new URL("../fixtures/desktop-product/seed/", import.meta.url),
      ),
      workspace,
      { recursive: true },
    );
    const source = join(workspace, "workflow.mjs");
    const regression = join(workspace, "regression.test.mjs");
    // Captures the live model's mistaken assumption that surrounding path spaces
    // should be removed. Such a test can go green while the task remains wrong.
    await writeFile(
      regression,
      `import assert from 'node:assert/strict';
import {test} from 'node:test'; import {relativePath} from './workflow.mjs';
test('spaces',()=>assert.equal(relativePath(' dir/file name '),'dir/file name'));
`,
    );
    const run = () =>
      promisify(execFile)(process.execPath, ["--test", regression], {
        cwd: workspace,
        env: { PATH: process.env["PATH"] ?? "", HOME: root },
      });
    await expect(run()).rejects.toThrow();
    const original = await readFile(source, "utf8");
    await writeFile(
      source,
      original.replace(
        'return value.trim().split(" ")[0];',
        "return value.trim();",
      ),
    );
    await run();
    expect(
      await checkProductEdit("E04", workspace, root, "edit-probes-v2"),
    ).toMatchObject({ status: "failed" });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

it("prepares autonomous regression diagnostics without supplying tests or accessing credentials", async () => {
  const root = await mkdtemp(join(tmpdir(), "forge-autonomous-test-"));
  const script = fileURLToPath(
    new URL("../../apps/desktop/scripts/product-live.mjs", import.meta.url),
  );
  const matrixScript = fileURLToPath(
    new URL("../../apps/desktop/scripts/product-matrix.mjs", import.meta.url),
  );
  const run = (args: string[]) =>
    promisify(execFile)(process.execPath, args, {
      cwd: root,
      env: {
        PATH: process.env["PATH"] ?? "",
        HOME: root,
        FORGE_HOME: join(root, "missing-credentials"),
      },
    });
  try {
    const original = await prepareDesktopProductRound(
      join(root, "original"),
      1,
    );
    const round = join(root, "autonomous");
    const prepared = await prepareDesktopProductRound(
      round,
      1,
      "desktop-product-faults-v3",
    );
    expect(prepared.fixtureSha256).toEqual(original.fixtureSha256);
    expect(Object.keys(prepared.taskFixtureSha256 ?? {})).toEqual(["D02"]);
    for (const file of ["regression.test.mjs", "path.test.mjs"])
      await expect(
        readFile(join(round, "E04/workspace", file)),
      ).rejects.toMatchObject({ code: "ENOENT" });
    await run([script, "--check", "--round", round, "--task", "E04"]);
    const plan = JSON.parse(
      await readFile(join(round, "pilot-plan.json"), "utf8"),
    );
    expect(plan.tasks[0]).toMatchObject({
      faultProtocol: "desktop-product-faults-v3",
      modelSteps: 6,
      scenario: { expectedWrites: ["workflow.mjs", "regression.test.mjs"] },
    });
    expect(plan.tasks[0].scenario.supplement).toContain("不提供测试内容");
    await expect(
      readFile(join(round, "E04/runtime-home")),
    ).rejects.toMatchObject({ code: "ENOENT" });
    const matrix = join(root, "matrix");
    await run([
      matrixScript,
      "--prepare",
      "--output",
      matrix,
      "--task",
      "E04",
      "--fault-protocol",
      "desktop-product-faults-v3",
    ]);
    const matrixPlan = JSON.parse(
      await readFile(join(matrix, "matrix-plan.json"), "utf8"),
    );
    expect(matrixPlan).toMatchObject({
      faultProtocol: "desktop-product-faults-v3",
      maxLogicalModelSteps: 12,
      fullBaselineComplete: false,
    });
    expect(matrixPlan.lanes).toHaveLength(2);
    await expect(
      run([script, "--check", "--round", round, "--task", "E04", "--fixture"]),
    ).rejects.toThrow("Unsupported local fault fixture");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

it.each([
  {
    task: "E01",
    name: "parsePort",
    next: "export function theme",
    replacement:
      'export function parsePort(value) { if(value === "0") throw new Error("zero"); return Number(value); }\n',
    assertion: 'assert.throws(()=>w.parsePort("0"))',
  },
  {
    task: "E03",
    name: "submit",
    next: "export function relativePath",
    replacement:
      "export async function submit(send) { if(busy) return; busy=true; await send(); busy=false; }\n",
    assertion:
      "let calls=0,release; const gate=new Promise(resolve=>{release=resolve}); const first=w.submit(async()=>{calls++;await gate}); await w.submit(async()=>{calls++}); release(); await first; assert.equal(calls,1)",
  },
  {
    task: "E02",
    name: "theme",
    next: "let busy = false;",
    replacement:
      'export function theme(user) { return { theme: "system" }; }\n',
    assertion: 'assert.equal(w.theme({}).theme,"system")',
  },
  {
    task: "E05",
    name: "propagate",
    next: "export function dispatch",
    replacement:
      "export async function propagate(action) { try { await action(); } catch(error) { throw error; } }\n",
    assertion:
      'await assert.rejects(()=>w.propagate(async()=>{throw new Error("expected")}))',
  },
])(
  "rejects a narrow red/green regression that misses $task preservation requirements",
  async ({ task, name, next, replacement, assertion }) => {
    const root = await mkdtemp(join(tmpdir(), "forge-heldout-contract-"));
    try {
      const workspace = join(root, "workspace");
      await cp(
        fileURLToPath(
          new URL("../fixtures/desktop-product/seed/", import.meta.url),
        ),
        workspace,
        { recursive: true },
      );
      const source = join(workspace, "workflow.mjs");
      const original = await readFile(source, "utf8");
      const declaration = ["propagate", "submit"].includes(name)
        ? `export async function ${name}`
        : `export function ${name}`;
      const regression = join(workspace, "regression.test.mjs");
      await writeFile(
        regression,
        `import assert from 'node:assert/strict'; import * as w from './workflow.mjs'; ${assertion};`,
      );
      const run = () =>
        promisify(execFile)(process.execPath, ["--test", regression], {
          cwd: workspace,
          timeout: 10000,
        });
      await expect(run()).rejects.toThrow();
      await writeFile(
        source,
        original.slice(0, original.indexOf(declaration)) +
          replacement +
          original.slice(original.indexOf(next)),
      );
      await run();
      expect(
        await checkProductEdit(task, workspace, root, "edit-probes-v2"),
      ).toMatchObject({ status: "failed" });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  },
);

it("prepares new task regression pilots without tests, caps, credentials or provider calls", async () => {
  const root = await mkdtemp(join(tmpdir(), "forge-heldout-prepare-"));
  try {
    const round = join(root, "round");
    await prepareDesktopProductRound(round, 1, "desktop-product-faults-v4");
    const script = fileURLToPath(
      new URL("../../apps/desktop/scripts/product-live.mjs", import.meta.url),
    );
    await promisify(execFile)(
      process.execPath,
      [
        script,
        "--check",
        "--product-defaults",
        "--round",
        round,
        "--task",
        "E02",
        "--task",
        "E05",
      ],
      {
        env: {
          PATH: process.env["PATH"] ?? "",
          HOME: root,
          FORGE_HOME: join(root, "no-credentials"),
        },
      },
    );
    const plan = JSON.parse(
      await readFile(join(round, "pilot-plan.json"), "utf8"),
    );
    expect(plan.externalCallsMade).toBe(0);
    for (const task of plan.tasks) {
      expect(task).toMatchObject({
        modelSteps: null,
        toolCalls: null,
        executionProfile: "product-defaults",
        scenario: { expectedWrites: ["workflow.mjs", "regression.test.mjs"] },
      });
      await expect(
        readFile(join(round, task.task, "workspace/regression.test.mjs")),
      ).rejects.toMatchObject({ code: "ENOENT" });
      await expect(
        readFile(join(round, task.task, "runtime-home/config.json")),
      ).rejects.toMatchObject({ code: "ENOENT" });
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

it("prepares bounded E01/E03 repair acceptance with no supplied assertions or credentials", async () => {
  const root = await mkdtemp(join(tmpdir(), "forge-repair-acceptance-"));
  const script = fileURLToPath(
    new URL("../../apps/desktop/scripts/product-live.mjs", import.meta.url),
  );
  const run = (...args: string[]) =>
    promisify(execFile)(process.execPath, [script, ...args], {
      env: {
        PATH: process.env["PATH"] ?? "",
        HOME: root,
        FORGE_HOME: join(root, "no-credentials"),
      },
    });
  try {
    const original = join(root, "original"),
      round = join(root, "acceptance");
    const seed = await prepareDesktopProductRound(original, 1);
    const prepared = await prepareDesktopProductRound(
      round,
      1,
      "desktop-product-faults-v5",
    );
    expect(prepared.fixtureSha256).toEqual(seed.fixtureSha256);
    expect(Object.keys(prepared.taskFixtureSha256 ?? {})).toEqual(["D02"]);
    await run(
      "--check",
      "--repair-acceptance",
      "--round",
      round,
      "--task",
      "E01",
      "--task",
      "E03",
    );
    const plan = JSON.parse(
      await readFile(join(round, "pilot-plan.json"), "utf8"),
    );
    expect(plan.externalCallsMade).toBe(0);
    expect(plan.tasks).toHaveLength(2);
    const matrixScript = fileURLToPath(
      new URL("../../apps/desktop/scripts/product-matrix.mjs", import.meta.url),
    );
    const matrix = join(root, "matrix");
    await promisify(execFile)(
      process.execPath,
      [
        matrixScript,
        "--prepare",
        "--output",
        matrix,
        "--task",
        "E01",
        "--task",
        "E03",
        "--fault-protocol",
        "desktop-product-faults-v5",
      ],
      {
        env: {
          PATH: process.env["PATH"] ?? "",
          HOME: root,
          FORGE_HOME: join(root, "no-credentials"),
        },
      },
    );
    const matrixPlan = JSON.parse(
      await readFile(join(matrix, "matrix-plan.json"), "utf8"),
    );
    expect(matrixPlan.lanes).toHaveLength(4);
    expect(matrixPlan.maxPaidLogicalModelSteps).toBe(24);
    expect(
      matrixPlan.lanes.every(
        (lane: {
          scenario: { limits: { maxSteps: number; maxToolCalls: number } };
        }) =>
          lane.scenario.limits.maxSteps === 6 &&
          lane.scenario.limits.maxToolCalls === 16,
      ),
    ).toBe(true);
    for (const task of plan.tasks) {
      expect(task).toMatchObject({
        executionProfile: "repair-acceptance",
        modelSteps: 16,
        toolCalls: 32,
        wallClockMs: 300000,
        faultProtocol: "desktop-product-faults-v5",
        scenario: { expectedWrites: ["workflow.mjs", "regression.test.mjs"] },
      });
      for (const file of [
        "workspace/regression.test.mjs",
        "runtime-home/config.json",
      ])
        await expect(
          readFile(join(round, task.task, file)),
        ).rejects.toMatchObject({ code: "ENOENT" });
    }
    await expect(
      run(
        "--live",
        "--repair-acceptance",
        "--round",
        original,
        "--task",
        "E01",
      ),
    ).rejects.toThrow("requires faults-v5");
    await expect(
      run(
        "--check",
        "--repair-acceptance",
        "--product-defaults",
        "--round",
        round,
        "--task",
        "E01",
      ),
    ).rejects.toThrow("Choose only one");
    await expect(
      run(
        "--check",
        "--repair-acceptance",
        "--recover-summary",
        "--round",
        round,
        "--task",
        "E01",
      ),
    ).rejects.toThrow("request summary separately");
    await expect(
      run("--check", "--repair-acceptance", "--round", round, "--task", "Q02"),
    ).rejects.toThrow("only supports E01/E03");
    await expect(
      readFile(join(original, "E01/runtime-home/config.json")),
    ).rejects.toMatchObject({ code: "ENOENT" });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
