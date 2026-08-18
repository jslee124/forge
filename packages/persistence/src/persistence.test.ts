import { randomUUID } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import type { RunEvent } from "@forge/core";
import { afterEach, describe, expect, it } from "vitest";

import {
  FileSessionStore,
  FileTraceStore,
  JsonlTraceWriter,
  recordRunInSession,
  summarizeTrace,
} from "./index.js";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

async function forgeHome(): Promise<string> {
  const directory = await mkdtemp(path.join(tmpdir(), "forge-persistence-"));
  temporaryDirectories.push(directory);
  return directory;
}

describe("persistent sessions", () => {
  it("atomically saves, lists, and reloads completed conversation turns", async () => {
    const home = await forgeHome();
    const store = new FileSessionStore(home);
    const created = store.create({ root: "/workspace", cwd: "/workspace/src" });
    const runId = randomUUID();
    const saved = recordRunInSession(created, {
      prompt: "Fix the parser",
      finalText: "Fixed and tested.",
      status: "completed",
      runId,
    });
    await store.save(saved);

    await expect(store.load(saved.id)).resolves.toEqual(saved);
    await expect(store.latest("/workspace")).resolves.toEqual(saved);
    expect(await store.list("/workspace")).toEqual([
      expect.objectContaining({
        id: saved.id,
        title: "Fix the parser",
        messageCount: 2,
        runCount: 1,
      }),
    ]);
    await expect(store.list("/other")).resolves.toEqual([]);
  });

  it("records failed runs without restoring incomplete conversation turns", async () => {
    const store = new FileSessionStore(await forgeHome());
    const created = store.create({ root: "/workspace", cwd: "/workspace" });
    const saved = recordRunInSession(created, {
      prompt: "Dangerous task",
      finalText: "",
      status: "denied",
      runId: randomUUID(),
    });

    expect(saved.messages).toEqual([]);
    expect(saved.runIds).toHaveLength(1);
    expect(saved.lastRunStatus).toBe("denied");
  });

  it("rejects invalid IDs and cross-workspace resume", async () => {
    const store = new FileSessionStore(await forgeHome());
    const snapshot = store.create({ root: "/workspace", cwd: "/workspace" });
    await store.save(snapshot);

    await expect(store.load("../config.json")).rejects.toThrow(
      "Invalid session ID",
    );
    await expect(store.loadForWorkspace(snapshot.id, "/other")).rejects.toThrow(
      "different workspace",
    );
  });

  it("redacts configured secrets from persisted conversation messages", async () => {
    const home = await forgeHome();
    const secret = "session-secret-value";
    const store = new FileSessionStore(home, { secrets: [secret] });
    const snapshot = recordRunInSession(
      store.create({ root: "/workspace", cwd: "/workspace" }),
      {
        prompt: `Remember ${secret}`,
        finalText: "Done.",
        status: "completed",
        runId: randomUUID(),
      },
    );
    await store.save(snapshot);

    const raw = await readFile(
      path.join(home, "sessions", `${snapshot.id}.json`),
      "utf8",
    );
    expect(raw).not.toContain(secret);
    expect(raw).toContain("[REDACTED]");
  });
});

describe("JSONL run traces", () => {
  it("persists versioned events, redacts secrets, and summarizes the run", async () => {
    const home = await forgeHome();
    const runId = randomUUID();
    const sessionId = randomUUID();
    const secret = "deepseek-test-secret";
    const writer = new JsonlTraceWriter({
      forgeHome: home,
      runId,
      sessionId,
      secrets: [secret],
    });
    const events: RunEvent[] = [
      { type: "run.started", prompt: `Do not leak ${secret}` },
      { type: "model.started", step: 1 },
      {
        type: "model.completed",
        step: 1,
        finishReason: "stop",
        usage: {
          inputTokens: 10,
          outputTokens: 4,
          reasoningTokens: 2,
          cachedInputTokens: 1,
          cacheWriteTokens: 0,
          totalTokens: 14,
        },
      },
      { type: "run.completed" },
    ];
    for (const event of events) await writer.append(event);

    const raw = await readFile(
      path.join(home, "runs", `${runId}.jsonl`),
      "utf8",
    );
    expect(raw).not.toContain(secret);
    expect(raw).toContain("[REDACTED]");

    const envelopes = await new FileTraceStore(home).read(runId);
    expect(envelopes.map(({ sequence }) => sequence)).toEqual([0, 1, 2, 3]);
    expect(summarizeTrace(envelopes)).toMatchObject({
      runId,
      sessionId,
      modelSteps: 1,
      toolCalls: 0,
      status: "completed",
      usage: { inputTokens: 10, outputTokens: 4, totalTokens: 14 },
    });
  });

  it("rejects malformed trace lines", async () => {
    const home = await forgeHome();
    const runId = randomUUID();
    await mkdir(path.join(home, "runs"));
    await writeFile(
      path.join(home, "runs", `${runId}.jsonl`),
      `${JSON.stringify({
        schemaVersion: 1,
        runId,
        sequence: 0,
        timestamp: new Date().toISOString(),
        event: { type: "model.started" },
      })}\n`,
    );

    await expect(
      new FileTraceStore(home).read("../session.json"),
    ).rejects.toThrow("Invalid run ID");
    await expect(new FileTraceStore(home).read(runId)).rejects.toThrow(
      "invalid or unsupported",
    );
  });
});
