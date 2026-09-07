import { randomUUID } from "node:crypto";
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import type {
  ModelAdapter,
  ModelStreamEvent,
  RunEvent,
  RunResult,
} from "@forge/core";
import { expect, it } from "vitest";
import { createPersistentInteractiveSession } from "./persistent-session.js";
import { runTask } from "./run.js";

it("runs and resumes a session through shared services without a terminal", async () => {
  const cwd = await mkdtemp(path.join(tmpdir(), "forge-application-"));
  try {
    const env = { FORGE_HOME: path.join(cwd, "home") };
    const session = await createPersistentInteractiveSession({ cwd, env });
    const sessionId = await session.prepareRun("hello");
    const events: RunEvent[] = [];
    const runId = randomUUID();
    let result: RunResult | undefined;
    const model: ModelAdapter = {
      async *stream(): AsyncIterable<ModelStreamEvent> {
        yield { type: "text.delta", text: "Shared answer" };
        yield {
          type: "finish",
          finishReason: "stop",
          usage: {
            inputTokens: 1,
            outputTokens: 1,
            reasoningTokens: 0,
            cachedInputTokens: 0,
            cacheWriteTokens: 0,
            totalTokens: 2,
          },
        };
      },
    };
    const code = await runTask(
      "hello",
      {},
      {
        cwd,
        env,
        sessionId,
        signal: new AbortController().signal,
        stderr: { write() {} },
        createAdapter: () => model,
        onEvent: (event) => {
          events.push(event);
        },
        onResult: (value) => {
          result = value;
        },
      },
    );
    expect(code).toBe(0);
    expect(result?.finalText).toBe("Shared answer");
    expect(events.some((event) => event.type === "run.completed")).toBe(true);
    if (!result) throw new Error("Missing run result");
    await session.recordRun("hello", result, {
      runId,
      sessionId,
      tracePersisted: true,
    });
    const resumed = await createPersistentInteractiveSession({
      cwd,
      env,
      sessionId,
    });
    expect(resumed.messages).toEqual([
      { role: "user", content: "hello" },
      { role: "assistant", content: "Shared answer" },
    ]);
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

it("keeps application services independent of CLI and UI runtimes", async () => {
  const directory = new URL("./", import.meta.url);
  for (const file of await readdir(directory)) {
    if (!file.endsWith(".ts") || file.endsWith(".test.ts")) continue;
    const source = await readFile(new URL(file, directory), "utf8");
    expect(source).not.toMatch(
      /(?:from\s*|import\s*\()["'](?:react|ink|electron|@forge\/cli|.*apps\/cli)/u,
    );
    expect(source).not.toMatch(
      /process\.(?:stdin|stdout|stderr)|node:readline/u,
    );
  }
});
