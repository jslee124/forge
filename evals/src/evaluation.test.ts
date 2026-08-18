import { cp, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { gradeWorkspace } from "./grader.js";
import { runLiveEvaluation } from "./live-runner.js";
import { repositoryRoot } from "./paths.js";
import { loadTaskManifests } from "./tasks.js";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe("evaluation task contracts", () => {
  it("loads three versioned tasks", async () => {
    const tasks = await loadTaskManifests();
    expect(tasks.map(({ id }) => id).sort()).toEqual([
      "config-merge",
      "retry-cache",
      "validation-bug",
    ]);
  });

  it("rejects every intentionally broken fixture", async () => {
    for (const task of await loadTaskManifests()) {
      const workspace = await copyFixture(task.fixture);
      const grade = await gradeWorkspace(task, workspace);
      expect(grade.passed, task.id).toBe(false);
    }
  });

  it("accepts reference fixes with public and hidden checks", async () => {
    for (const task of await loadTaskManifests()) {
      const workspace = await copyFixture(task.fixture);
      await applyReferenceFix(task.id, workspace);
      const grade = await gradeWorkspace(task, workspace);
      expect(grade.publicTests.exitCode, task.id).toBe(0);
      expect(grade.hiddenTests.exitCode, task.id).toBe(0);
      expect(grade.passed, task.id).toBe(true);
    }
  });
});

describe("live evaluation guard", () => {
  it("requires explicit paid-call opt-in before checking credentials", async () => {
    await expect(runLiveEvaluation({ env: {} })).rejects.toThrow(
      "FORGE_EVAL_LIVE=1",
    );
  });

  it("requires a DeepSeek API key after opt-in", async () => {
    await expect(
      runLiveEvaluation({ env: { FORGE_EVAL_LIVE: "1" } }),
    ).rejects.toThrow("DEEPSEEK_API_KEY");
  });
});

async function copyFixture(relative: string): Promise<string> {
  const parent = await mkdtemp(path.join(tmpdir(), "forge-grader-test-"));
  temporaryDirectories.push(parent);
  const workspace = path.join(parent, "workspace");
  await cp(path.join(repositoryRoot(), relative), workspace, {
    recursive: true,
  });
  return workspace;
}

async function applyReferenceFix(
  taskId: string,
  workspace: string,
): Promise<void> {
  switch (taskId) {
    case "validation-bug":
      await writeFile(
        path.join(workspace, "src", "parse-port.ts"),
        `export function parsePort(value: string): number {
  if (!/^\\d+$/u.test(value)) throw new Error("Port must be a valid port.");
  const port = Number(value);
  if (port < 1 || port > 65535) throw new Error("Port must be a valid port.");
  return port;
}
`,
      );
      return;
    case "retry-cache":
      await writeFile(
        path.join(workspace, "src", "retry-cache.ts"),
        `export class RetryCache {
  readonly #entries = new Map<string, Promise<unknown>>();
  getOrLoad<T>(key: string, loader: () => Promise<T>): Promise<T> {
    const existing = this.#entries.get(key) as Promise<T> | undefined;
    if (existing) return existing;
    const pending = loader();
    this.#entries.set(key, pending);
    void pending.catch(() => {
      if (this.#entries.get(key) === pending) this.#entries.delete(key);
    });
    return pending;
  }
}
`,
      );
      return;
    case "config-merge":
      await writeFile(
        path.join(workspace, "src", "merge-options.ts"),
        `export interface WorkerOptions {
  readonly enabled: boolean;
  readonly retries: number;
  readonly label: string;
}
export function mergeWorkerOptions(
  defaults: WorkerOptions,
  overrides: Partial<WorkerOptions>,
): WorkerOptions {
  return {
    enabled: overrides.enabled ?? defaults.enabled,
    retries: overrides.retries ?? defaults.retries,
    label: overrides.label ?? defaults.label,
  };
}
`,
      );
      return;
    default:
      throw new Error(`No reference fix for ${taskId}.`);
  }
}
