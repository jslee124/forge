import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import {
  type CanonicalConversationMessage,
  canonicalText,
  type ForgeTool,
  type ModelAdapter,
  type ModelRequest,
  type ModelStreamEvent,
  projectCanonicalConversation,
  ReadOnlyPolicy,
  runAgent,
  SessionApprovalStore,
  type ToolContext,
} from "@forge/core";
import {
  createForgeSummaryCheckpoint,
  FileSessionStore,
  isCheckpointValid,
  MAX_SESSION_BYTES,
  recordRunInSession,
  type SessionSnapshot,
} from "@forge/persistence";
import { afterEach, describe, expect, it } from "vitest";
import { z } from "zod";

const temporaryDirectories: string[] = [];
const usage = {
  inputTokens: 4,
  outputTokens: 2,
  reasoningTokens: 0,
  cachedInputTokens: 0,
  cacheWriteTokens: 0,
  totalTokens: 6,
};

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe("structured session cross-layer release contract", () => {
  it("round-trips repeated provider call IDs through runtime, persistence, and projection", async () => {
    const home = await temporaryDirectory();
    const store = new FileSessionStore(home);
    let snapshot = store.create({ root: home, cwd: home });

    for (const [prompt, file] of [
      ["Inspect a", "a.ts"],
      ["Inspect b", "b.ts"],
    ] as const) {
      const controller = new AbortController();
      const result = await runAgent({
        runId: randomUUID(),
        prompt,
        conversation: snapshot.history,
        model: new ToolThenAnswerModel(file),
        tools: [readTool()],
        policy: new ReadOnlyPolicy(),
        toolContext: toolContext(home, controller.signal),
        signal: controller.signal,
      });
      expect(result.status).toBe("completed");
      const canonicalDelta = result.canonicalDelta;
      if (!canonicalDelta)
        throw new Error("Runtime did not return canonical history.");
      const runId = canonicalDelta[0]?.runId;
      if (!runId) throw new Error("Runtime did not return a canonical run ID.");
      snapshot = recordRunInSession(snapshot, {
        prompt,
        finalText: result.finalText,
        status: result.status,
        runId,
        events: result.events,
        canonicalDelta,
      });
      await store.save(snapshot);
      snapshot = await store.load(snapshot.id);
    }

    const checkpointed = createForgeSummaryCheckpoint(snapshot, {
      provider: "fake",
      modelId: "fake-session-contract",
      recentTailTokens: 1,
      summaryTargetTokens: 200,
      now: "2026-08-30T00:00:00.000Z",
    });
    const activeApprovals = new SessionApprovalStore({
      workspaceRoot: home,
      sessionId: checkpointed.id,
    });
    activeApprovals.grant({ kind: "workspace-write", workspaceRoot: home });
    expect(activeApprovals.list()).toHaveLength(1);
    await store.save(checkpointed);
    const resumed = await store.load(checkpointed.id);
    const projected = projectCanonicalConversation(
      resumed.history,
    ) as readonly {
      readonly role?: unknown;
    }[];
    const toolMessages = resumed.history.filter(isCanonicalToolMessage);

    expect(isCheckpointValid(resumed)).toBe(true);
    expect(toolMessages).toHaveLength(2);
    expect(projected.filter(({ role }) => role === "tool")).toHaveLength(2);
    expect(
      toolMessages.every(({ toolCallId }) => toolCallId === "call-1"),
    ).toBe(true);

    expect(
      new SessionApprovalStore({
        workspaceRoot: home,
        sessionId: resumed.id,
      }).list(),
    ).toEqual([]);
    expect(JSON.stringify(resumed)).not.toContain("approvalStore");
  });

  it("persists cancellation after a completed tool without fabricating protocol history", async () => {
    const home = await temporaryDirectory();
    const store = new FileSessionStore(home);
    const created = store.create({ root: home, cwd: home });
    const controller = new AbortController();
    const cancellingTool: ForgeTool = {
      ...readTool(),
      execute: async () => {
        controller.abort("contract fixture");
        return { ok: true, output: { touched: true }, truncated: false };
      },
    };
    const result = await runAgent({
      runId: randomUUID(),
      prompt: "Inspect before cancellation",
      model: new ToolOnlyModel(),
      tools: [cancellingTool],
      policy: new ReadOnlyPolicy(),
      toolContext: toolContext(home, controller.signal),
      signal: controller.signal,
    });
    const runId = result.canonicalDelta?.[0]?.runId;
    if (!runId) throw new Error("Runtime did not return a canonical run ID.");
    const saved = recordRunInSession(created, {
      prompt: "Inspect before cancellation",
      finalText: result.finalText,
      status: result.status,
      runId,
      events: result.events,
      canonicalDelta: result.canonicalDelta,
    });
    await store.save(saved);
    const resumed = await store.load(saved.id);
    const outcome = resumed.history.find(({ role }) => role === "assistant");

    expect(result.status).toBe("cancelled");
    expect(resumed.history.some(({ role }) => role === "tool")).toBe(false);
    expect(JSON.stringify(resumed.history)).not.toContain('"type":"tool-call"');
    expect(outcome ? canonicalText(outcome) : "").toContain(
      "were not returned to the model: read_file",
    );
    expect(outcome ? canonicalText(outcome) : "").toContain(
      "Re-inspect relevant",
    );
    expect(() => projectCanonicalConversation(resumed.history)).not.toThrow();
  });

  it("keeps the last resumable runtime snapshot when a later save exceeds the durable limit", async () => {
    const home = await temporaryDirectory();
    const store = new FileSessionStore(home);
    const controller = new AbortController();
    const created = store.create({ root: home, cwd: home });
    const result = await runAgent({
      runId: randomUUID(),
      prompt: "Keep this resumable",
      model: new AnswerOnlyModel(),
      tools: [],
      policy: new ReadOnlyPolicy(),
      toolContext: toolContext(home, controller.signal),
      signal: controller.signal,
    });
    const runId = result.canonicalDelta?.[0]?.runId;
    if (!runId) throw new Error("Runtime did not return a canonical run ID.");
    const saved = recordRunInSession(created, {
      prompt: "Keep this resumable",
      finalText: result.finalText,
      status: result.status,
      runId,
      events: result.events,
      canonicalDelta: result.canonicalDelta,
    });
    await store.save(saved);

    const oversized: SessionSnapshot = {
      ...saved,
      history: [
        ...saved.history,
        {
          id: `${runId}:oversized`,
          runId,
          step: 99,
          role: "assistant",
          content: Array.from({ length: 5 }, () => ({
            type: "text" as const,
            text: "x".repeat(Math.ceil(MAX_SESSION_BYTES / 5)),
          })),
        },
      ],
    };
    await expect(store.save(oversized)).rejects.toThrow(
      "previous valid snapshot remains resumable",
    );
    await expect(store.load(saved.id)).resolves.toEqual(saved);
  });
});

class ToolThenAnswerModel implements ModelAdapter {
  readonly requests: ModelRequest[] = [];
  #step = 0;

  constructor(private readonly file: string) {}

  async *stream(request: ModelRequest): AsyncIterable<ModelStreamEvent> {
    this.requests.push(request);
    this.#step += 1;
    if (this.#step === 1) {
      yield {
        type: "tool.call",
        call: { id: "call-1", name: "read_file", input: { path: this.file } },
      };
      yield {
        type: "finish",
        finishReason: "tool-calls",
        usage,
        continuation: { provider: "fake", data: { file: this.file } },
      };
      return;
    }
    yield { type: "text.delta", text: `inspected ${this.file}` };
    yield { type: "finish", finishReason: "stop", usage };
  }
}

class ToolOnlyModel implements ModelAdapter {
  async *stream(): AsyncIterable<ModelStreamEvent> {
    yield {
      type: "tool.call",
      call: { id: "call-1", name: "read_file", input: { path: "a.ts" } },
    };
    yield {
      type: "finish",
      finishReason: "tool-calls",
      usage,
      continuation: { provider: "fake", data: { step: 1 } },
    };
  }
}

class AnswerOnlyModel implements ModelAdapter {
  async *stream(): AsyncIterable<ModelStreamEvent> {
    yield { type: "text.delta", text: "resumable answer" };
    yield { type: "finish", finishReason: "stop", usage };
  }
}

function readTool(): ForgeTool {
  return {
    name: "read_file",
    description: "Read a deterministic fixture",
    inputSchema: z.object({ path: z.string() }),
    risk: "read",
    execute: async (input) => ({
      ok: true,
      output: { path: (input as { readonly path: string }).path },
      truncated: false,
    }),
  };
}

function toolContext(root: string, signal: AbortSignal): ToolContext {
  return {
    workspace: { root, cwd: root },
    signal,
    limits: { maxOutputBytes: 4_096, maxEntries: 100 },
  };
}

function isCanonicalToolMessage(
  message: CanonicalConversationMessage,
): message is Extract<CanonicalConversationMessage, { readonly role: "tool" }> {
  return message.role === "tool";
}

async function temporaryDirectory(): Promise<string> {
  const directory = await mkdtemp(path.join(tmpdir(), "forge-session-gate-"));
  temporaryDirectories.push(directory);
  return directory;
}
