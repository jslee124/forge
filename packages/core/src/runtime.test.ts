import { describe, expect, it } from "vitest";
import { z } from "zod";

import type {
  ApprovalPolicy,
  ForgeTool,
  ModelAdapter,
  ModelRequest,
  ModelStreamEvent,
  ToolContext,
} from "./index.js";
import { exitCodeForRunStatus, ReadOnlyPolicy, runAgent } from "./index.js";

const usage = {
  inputTokens: 1,
  outputTokens: 1,
  reasoningTokens: 0,
  cachedInputTokens: 0,
  cacheWriteTokens: 0,
  totalTokens: 2,
};

const toolContext: ToolContext = {
  workspace: { root: "/workspace", cwd: "/workspace" },
  signal: new AbortController().signal,
  limits: { maxOutputBytes: 1024, maxEntries: 20 },
};

class ScriptedModel implements ModelAdapter {
  readonly requests: ModelRequest[] = [];
  #index = 0;

  constructor(
    private readonly steps: readonly (readonly ModelStreamEvent[] | Error)[],
  ) {}

  async *stream(request: ModelRequest): AsyncIterable<ModelStreamEvent> {
    this.requests.push(request);
    const step = this.steps[this.#index];
    this.#index += 1;
    if (!step) {
      throw new Error("Script exhausted.");
    }
    if (step instanceof Error) {
      throw step;
    }
    yield* step;
  }
}

function finish(
  finishReason: "stop" | "tool-calls",
  continuationStep?: number,
): ModelStreamEvent {
  return {
    type: "finish",
    finishReason,
    usage,
    ...(continuationStep
      ? {
          continuation: {
            provider: "fake",
            data: { step: continuationStep },
          },
        }
      : {}),
  };
}

function toolCall(
  id: string,
  path: string,
): Extract<ModelStreamEvent, { readonly type: "tool.call" }> {
  return {
    type: "tool.call",
    call: { id, name: "read_file", input: { path } },
  };
}

function fakeReadTool(executions: string[]): ForgeTool {
  return {
    name: "read_file",
    description: "Read a fake file",
    inputSchema: z.object({ path: z.string() }),
    risk: "read",
    execute: async (input) => {
      const { path } = input as { path: string };
      executions.push(path);
      return {
        ok: true,
        output: { path, content: `content:${path}` },
        truncated: false,
      };
    },
  };
}

describe("native agent runtime", () => {
  it("inspects multiple files and continues with tool results", async () => {
    const model = new ScriptedModel([
      [toolCall("call-1", "a.ts"), finish("tool-calls", 1)],
      [toolCall("call-2", "b.ts"), finish("tool-calls", 2)],
      [{ type: "text.delta", text: "The answer is 42." }, finish("stop")],
    ]);
    const executions: string[] = [];

    const result = await runAgent({
      prompt: "Find the answer",
      model,
      tools: [fakeReadTool(executions)],
      policy: new ReadOnlyPolicy(),
      toolContext,
      signal: toolContext.signal,
    });

    expect(result.status).toBe("completed");
    expect(result.exitCode).toBe(0);
    expect(result.finalText).toBe("The answer is 42.");
    expect(result.modelSteps).toBe(3);
    expect(result.toolCalls).toBe(2);
    expect(executions).toEqual(["a.ts", "b.ts"]);
    expect(model.requests[1]).toMatchObject({
      continuation: { provider: "fake", data: { step: 1 } },
      toolResults: [{ callId: "call-1", toolName: "read_file" }],
    });

    const eventTypes = result.events.map(({ type }) => type);
    expect(eventTypes.indexOf("tool.decision")).toBeLessThan(
      eventTypes.indexOf("tool.started"),
    );
  });

  it("returns recoverable tool failures to the model", async () => {
    const failingTool: ForgeTool = {
      ...fakeReadTool([]),
      execute: async () => ({
        ok: false,
        error: {
          code: "not_found",
          message: "File not found.",
          retryable: false,
        },
      }),
    };
    const model = new ScriptedModel([
      [toolCall("missing", "missing.ts"), finish("tool-calls", 1)],
      [{ type: "text.delta", text: "Recovered." }, finish("stop")],
    ]);

    const result = await runAgent({
      prompt: "Read it",
      model,
      tools: [failingTool],
      policy: new ReadOnlyPolicy(),
      toolContext,
      signal: toolContext.signal,
    });

    expect(result.status).toBe("completed");
    expect(model.requests[1]?.toolResults?.[0]?.result).toMatchObject({
      ok: false,
      error: { code: "not_found" },
    });
  });

  it("stops at model-step and tool-call limits", async () => {
    const modelLimited = new ScriptedModel([
      [toolCall("one", "a.ts"), finish("tool-calls", 1)],
    ]);
    const toolLimited = new ScriptedModel([
      [
        toolCall("one", "a.ts"),
        toolCall("two", "b.ts"),
        finish("tool-calls", 1),
      ],
    ]);
    const executions: string[] = [];
    const base = {
      prompt: "Loop",
      tools: [fakeReadTool(executions)],
      policy: new ReadOnlyPolicy(),
      toolContext,
      signal: toolContext.signal,
    };

    const modelResult = await runAgent({
      ...base,
      model: modelLimited,
      limits: { maxModelSteps: 1 },
    });
    const toolResult = await runAgent({
      ...base,
      model: toolLimited,
      limits: { maxToolCalls: 1 },
    });

    expect(modelResult).toMatchObject({ status: "limit_reached", exitCode: 3 });
    expect(toolResult).toMatchObject({ status: "limit_reached", exitCode: 3 });
    expect(executions).toEqual(["a.ts"]);
  });

  it("does not execute a denied or unapproved action", async () => {
    const executions: string[] = [];
    const model = () =>
      new ScriptedModel([
        [toolCall("call-1", "a.ts"), finish("tool-calls", 1)],
      ]);
    const denyPolicy: ApprovalPolicy = {
      evaluate: async () => ({ kind: "deny", reason: "Denied by test." }),
    };
    const confirmPolicy: ApprovalPolicy = {
      evaluate: async () => ({ kind: "confirm", reason: "Confirm it." }),
    };
    const base = {
      prompt: "Read",
      tools: [fakeReadTool(executions)],
      toolContext,
      signal: toolContext.signal,
    };

    const denied = await runAgent({
      ...base,
      model: model(),
      policy: denyPolicy,
    });
    const noChannel = await runAgent({
      ...base,
      model: model(),
      policy: confirmPolicy,
    });

    expect(denied).toMatchObject({ status: "denied", exitCode: 4 });
    expect(noChannel).toMatchObject({ status: "denied", exitCode: 4 });
    expect(executions).toEqual([]);
    expect(denied.events.some(({ type }) => type === "tool.decision")).toBe(
      true,
    );
  });

  it("executes a confirmed action only after channel approval", async () => {
    const executions: string[] = [];
    const model = new ScriptedModel([
      [toolCall("call-1", "a.ts"), finish("tool-calls", 1)],
      [{ type: "text.delta", text: "Approved." }, finish("stop")],
    ]);
    const result = await runAgent({
      prompt: "Read",
      model,
      tools: [fakeReadTool(executions)],
      policy: {
        evaluate: async () => ({ kind: "confirm", reason: "Confirm it." }),
      },
      approvalChannel: { request: async () => true },
      toolContext,
      signal: toolContext.signal,
    });

    expect(result.status).toBe("completed");
    expect(executions).toEqual(["a.ts"]);
  });

  it("reports failed and cancelled model runs", async () => {
    const failed = await runAgent({
      prompt: "Fail",
      model: new ScriptedModel([new Error("provider unavailable")]),
      tools: [],
      policy: new ReadOnlyPolicy(),
      toolContext,
      signal: toolContext.signal,
    });
    const cancelled = await runAgent({
      prompt: "Cancel",
      model: new ScriptedModel([[{ type: "abort", reason: "SIGINT" }]]),
      tools: [],
      policy: new ReadOnlyPolicy(),
      toolContext,
      signal: toolContext.signal,
    });
    const finishError = await runAgent({
      prompt: "Finish with error",
      model: new ScriptedModel([
        [
          {
            type: "finish",
            finishReason: "error",
            usage,
          },
        ],
      ]),
      tools: [],
      policy: new ReadOnlyPolicy(),
      toolContext,
      signal: toolContext.signal,
    });

    expect(failed).toMatchObject({ status: "failed", exitCode: 1 });
    expect(cancelled).toMatchObject({ status: "cancelled", exitCode: 130 });
    expect(finishError).toMatchObject({ status: "failed", exitCode: 1 });
  });

  it("detects cancellation between tool and model steps", async () => {
    const controller = new AbortController();
    const model = new ScriptedModel([
      [toolCall("call-1", "a.ts"), finish("tool-calls", 1)],
    ]);
    const cancellingTool: ForgeTool = {
      ...fakeReadTool([]),
      execute: async () => {
        controller.abort("test");
        return { ok: true, output: {}, truncated: false };
      },
    };

    const result = await runAgent({
      prompt: "Cancel between steps",
      model,
      tools: [cancellingTool],
      policy: new ReadOnlyPolicy(),
      toolContext: { ...toolContext, signal: controller.signal },
      signal: controller.signal,
    });

    expect(result).toMatchObject({ status: "cancelled", exitCode: 130 });
    expect(model.requests).toHaveLength(1);
  });

  it("maps every terminal status to its documented exit code", () => {
    expect(exitCodeForRunStatus("completed")).toBe(0);
    expect(exitCodeForRunStatus("failed")).toBe(1);
    expect(exitCodeForRunStatus("limit_reached")).toBe(3);
    expect(exitCodeForRunStatus("denied")).toBe(4);
    expect(exitCodeForRunStatus("cancelled")).toBe(130);
  });
});
