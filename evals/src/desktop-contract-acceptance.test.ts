import { execFile } from "node:child_process";
import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { expect, it } from "vitest";
import { pilotScenario } from "../../apps/desktop/src/main/product-live-scenarios.js";
import { prepareDesktopProductRound } from "./desktop-product-evaluation.js";

const { checkProductEdit } = await import(
  new URL("../scripts/desktop-product-assertions.mjs", import.meta.url).href
);

it("aligns the explicit path contract with unchanged independent probes and rejects the previous trim-only patch", async () => {
  const root = await mkdtemp(join(tmpdir(), "forge-path-contract-"));
  try {
    const workspace = join(root, "workspace");
    await cp(
      fileURLToPath(
        new URL("../fixtures/desktop-product/seed", import.meta.url),
      ),
      workspace,
      { recursive: true },
    );
    const path = join(workspace, "workflow.mjs");
    const original = await readFile(path, "utf8");
    await writeFile(
      path,
      original.replace(
        'return value.trim().split(" ")[0];',
        "return value.trim();",
      ),
    );
    expect(
      await checkProductEdit("E04", workspace, root, "edit-probes-v2"),
    ).toMatchObject({
      status: "failed",
      assertions: 14,
      failures: expect.arrayContaining([
        expect.objectContaining({ assertion: 3 }),
      ]),
    });
    // Host-only contract witness. Never copied into the model-visible seed.
    const witness = `if (typeof value !== 'string' || /^[\\\\/]/.test(value) || /^[a-z]:/i.test(value)) throw Error('invalid path');
      let depth = 0;
      for (const part of value.split(/[\\\\/]/)) {
        if (part === '..') { if (--depth < 0) throw Error('escape'); }
        else if (part && part !== '.') depth++;
      }
      return value;`;
    await writeFile(
      path,
      original.replace('return value.trim().split(" ")[0];', witness),
    );
    expect(
      await checkProductEdit("E04", workspace, root, "edit-probes-v2"),
    ).toMatchObject({ status: "passed", assertions: 14, failures: [] });
    const scenario = pilotScenario(
      "E04",
      undefined,
      "desktop-product-faults-v6",
      "contract-acceptance",
    );
    expect(scenario.supplement).toContain("不得 trim");
    expect(scenario.supplement).toContain("任何前缀上溯超过根必须拒绝");
    expect(scenario.expectedWrites).toEqual([
      "workflow.mjs",
      "regression.test.mjs",
    ]);
    expect(scenario.limits).toEqual({ maxSteps: 16, maxToolCalls: 32 });
    expect(
      pilotScenario("E04", undefined, "desktop-product-faults-v3").supplement,
    ).not.toContain("路径契约");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

it("preflights local cancellation separately from paid model copying and preserves old entry points", async () => {
  const root = await mkdtemp(join(tmpdir(), "forge-cancel-contract-"));
  const script = fileURLToPath(
    new URL("../../apps/desktop/scripts/product-live.mjs", import.meta.url),
  );
  const run = (...args: string[]) =>
    promisify(execFile)(process.execPath, [script, ...args], {
      env: {
        PATH: process.env["PATH"] ?? "",
        HOME: root,
        FORGE_HOME: join(root, "no-auth"),
      },
    });
  try {
    const round = join(root, "round");
    await prepareDesktopProductRound(round, 1, "desktop-product-faults-v6");
    for (const stage of ["model", "command"]) {
      await run(
        "--check",
        "--round",
        round,
        "--task",
        "F02",
        "--cancel-stage",
        stage,
        "--contract-acceptance",
      );
      const plan = JSON.parse(
        await readFile(join(round, "pilot-plan.json"), "utf8"),
      );
      expect(plan.externalCallsMade).toBe(0);
      expect(plan.externalDestination).toBeNull();
      expect(plan.tasks[0]).toMatchObject({
        providerMode: "local-scripted",
        credentialAccess: "none",
        executionProfile: "contract-acceptance",
        modelSteps: stage === "model" ? 2 : 3,
      });
    }
    await run(
      "--check",
      "--round",
      round,
      "--task",
      "E04",
      "--contract-acceptance",
    );
    await expect(
      run(
        "--check",
        "--round",
        round,
        "--task",
        "E04",
        "--contract-acceptance",
        "--fixture",
      ),
    ).rejects.toThrow("Unsupported local fault fixture");
    await expect(
      run(
        "--check",
        "--round",
        round,
        "--task",
        "Q02",
        "--contract-acceptance",
      ),
    ).rejects.toThrow("requires faults-v6");
    const old = join(root, "old");
    await prepareDesktopProductRound(old, 1, "desktop-product-faults-v5");
    await expect(
      run(
        "--check",
        "--round",
        old,
        "--task",
        "F02",
        "--cancel-stage",
        "command",
        "--fixture",
      ),
    ).rejects.toThrow("Unsupported local fault fixture");
    await expect(
      readFile(join(round, "E04/workspace/regression.test.mjs")),
    ).rejects.toMatchObject({ code: "ENOENT" });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
