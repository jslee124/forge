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
it("validates mock overlays before credentials and discloses zero-call admission/local fixture modes", async () => {
  const root = await mkdtemp(join(tmpdir(), "forge-protocol-check-"));
  const round = join(root, "round");
  const script = fileURLToPath(
    new URL("../../apps/desktop/scripts/product-live.mjs", import.meta.url),
  );
  const run = (...args: string[]) =>
    promisify(execFile)(
      process.execPath,
      [script, "--check", "--round", round, ...args],
      {
        cwd: root,
        env: {
          PATH: process.env["PATH"] ?? "",
          HOME: root,
          FORGE_HOME: join(root, "missing-credentials"),
        },
      },
    );
  try {
    await prepareDesktopProductRound(round, 1, "desktop-product-faults-v1");
    await run("--task", "D03");
    let plan = JSON.parse(
      await readFile(join(round, "pilot-plan.json"), "utf8"),
    );
    expect(plan.tasks[0]).toMatchObject({
      task: "D03",
      modelSteps: 0,
      credentialAccess: "none",
    });
    expect(plan.externalDestination).toBeNull();
    for (const task of ["F04", "F05", "F06"]) {
      await run("--task", task);
      const control = JSON.parse(
        await readFile(join(round, "pilot-plan.json"), "utf8"),
      );
      expect(control.externalDestination).toBeNull();
      expect(control.tasks[0]).toMatchObject({
        task,
        providerMode: "local-scripted",
        credentialAccess: "none",
        scenario: { localOnly: true },
      });
    }
    await run("--task", "D02", "--fixture");
    plan = JSON.parse(await readFile(join(round, "pilot-plan.json"), "utf8"));
    expect(plan.tasks[0]).toMatchObject({
      faultProtocol: "desktop-product-faults-v1",
      providerMode: "local-scripted",
      credentialAccess: "none",
    });
    expect(
      (await checkProductEdit("D02", join(round, "D02/workspace"), root))
        .status,
    ).toBe("failed");
    await writeFile(
      join(round, "D02/workspace/mock.mjs"),
      'export const mockTool=()=>({value:"ok"});',
    );
    expect(
      (await checkProductEdit("D02", join(round, "D02/workspace"), root))
        .status,
    ).toBe("passed");
    await expect(run("--task", "D02")).rejects.toThrow("Modified task overlay");
    await expect(run("--task", "E01", "--fixture")).rejects.toThrow(
      "Unsupported local fault fixture",
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
