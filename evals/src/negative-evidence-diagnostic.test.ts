import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { expect, it } from "vitest";

async function fixture() {
  const { PATH: pathValue = "" } = process.env;
  const root = await mkdtemp(join(tmpdir(), "forge-negative-diagnostic-test-"));
  const output = join(root, "diagnostic");
  const script = fileURLToPath(
    new URL("../scripts/compare-negative-evidence.mjs", import.meta.url),
  );
  const run = (mode: string, extra: string[] = []) =>
    promisify(execFile)(
      process.execPath,
      [script, mode, "--output", output, ...extra],
      {
        env: {
          PATH: pathValue,
          HOME: root,
          FORGE_HOME: join(root, "no-auth"),
        },
      },
    );
  return { root, output, run };
}

it("projects the same fixed evidence and policy for two models and framings without credentials or paid calls", async () => {
  const { root, output, run } = await fixture();
  try {
    expect((await run("--prepare")).stdout).toContain(
      '"credentialAccess":false',
    );
    expect((await run("--check")).stdout).toContain(
      "no credential access or provider calls",
    );
    await run("--fixture");
    const plan = JSON.parse(await readFile(join(output, "plan.json"), "utf8"));
    const observations = JSON.parse(
      await readFile(join(output, "observations.json"), "utf8"),
    );
    const summary = JSON.parse(
      await readFile(join(output, "fixture", "summary.json"), "utf8"),
    );
    expect(plan).toMatchObject({
      maxRequests: 8,
      maxRequestsPerCase: 1,
      maxOutputTokensPerRequest: 4096,
      toolsExecutedDuringModelCalls: 0,
    });
    expect(summary).toMatchObject({
      fixtureModel: true,
      networkRequests: 0,
      remainingCases: 0,
      productGateComplete: false,
    });
    expect(summary.results).toHaveLength(8);
    expect(summary.results[0].failure).toBe("raw-protocol-rejected");
    expect(summary.results[1].failure).toBe("incomplete-output");
    expect(summary.results[2].failure).toBe("unexpected-tool-call");
    expect(
      summary.results.slice(3).every((r: { failure?: string }) => !r.failure),
    ).toBe(true);
    const byFrame = new Map<string, string>();
    const slots = new Set<string>();
    for (const entry of plan.cases) {
      slots.add(`${entry.model}/${entry.framing}/${entry.replicate}`);
      const body = JSON.parse(
        await readFile(
          join(output, "fixture", `${entry.id}-request.json`),
          "utf8",
        ),
      );
      expect(body).toMatchObject({
        model: entry.model,
        tool_choice: "none",
        thinking: { type: "enabled" },
        reasoning_effort: "high",
        max_tokens: 4096,
      });
      expect(body.tools).toHaveLength(2);
      if (entry.framing === "tool-history") {
        expect(body.messages.map((m: { role: string }) => m.role)).toEqual([
          "system",
          "user",
          "assistant",
          "tool",
          "tool",
        ]);
        expect(body.messages[2].reasoning_content).toBe("");
        expect(body.messages[2].tool_calls).toHaveLength(2);
        for (let i = 0; i < 2; i++)
          expect(JSON.parse(body.messages[3 + i].content)).toEqual(
            observations.operations[i].result,
          );
      } else {
        expect(body.messages.map((m: { role: string }) => m.role)).toEqual([
          "system",
          "user",
        ]);
        const packet = body.messages[1].content
          .split('<tool_observations authority="untrusted-data">\n')[1]
          .split("\n</tool_observations>")[0];
        expect(JSON.parse(packet)).toEqual(observations.operations);
      }
      const { model: _model, ...same } = body;
      const normalized = JSON.stringify(same);
      if (byFrame.has(entry.framing))
        expect(normalized).toBe(byFrame.get(entry.framing));
      else byFrame.set(entry.framing, normalized);
    }
    expect(slots.size).toBe(8);
    expect(observations.operations[1].result.output).toMatchObject({
      matches: [],
      scannedFiles: 9,
      noMatch: expect.any(String),
    });
    await expect(run("--fixture")).rejects.toMatchObject({
      stderr: expect.stringContaining("EEXIST"),
    });
    expect(
      JSON.parse(
        await readFile(join(output, "fixture", "summary.json"), "utf8"),
      ),
    ).toEqual(summary);
    await expect(stat(join(output, "live"))).rejects.toMatchObject({
      code: "ENOENT",
    });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

it.each(["observations.json", "plan.json"])(
  "rejects changed %s before credential access or a live-attempt directory",
  async (file) => {
    const { root, output, run } = await fixture();
    try {
      await run("--prepare");
      const data = JSON.parse(await readFile(join(output, file), "utf8"));
      data.unapprovedInput = "must not be sent";
      await writeFile(join(output, file), JSON.stringify(data));
      await expect(run("--live")).rejects.toMatchObject({
        stderr: expect.stringContaining(
          "Prepared input, policy, script or revision changed",
        ),
      });
      await expect(stat(join(output, "live"))).rejects.toMatchObject({
        code: "ENOENT",
      });
      await expect(
        run("--live", ["--model", "unapproved"]),
      ).rejects.toMatchObject({
        stderr: expect.stringContaining("Unknown option"),
      });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  },
);
