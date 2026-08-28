import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { JsonlTraceWriter } from "@forge/persistence";
import { afterEach, describe, expect, it } from "vitest";

import { runInspect } from "./inspect.js";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe("forge inspect", () => {
  it("renders a persisted trace without executing a model or tool", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "forge-inspect-"));
    temporaryDirectories.push(root);
    const runId = randomUUID();
    const writer = new JsonlTraceWriter({ forgeHome: root, runId });
    await writer.append({
      type: "skill.discovery",
      catalogCount: 1,
      diagnosticCount: 0,
      diagnostics: [],
    });
    await writer.append({
      type: "skill.selected",
      id: "skill:builtin:forge-plugin-creator",
      name: "forge-plugin-creator",
      source: "builtin",
      reason: "automatic",
      invocation: "model",
    });
    await writer.append({
      type: "skill.loaded",
      id: "skill:builtin:forge-plugin-creator",
      name: "forge-plugin-creator",
      source: "builtin",
      relativePath: "SKILL.md",
      truncated: false,
    });
    await writer.append({ type: "run.started", prompt: "Inspect repository" });
    await writer.append({ type: "model.started", step: 1 });
    await writer.append({ type: "run.completed" });
    const stdout = outputBuffer();
    const stderr = outputBuffer();

    const exitCode = await runInspect(runId, {
      cwd: root,
      env: { FORGE_HOME: root },
      stdout: stdout.output,
      stderr: stderr.output,
    });

    expect(exitCode).toBe(0);
    expect(stdout.read()).toContain(`Run ${runId}`);
    expect(stdout.read()).toContain("Status completed");
    expect(stdout.read()).toContain('run.started "Inspect repository"');
    expect(stdout.read()).toContain(
      "skill.selected $forge-plugin-creator id=skill:builtin:forge-plugin-creator source=builtin reason=automatic invocation=model",
    );
    expect(stdout.read()).toContain(
      "skill.loaded $forge-plugin-creator id=skill:builtin:forge-plugin-creator source=builtin resource=SKILL.md truncated=false",
    );
    expect(stderr.read()).toBe("");
  });

  it("returns an actionable error for a missing trace", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "forge-inspect-"));
    temporaryDirectories.push(root);
    const stderr = outputBuffer();

    const exitCode = await runInspect(randomUUID(), {
      cwd: root,
      env: { FORGE_HOME: root },
      stdout: outputBuffer().output,
      stderr: stderr.output,
    });

    expect(exitCode).toBe(2);
    expect(stderr.read()).toContain("Inspection error: Could not load trace");
  });
});

function outputBuffer(): {
  readonly output: { write(chunk: string): void };
  read(): string;
} {
  let value = "";
  return {
    output: { write: (chunk) => (value += chunk) },
    read: () => value,
  };
}
