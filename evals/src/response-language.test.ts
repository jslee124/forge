import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { expect, it } from "vitest";

it("prepares and runs isolated single-response language fixtures without credentials or tools", async () => {
  const root = await mkdtemp(join(tmpdir(), "forge-language-test-"));
  const script = fileURLToPath(
    new URL("../scripts/response-language.mjs", import.meta.url),
  );
  const output = join(root, "diagnostic");
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
    const plan = JSON.parse(await readFile(join(output, "plan.json"), "utf8"));
    expect(plan).toMatchObject({
      externalCallsMade: 0,
      tools: 0,
      maxModelResponsesPerCase: 1,
      wholeTaskRetries: 0,
    });
    await expect(
      readFile(join(output, "attempt-started.json")),
    ).rejects.toMatchObject({ code: "ENOENT" });
    await run("--fixture");
    const report = JSON.parse(
      await readFile(join(output, "report.json"), "utf8"),
    );
    expect(report).toMatchObject({
      mode: "local-scripted",
      logicalModelResponses: 3,
      fullDesktopAcceptance: false,
    });
    for (const item of plan.cases) {
      const row = JSON.parse(
        await readFile(join(output, item.id + ".json"), "utf8"),
      );
      expect(row).toMatchObject({
        fixture: true,
        code: 0,
        result: { status: "completed", modelSteps: 1, toolCalls: 0 },
      });
      expect(row.requests).toHaveLength(1);
      expect(row.requests[0]).toMatchObject({ prompt: item.prompt, tools: [] });
    }
    const subset = join(root, "subset");
    await promisify(execFile)(
      process.execPath,
      [
        script,
        "--prepare",
        "--output",
        subset,
        "--case",
        "explicit-en",
        "--case",
        "quoted-en",
      ],
      {
        env: {
          PATH: process.env["PATH"] ?? "",
          HOME: root,
          FORGE_HOME: join(root, "no-credentials"),
        },
      },
    );
    const subsetPlan = JSON.parse(
      await readFile(join(subset, "plan.json"), "utf8"),
    );
    expect(subsetPlan.cases.map((item: { id: string }) => item.id)).toEqual([
      "explicit-en",
      "quoted-en",
    ]);
    // A retained attempt cannot silently become a paid rerun.
    await expect(run("--live")).rejects.toThrow("EEXIST");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
