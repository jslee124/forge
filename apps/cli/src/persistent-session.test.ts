import { randomUUID } from "node:crypto";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

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
    await first.recordRun("first task", completed("first answer"), {
      runId: firstRunId,
      sessionId,
      tracePersisted: true,
    });

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
});

function completed(finalText: string) {
  return {
    status: "completed" as const,
    exitCode: 0,
    finalText,
    modelSteps: 1,
    toolCalls: 0,
    events: [],
  };
}
