import { randomUUID } from "node:crypto";
import { mkdir, mkdtemp, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { FileSessionStore, JsonlTraceWriter } from "@forge/persistence";
import { afterEach, describe, expect, it } from "vitest";

import {
  createPersistentInteractiveSession,
  PersistentInteractiveSession,
} from "./persistent-session.js";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe("persistent interactive session", () => {
  it("restores completed history after restart and appends a fresh run", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "forge-session-"));
    temporaryDirectories.push(root);
    await mkdir(path.join(root, ".git"));
    const env = { FORGE_HOME: path.join(root, "forge-home") };
    const first = await createPersistentInteractiveSession({ cwd: root, env });
    const sessionId = await first.prepareRun();
    const firstRunId = randomUUID();
    await first.recordRun(
      "first task",
      completed("first answer", "first reasoning"),
      {
        runId: firstRunId,
        sessionId,
        tracePersisted: true,
      },
    );

    const resumed = await createPersistentInteractiveSession({
      cwd: root,
      env,
      sessionId,
    });

    expect(resumed).toBeInstanceOf(PersistentInteractiveSession);
    expect(resumed.messages).toEqual([
      { role: "user", content: "first task" },
      { role: "assistant", content: "first answer" },
    ]);
    expect(resumed.reasoning).toEqual([
      { assistantMessageIndex: 1, content: "first reasoning" },
    ]);
    expect(await resumed.prepareRun()).toBe(sessionId);

    const secondRunId = randomUUID();
    await resumed.recordRun("second task", completed("second answer"), {
      runId: secondRunId,
      sessionId,
      tracePersisted: true,
    });
    const latest = await createPersistentInteractiveSession({
      cwd: root,
      env,
      last: true,
    });
    expect(latest.messages.at(-1)).toEqual({
      role: "assistant",
      content: "second answer",
    });
  });

  it("backfills reasoning from older run traces during resume", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "forge-session-trace-"));
    temporaryDirectories.push(root);
    await mkdir(path.join(root, ".git"));
    const workspaceRoot = await realpath(root);
    const forgeHome = path.join(root, "forge-home");
    const env = { FORGE_HOME: forgeHome };
    const sessionStore = new FileSessionStore(forgeHome);
    const snapshot = sessionStore.create({
      root: workspaceRoot,
      cwd: workspaceRoot,
    });
    const runId = randomUUID();
    await sessionStore.save({
      ...snapshot,
      messages: [
        { role: "user", content: "old task" },
        { role: "assistant", content: "old answer" },
      ],
      runIds: [runId],
    });
    const trace = new JsonlTraceWriter({
      forgeHome,
      runId,
      sessionId: snapshot.id,
    });
    await trace.append({ type: "run.started", prompt: "old task" });
    await trace.append({
      type: "model.reasoning",
      step: 1,
      text: "old reasoning",
    });
    await trace.append({ type: "model.text", step: 1, text: "old answer" });
    await trace.append({ type: "run.completed" });

    const resumed = await createPersistentInteractiveSession({
      cwd: root,
      env,
      sessionId: snapshot.id,
    });

    expect(resumed.reasoning).toEqual([
      { assistantMessageIndex: 1, content: "old reasoning" },
    ]);
  });

  it("persists the original unavailable-reasoning status for resume", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "forge-session-hidden-"));
    temporaryDirectories.push(root);
    await mkdir(path.join(root, ".git"));
    const env = { FORGE_HOME: path.join(root, "forge-home") };
    const session = await createPersistentInteractiveSession({
      cwd: root,
      env,
    });

    await session.recordRun(
      "hidden reasoning task",
      {
        ...completed("hidden reasoning answer"),
        events: [
          {
            type: "model.reasoning-unavailable",
            step: 1,
            reasoningTokens: 42,
          },
        ],
      },
      {
        runId: randomUUID(),
        sessionId: await session.prepareRun(),
        tracePersisted: false,
      },
    );

    expect(session.reasoning).toEqual([
      {
        assistantMessageIndex: 1,
        content:
          "Provider used 42 reasoning tokens but did not return reasoning text.",
      },
    ]);
  });
});

function completed(finalText: string, reasoning = "") {
  return {
    status: "completed" as const,
    exitCode: 0,
    finalText,
    modelSteps: 1,
    toolCalls: 0,
    events: reasoning
      ? [{ type: "model.reasoning" as const, step: 1, text: reasoning }]
      : [],
  };
}
