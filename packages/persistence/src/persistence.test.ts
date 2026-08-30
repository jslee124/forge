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
  MAX_SESSION_BYTES,
  previewSessionCompaction,
  recordRunInSession,
  redactValue,
  runEventSchema,
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

  it("round-trips redacted structured tool history without restoring authority", async () => {
    const home = await forgeHome();
    const secret = "sk-structured-history-secret";
    const store = new FileSessionStore(home, { secrets: [secret] });
    const created = store.create({ root: "/workspace", cwd: "/workspace" });
    const runId = randomUUID();
    const saved = recordRunInSession(created, {
      prompt: "inspect",
      finalText: "done",
      status: "completed",
      runId,
      canonicalDelta: [
        {
          id: `${runId}:user`,
          runId,
          role: "user",
          content: [{ type: "text", text: "inspect" }],
        },
        {
          id: `${runId}:assistant:1`,
          runId,
          step: 1,
          role: "assistant",
          content: [
            {
              type: "tool-call",
              id: "call-1",
              name: "read_file",
              input: { path: "secret.txt", token: secret },
            },
          ],
        },
        {
          id: `${runId}:tool:1:0`,
          runId,
          step: 1,
          role: "tool",
          toolCallId: "call-1",
          toolName: "read_file",
          content: [{ type: "text", text: `result ${secret}` }],
          isError: false,
        },
        {
          id: `${runId}:assistant:2`,
          runId,
          step: 2,
          role: "assistant",
          content: [{ type: "text", text: "done" }],
        },
      ],
    });
    await store.save(saved);
    const reloaded = await store.load(saved.id);

    expect(reloaded.schemaVersion).toBe(3);
    expect(reloaded.historyFidelity).toBe("structured");
    expect(reloaded.history.map(({ role }) => role)).toEqual([
      "user",
      "assistant",
      "tool",
      "assistant",
    ]);
    expect(JSON.stringify(reloaded)).not.toContain(secret);
    expect(JSON.stringify(reloaded)).not.toContain("approvalStore");
  });

  it("persists independent runs that reuse a provider tool-call ID", async () => {
    const store = new FileSessionStore(await forgeHome());
    let snapshot = store.create({ root: "/workspace", cwd: "/workspace" });
    for (const prompt of ["inspect a", "inspect b"]) {
      const runId = randomUUID();
      snapshot = recordRunInSession(snapshot, {
        prompt,
        finalText: "done",
        status: "completed",
        runId,
        canonicalDelta: [
          {
            id: `${runId}:user`,
            runId,
            role: "user",
            content: [{ type: "text", text: prompt }],
          },
          {
            id: `${runId}:assistant:1`,
            runId,
            step: 1,
            role: "assistant",
            content: [
              {
                type: "tool-call",
                id: "call-1",
                name: "read_file",
                input: { path: `${prompt.at(-1)}.ts` },
              },
            ],
          },
          {
            id: `${runId}:tool:1:0`,
            runId,
            step: 1,
            role: "tool",
            toolCallId: "call-1",
            toolName: "read_file",
            content: [{ type: "text", text: '{"ok":true}' }],
            isError: false,
          },
          {
            id: `${runId}:assistant:2`,
            runId,
            step: 2,
            role: "assistant",
            content: [{ type: "text", text: "done" }],
          },
        ],
      });
    }

    await expect(store.save(snapshot)).resolves.toBeUndefined();
    await expect(store.load(snapshot.id)).resolves.toEqual(snapshot);
  });

  it("accepts the durable size limit and preserves the prior snapshot above it", async () => {
    const home = await forgeHome();
    const store = new FileSessionStore(home);
    const created = store.create({ root: "/workspace", cwd: "/workspace" });
    const runId = randomUUID();
    const sizedSnapshot = (targetBytes: number) => {
      const assistantContent = Array.from({ length: 5 }, () => ({
        type: "text" as const,
        text: "",
      }));
      const history = [
        {
          id: `${runId}:user`,
          runId,
          role: "user" as const,
          content: [{ type: "text" as const, text: "size boundary" }],
        },
        {
          id: `${runId}:assistant:1`,
          runId,
          step: 1,
          role: "assistant" as const,
          content: assistantContent,
        },
      ];
      const persisted = {
        schemaVersion: 3 as const,
        id: created.id,
        createdAt: created.createdAt,
        updatedAt: created.updatedAt,
        workspaceRoot: created.workspaceRoot,
        workingDirectory: created.workingDirectory,
        history,
        reasoning: [],
        runIds: [runId],
        historyFidelity: "structured" as const,
        lastRunStatus: "completed" as const,
      };
      const emptyBytes = Buffer.byteLength(
        `${JSON.stringify(persisted, null, 2)}\n`,
        "utf8",
      );
      let remaining = targetBytes - emptyBytes;
      for (const part of assistantContent) {
        const length = Math.min(1_000_000, remaining);
        part.text = "x".repeat(length);
        remaining -= length;
      }
      expect(remaining).toBe(0);
      return { ...created, ...persisted };
    };

    const atLimit = sizedSnapshot(MAX_SESSION_BYTES);
    await expect(store.save(atLimit)).resolves.toBeUndefined();
    await expect(store.load(created.id)).resolves.toEqual(atLimit);

    const aboveLimit = sizedSnapshot(MAX_SESSION_BYTES + 1);
    await expect(store.save(aboveLimit)).rejects.toThrow(
      "previous valid snapshot remains resumable",
    );
    await expect(store.load(created.id)).resolves.toEqual(atLimit);
  });

  it("records failed runs as bounded, authority-free conversation context", async () => {
    const store = new FileSessionStore(await forgeHome());
    const created = store.create({ root: "/workspace", cwd: "/workspace" });
    const saved = recordRunInSession(created, {
      prompt: "Dangerous task",
      finalText: "",
      status: "denied",
      runId: randomUUID(),
    });

    expect(saved.messages[0]).toEqual({
      role: "user",
      content: "Dangerous task",
    });
    expect(saved.messages[1]?.content).toContain("Status: denied");
    expect(saved.messages[1]?.content).toContain("grants no approval");
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
    const originalHistory = snapshot.history;
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
    expect(compacted.history).toBe(originalHistory);
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

  it("migrates a v1 session snapshot to v3 on load", async () => {
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
      schemaVersion: 3,
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
      schemaVersion: 3,
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
  it("validates every cross-cutting scoped decision and update state offline", () => {
    for (const decision of ["allow-once", "allow-session", "deny"] as const) {
      expect(
        runEventSchema.safeParse({
          type: "approval.scope-decision",
          schemaVersion: 1,
          actionId: "action-1",
          decision,
          ...(decision === "allow-session" ? { scopeId: "a".repeat(64) } : {}),
          provenance: "user",
          persisted: false,
        }).success,
      ).toBe(true);
    }
    for (const state of [
      "cached",
      "refreshing",
      "available",
      "current",
      "failed",
      "disabled",
    ] as const) {
      expect(
        runEventSchema.safeParse({
          type: "update.availability",
          schemaVersion: 1,
          state,
          currentVersion: "0.3.2",
          ...(state === "available" ? { latestVersion: "0.3.3" } : {}),
          source: "npm-registry",
        }).success,
      ).toBe(true);
    }
  });
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
      {
        type: "cache.observed",
        schemaVersion: 1,
        step: 1,
        inputTokens: 10,
        cacheReadTokens: 1,
        cacheWriteTokens: 0,
        uncachedInputTokens: 9,
        hitRatio: 0.1,
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
    expect(envelopes.map(({ sequence }) => sequence)).toEqual([
      0, 1, 2, 3, 4, 5,
    ]);
    expect(summarizeTrace(envelopes)).toMatchObject({
      runId,
      sessionId,
      modelSteps: 1,
      toolCalls: 0,
      status: "completed",
      usage: { inputTokens: 10, outputTokens: 4, totalTokens: 14 },
      cache: {
        inputTokens: 10,
        cacheReadTokens: 1,
        cacheWriteTokens: 0,
        uncachedInputTokens: 9,
        hitRatio: 0.1,
      },
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
