import { randomUUID } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import type { RunEvent } from "@forge/core";
import { afterEach, describe, expect, it } from "vitest";

import {
  configuredSecrets,
  createForgeSummaryCheckpoint,
  FileSessionStore,
  FileTraceStore,
  isCheckpointValid,
  JsonlTraceWriter,
  previewSessionCompaction,
  recordRunInSession,
  redactValue,
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
  it("redacts provider keys, bearer tokens, JWTs, and secret fields", () => {
    const apiKey = "sk-test_123456789";
    const secrets = configuredSecrets({ OPENAI_API_KEY: apiKey });
    const redacted = JSON.stringify(
      // Exercise both field-name and value-based redaction.
      redactValue(
        {
          authorization: `Bearer ${apiKey}`,
          message: `failed ${apiKey} eyJabc.def.ghi`,
        },
        secrets,
      ),
    );
    expect(redacted).not.toContain(apiKey);
    expect(redacted).not.toContain("eyJabc");
  });

  it("atomically saves, lists, and reloads completed conversation turns", async () => {
    const home = await forgeHome();
    const store = new FileSessionStore(home);
    const created = store.create({ root: "/workspace", cwd: "/workspace/src" });
    const runId = randomUUID();
    const saved = recordRunInSession(created, {
      prompt: "Fix the parser",
      finalText: "Fixed and tested.",
      reasoning: "Inspect the parser before editing.",
      status: "completed",
      runId,
    });
    await store.save(saved);

    await expect(store.load(saved.id)).resolves.toEqual(saved);
    await expect(store.latest("/workspace")).resolves.toEqual(saved);
    expect(saved.reasoning).toEqual([
      {
        assistantMessageIndex: 1,
        content: "Inspect the parser before editing.",
      },
    ]);
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

  it("persists a redacted derived checkpoint without changing the transcript", async () => {
    const store = new FileSessionStore(await forgeHome(), {
      secrets: ["session-secret-value"],
    });
    let snapshot = store.create({ root: "/workspace", cwd: "/workspace" });
    for (let index = 0; index < 4; index += 1) {
      snapshot = recordRunInSession(snapshot, {
        prompt: `constraint ${index} session-secret-value`,
        finalText: `result ${index}`,
        status: "completed",
        runId: randomUUID(),
      });
    }
    const originalMessages = snapshot.messages;
    const preview = previewSessionCompaction(snapshot, {
      recentTailTokens: 20,
      summaryTargetTokens: 80,
    });
    const compacted = createForgeSummaryCheckpoint(snapshot, {
      provider: "fake",
      modelId: "fake-model",
      recentTailTokens: 20,
      summaryTargetTokens: 80,
      secrets: ["session-secret-value"],
      now: "2026-08-19T00:00:00.000Z",
    });

    expect(preview.eligibleMessageCount).toBeGreaterThan(0);
    expect(compacted.messages).toBe(originalMessages);
    expect(compacted.contextCheckpoint?.summary).not.toContain(
      "session-secret-value",
    );
    expect(compacted.contextCheckpoint?.safetyLabels).toEqual([
      "untrusted-conversation-memory",
      "no-approval-state",
      "no-policy-authority",
    ]);
    expect(isCheckpointValid(compacted)).toBe(true);
    await store.save(compacted);
    const reloaded = await store.load(compacted.id);
    expect(isCheckpointValid(reloaded)).toBe(true);
    expect(JSON.stringify(reloaded)).not.toContain("session-secret-value");
    const continued = recordRunInSession(reloaded, {
      prompt: "new turn",
      finalText: "new answer",
      status: "completed",
      runId: randomUUID(),
    });
    expect(continued.contextCheckpoint).toBeUndefined();
    await expect(store.save(continued)).resolves.toBeUndefined();
  });

  it("migrates a v1 session snapshot to v2 on load", async () => {
    const home = await forgeHome();
    const id = randomUUID();
    await mkdir(path.join(home, "sessions"), { recursive: true });
    await writeFile(
      path.join(home, "sessions", `${id}.json`),
      JSON.stringify({
        schemaVersion: 1,
        id,
        createdAt: "2026-08-19T00:00:00.000Z",
        updatedAt: "2026-08-19T00:00:00.000Z",
        workspaceRoot: "/workspace",
        workingDirectory: "/workspace",
        messages: [],
        runIds: [],
      }),
    );

    await expect(new FileSessionStore(home).load(id)).resolves.toMatchObject({
      schemaVersion: 2,
      id,
      reasoning: [],
    });
  });

  it("loads older v2 snapshots that predate saved reasoning", async () => {
    const home = await forgeHome();
    const id = randomUUID();
    await mkdir(path.join(home, "sessions"), { recursive: true });
    await writeFile(
      path.join(home, "sessions", `${id}.json`),
      JSON.stringify({
        schemaVersion: 2,
        id,
        createdAt: "2026-08-19T00:00:00.000Z",
        updatedAt: "2026-08-19T00:00:00.000Z",
        workspaceRoot: "/workspace",
        workingDirectory: "/workspace",
        messages: [],
        runIds: [],
      }),
    );

    await expect(new FileSessionStore(home).load(id)).resolves.toMatchObject({
      schemaVersion: 2,
      id,
      reasoning: [],
    });
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
        reasoning: `Do not expose ${secret}`,
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
  it("persists and validates delegated-run linkage metadata", async () => {
    const home = await forgeHome();
    const runId = randomUUID();
    const parentRunId = randomUUID();
    const writer = new JsonlTraceWriter({
      forgeHome: home,
      runId,
      parentRunId,
      subagentName: "code-reviewer",
    });
    await writer.append({ type: "run.started", prompt: "Review target.ts" });

    await expect(new FileTraceStore(home).read(runId)).resolves.toEqual([
      expect.objectContaining({
        runId,
        parentRunId,
        subagentName: "code-reviewer",
        sequence: 0,
      }),
    ]);
    expect(
      () =>
        new JsonlTraceWriter({
          forgeHome: home,
          runId: randomUUID(),
          parentRunId: "not-a-uuid",
        }),
    ).toThrow("Invalid parent run ID");
    expect(
      () =>
        new JsonlTraceWriter({
          forgeHome: home,
          runId: randomUUID(),
          subagentName: "Not Valid",
        }),
    ).toThrow("Invalid subagent name");
  });

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
      {
        type: "model.reasoning-unavailable",
        step: 1,
        reasoningTokens: 2,
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
    expect(envelopes.map(({ sequence }) => sequence)).toEqual([0, 1, 2, 3, 4]);
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
