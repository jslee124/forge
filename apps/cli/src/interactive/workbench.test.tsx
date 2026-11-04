import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import {
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { createPersistentInteractiveSession } from "@forge/application";
import type { ForgeTool, RunResult } from "@forge/core";
import { render } from "ink-testing-library";
import { afterEach, expect, it } from "vitest";
import type { RunDependencies } from "../run.js";
import { InteractiveWorkbench } from "./workbench.js";

const exec = promisify(execFile);
const roots: string[] = [];
const instances: { unmount(): void; cleanup(): void }[] = [];
afterEach(async () => {
  for (const instance of instances.splice(0)) {
    instance.unmount();
    instance.cleanup();
  }
  for (const root of roots.splice(0))
    await rm(root, {
      recursive: true,
      force: true,
      maxRetries: 10,
      retryDelay: 50,
    });
});
const settle = () => new Promise((resolve) => setTimeout(resolve, 25));
async function setup() {
  const root = await realpath(
    await mkdtemp(join(tmpdir(), "forge-tui-sessions-")),
  );
  roots.push(root);
  const cwd = join(root, "project");
  await mkdir(cwd);
  await exec("git", ["init", cwd]);
  await writeFile(join(cwd, "file.txt"), "HEAD\n");
  await exec("git", ["-C", cwd, "add", "."]);
  await exec("git", [
    "-C",
    cwd,
    "-c",
    "user.name=Fixture",
    "-c",
    "user.email=fixture@example.invalid",
    "commit",
    "-m",
    "fixture",
  ]);
  const env = { FORGE_HOME: join(root, "home") };
  const sessionPersistence = await createPersistentInteractiveSession({
    cwd,
    env,
  });
  return { cwd, env, sessionPersistence };
}
function result(text: string, cancelled = false): RunResult {
  return {
    status: cancelled ? "cancelled" : "completed",
    exitCode: cancelled ? 130 : 0,
    finalText: text,
    modelSteps: 1,
    toolCalls: 0,
    events: [],
  };
}
async function select(instance: ReturnType<typeof render>, index: number) {
  instance.stdin.write("\u0010");
  await settle();
  for (let n = 0; n < index; n++) {
    instance.stdin.write("\u001B[B");
    await settle();
  }
  instance.stdin.write("\r");
  await settle();
}
async function send(instance: ReturnType<typeof render>, prompt: string) {
  await expect.poll(() => instance.lastFrame()).toContain("Enter submit");
  instance.stdin.write(prompt);
  await expect.poll(() => instance.lastFrame()).toContain(prompt);
  instance.stdin.write("\r");
  await settle();
}

it("keeps two approvals independent, queues a third session, restores drafts and cancels only the selected task", async () => {
  const fixture = await setup();
  const started: { prompt: string; dependencies: RunDependencies }[] = [];
  const decisions = new Map<string, boolean | undefined>();
  const instance = render(
    <InteractiveWorkbench
      {...fixture}
      options={{ engine: "forge" }}
      executeTask={async (prompt, _options, dependencies) => {
        started.push({ prompt, dependencies });
        dependencies.onEvent?.({
          type: "model.text",
          step: 1,
          text: `stream-${prompt}`,
        });
        const approved = await dependencies.approvalChannel?.request(
          {
            call: {
              id: randomUUID(),
              name: "run_command",
              input: { program: "echo", args: [prompt] },
            },
            tool: { name: "run_command", risk: "process" } as ForgeTool,
            input: { program: "echo", args: [prompt] },
          },
          dependencies.signal,
          {
            workspace: { root: dependencies.cwd, cwd: dependencies.cwd },
            signal: dependencies.signal,
            limits: { maxOutputBytes: 65536, maxEntries: 200 },
          },
        );
        decisions.set(prompt, approved);
        const completed = result(
          `answer-${prompt}`,
          dependencies.signal.aborted,
        );
        dependencies.onResult?.(completed, {
          runId: dependencies.runId ?? randomUUID(),
          ...(dependencies.sessionId
            ? { sessionId: dependencies.sessionId }
            : {}),
          tracePersisted: false,
        });
        return completed.exitCode;
      }}
    />,
  );
  instances.push(instance);
  await settle();
  await send(instance, "A");
  await expect.poll(() => instance.lastFrame()).toContain("Approval required");
  instance.stdin.write("\u000e");
  await expect.poll(() => instance.lastFrame()).toContain("New session");
  await settle();
  await send(instance, "B");
  await expect.poll(() => started.length).toBe(2);
  instance.stdin.write("\u000e");
  await expect.poll(() => instance.lastFrame()).toContain("New session");
  await settle();
  await send(instance, "C");
  await expect.poll(() => instance.lastFrame()).toContain("queued 1");
  expect(started.map((run) => run.prompt)).toEqual(["A", "B"]);
  expect(started[0]?.dependencies.cwd).not.toBe(started[1]?.dependencies.cwd);
  expect(
    await readFile(
      join(started[1]?.dependencies.cwd ?? "", "file.txt"),
      "utf8",
    ),
  ).toBe("HEAD\n");
  instance.stdin.write("\u0003");
  await expect.poll(() => instance.lastFrame()).toContain("queued 0");
  expect(started).toHaveLength(2);
  await select(instance, 0);
  expect(instance.lastFrame()).toContain("stream-A");
  expect(instance.lastFrame()).not.toContain("stream-B");
  instance.stdin.write("1");
  await expect.poll(() => decisions.get("A")).toBe(true);
  expect(decisions.has("B")).toBe(false);
  await expect.poll(() => instance.lastFrame()).toContain("Completed");
  instance.stdin.write("A-next-draft");
  await settle();
  await select(instance, 1);
  expect(instance.lastFrame()).toContain("Approval required");
  expect(instance.lastFrame()).not.toContain("A-next-draft");
  instance.stdin.write("\u0003");
  await expect.poll(() => decisions.get("B")).toBe(false);
  await select(instance, 0);
  expect(instance.lastFrame()).toContain("A-next-draft");
  await expect.poll(() => instance.lastFrame()).toContain("running 0/2");
});

it("holds Codex approvals inside the selected panel and cancels all sessions on exit", async () => {
  const fixture = await setup();
  const approved: string[] = [];
  const cancelled: string[] = [];
  const instance = render(
    <InteractiveWorkbench
      {...fixture}
      options={{ engine: "codex" }}
      executeCodexTask={async (prompt, _options, dependencies) => {
        const allow = await dependencies.approve?.(`Codex approval ${prompt}`);
        if (allow) approved.push(prompt);
        if (!dependencies.signal.aborted)
          await new Promise<void>((resolve) =>
            dependencies.signal.addEventListener("abort", () => resolve(), {
              once: true,
            }),
          );
        cancelled.push(prompt);
        return 130;
      }}
    />,
  );
  instances.push(instance);
  await settle();
  await send(instance, "codex-A");
  await expect
    .poll(() => instance.lastFrame())
    .toContain("Codex approval codex-A");
  instance.stdin.write("\u000e");
  await expect.poll(() => instance.lastFrame()).toContain("New session");
  await settle();
  await send(instance, "codex-B");
  await expect
    .poll(() => instance.lastFrame())
    .toContain("Codex approval codex-B");
  instance.stdin.write("1");
  await expect.poll(() => approved).toEqual(["codex-B"]);
  await select(instance, 0);
  expect(instance.lastFrame()).toContain("Codex approval codex-A");
  instance.stdin.write("1");
  await expect.poll(() => approved).toEqual(["codex-B", "codex-A"]);
  instance.stdin.write("\u000e");
  await expect.poll(() => instance.lastFrame()).toContain("New session");
  await settle();
  await send(instance, "/exit");
  await expect.poll(() => cancelled.sort()).toEqual(["codex-A", "codex-B"]);
  await expect.poll(() => instance.stdout.listenerCount("resize")).toBe(0);
});

it("opens saved sessions without execution and requires explicit confirmation to delete a closed conversation", async () => {
  const fixture = await setup();
  const saved = await createPersistentInteractiveSession({
    cwd: fixture.cwd,
    env: fixture.env,
  });
  const id = await saved.prepareRun("Saved task");
  await saved.recordRun("Saved task", result("Saved answer"), {
    runId: randomUUID(),
    sessionId: id,
    tracePersisted: false,
  });
  let executions = 0;
  const instance = render(
    <InteractiveWorkbench
      {...fixture}
      options={{ engine: "forge" }}
      executeTask={async () => {
        executions++;
        return 0;
      }}
    />,
  );
  instances.push(instance);
  await expect.poll(() => instance.lastFrame()).toContain("Enter submit");
  await settle();
  instance.stdin.write("\u0010");
  await expect.poll(() => instance.lastFrame()).toContain("[saved] Saved task");
  instance.stdin.write("\u001B[B");
  await settle();
  instance.stdin.write("\r");
  await expect.poll(() => instance.lastFrame()).toContain("Saved answer");
  expect(executions).toBe(0);
  instance.stdin.write("\u0010");
  await settle();
  instance.stdin.write("\u001B[B");
  await settle();
  instance.stdin.write("x");
  await expect.poll(() => instance.lastFrame()).toContain("[saved] Saved task");
  instance.stdin.write("\u001B[B");
  await settle();
  instance.stdin.write("\u0004");
  await expect.poll(() => instance.lastFrame()).toContain("y delete");
  instance.stdin.write("\r");
  await settle();
  const file = join(fixture.env.FORGE_HOME, "sessions", `${id}.json`);
  expect(await readFile(file, "utf8")).toContain("Saved task");
  instance.stdin.write("\u0004");
  await settle();
  instance.stdin.write("y");
  await expect
    .poll(() => instance.lastFrame())
    .toContain("Saved conversation deleted");
  await expect(readFile(file)).rejects.toThrow();
  expect(await readFile(join(fixture.cwd, "file.txt"), "utf8")).toBe("HEAD\n");
  expect(executions).toBe(0);
});

it("reloads current user model configuration on disk resume while preserving the original view's selection", async () => {
  const fixture = await setup();
  const otherPath = join(fixture.cwd, "..", "other");
  await mkdir(otherPath);
  const other = await realpath(otherPath);
  await mkdir(join(other, ".git"));
  await mkdir(fixture.env.FORGE_HOME, { recursive: true });
  await writeFile(
    join(fixture.env.FORGE_HOME, "config.json"),
    JSON.stringify({
      schemaVersion: 1,
      model: { provider: "saved-fixture", id: "saved-project-model" },
      providers: {
        "saved-fixture": {
          api: "openai-completions",
          baseUrl: "http://127.0.0.1:1/v1",
          auth: { type: "none" },
          models: [{ id: "saved-project-model" }],
        },
      },
    }),
  );
  const saved = await createPersistentInteractiveSession({
    cwd: other,
    env: fixture.env,
  });
  const id = await saved.prepareRun("Other project");
  await saved.recordRun("Other project", result("Other answer"), {
    runId: randomUUID(),
    sessionId: id,
    tracePersisted: false,
  });
  const instance = render(
    <InteractiveWorkbench
      {...fixture}
      options={{ engine: "forge", model: "original-view-model" }}
      startupOptions={{}}
    />,
  );
  instances.push(instance);
  await expect.poll(() => instance.lastFrame()).toContain("Enter submit");
  await settle();
  instance.stdin.write("\u0010");
  await expect
    .poll(() => instance.lastFrame())
    .toContain("[saved] Other project");
  instance.stdin.write("\u001B[B");
  await settle();
  instance.stdin.write("\r");
  await expect
    .poll(() => instance.lastFrame())
    .toContain("saved-project-model");
  expect(instance.lastFrame()).not.toContain("original-view-model");
  await select(instance, 0);
  expect(instance.lastFrame()).toContain("original-view-model");
});
