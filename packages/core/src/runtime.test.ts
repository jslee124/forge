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
import {
  exitCodeForRunStatus,
  ReadOnlyPolicy,
  runAgent,
  runConversationMessages,
  SessionApprovalStore,
  WorkspaceWritePolicy,
} from "./index.js";

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
  it("keeps unavailable cache telemetry distinct from provider-reported zero", async () => {
    const unavailable = new ScriptedModel([
      [
        {
          type: "finish",
          finishReason: "stop",
          usage: {
            inputTokens: undefined,
            outputTokens: 1,
            reasoningTokens: undefined,
            cachedInputTokens: undefined,
            cacheWriteTokens: undefined,
            totalTokens: 1,
          },
        },
      ],
    ]);
    const result = await runAgent({
      prompt: "cache",
      model: unavailable,
      tools: [],
      policy: new ReadOnlyPolicy(),
      toolContext,
      signal: toolContext.signal,
    });
    expect(result.events).toContainEqual({
      type: "cache.observed",
      schemaVersion: 1,
      step: 1,
    });

    const zero = await runAgent({
      prompt: "cache",
      model: new ScriptedModel([[finish("stop")]]),
      tools: [],
      policy: new ReadOnlyPolicy(),
      toolContext,
      signal: toolContext.signal,
    });
    expect(zero.events).toContainEqual(
      expect.objectContaining({
        type: "cache.observed",
        inputTokens: 1,
        cacheReadTokens: 0,
        uncachedInputTokens: 1,
        hitRatio: 0,
      }),
    );
  });

  it("emits a preflight and stops mandatory overflow before a provider call", async () => {
    let calls = 0;
    const model: ModelAdapter = {
      context: {
        provider: "fake",
        modelId: "tiny",
        contextWindowTokens: 100,
        contextWindowSource: "adapter-table",
        maxOutputTokens: 20,
        nativeCompaction: "unsupported",
        continuationProjection: "unsupported",
        estimateRequestTokens: async () => ({
          tokens: 500,
          method: "sdk",
          confidence: "exact",
        }),
      },
      stream: async function* () {
        calls += 1;
        yield finish("stop");
      },
    };
    const result = await runAgent({
      prompt: "x".repeat(500),
      instructions: "y".repeat(500),
      model,
      tools: [],
      policy: new ReadOnlyPolicy(),
      toolContext,
      signal: toolContext.signal,
      contextConfiguration: {
        mode: "manual",
        reservedOutputTokens: 20,
        bufferTokens: 20,
        recentTailTokens: 10,
        summaryTargetTokens: 10,
      },
    });

    expect(result.status).toBe("limit_reached");
    expect(calls).toBe(0);
    expect(result.events.map(({ type }) => type)).toContain(
      "context.limit_reached",
    );
  });

  it("recovers one clean overflow without replaying a completed tool action", async () => {
    const executions: string[] = [];
    let requestIndex = 0;
    const requests: ModelRequest[] = [];
    const model: ModelAdapter = {
      context: {
        provider: "fake",
        modelId: "fake",
        contextWindowTokens: 10_000,
        contextWindowSource: "adapter-table",
        nativeCompaction: "unsupported",
        continuationProjection: "adapter-owned",
        estimateRequestTokens: async () => ({
          tokens: 100,
          method: "sdk",
          confidence: "exact",
        }),
        isContextOverflow: (error) =>
          error instanceof Error && error.message === "context length exceeded",
        projectContinuation: async (continuation) => ({
          provider: continuation.provider,
          data: { projected: true },
        }),
      },
      stream: async function* (request) {
        requests.push(request);
        const current = requestIndex;
        requestIndex += 1;
        if (current === 0) {
          yield toolCall("once", "a.ts");
          yield {
            ...finish("tool-calls"),
            continuation: {
              provider: "fake",
              data: { largeCompletedToolResult: "x".repeat(1_000) },
            },
          };
          return;
        }
        if (current === 1) throw new Error("context length exceeded");
        yield { type: "text.delta", text: "Recovered once." };
        yield finish("stop");
      },
    };
    const result = await runAgent({
      prompt: "read once",
      model,
      tools: [fakeReadTool(executions)],
      policy: new ReadOnlyPolicy(),
      toolContext,
      signal: toolContext.signal,
    });

    expect(result.status).toBe("completed");
    expect(executions).toEqual(["a.ts"]);
    expect(requests).toHaveLength(3);
    expect(requests[2]?.continuation?.data).toEqual({ projected: true });
  });

  it("compacts at projected pressure before a hard overflow", async () => {
    const requests: ModelRequest[] = [];
    let step = 0;
    const model: ModelAdapter = {
      promptCache: { mode: "unsupported" },
      context: {
        provider: "fake",
        modelId: "pressure",
        contextWindowTokens: 12_000,
        contextWindowSource: "adapter-table",
        maxOutputTokens: 2_000,
        nativeCompaction: "unsupported",
        continuationProjection: "adapter-owned",
        estimateRequestTokens: async (request) => ({
          tokens:
            request.continuation &&
            (request.continuation.data as { projected?: boolean }).projected
              ? 3_000
              : request.continuation
                ? 9_000
                : 1_000,
          method: "sdk",
          confidence: "exact",
        }),
        projectContinuation: async (continuation) => ({
          provider: continuation.provider,
          data: { projected: true },
        }),
      },
      stream: async function* (request) {
        requests.push(request);
        step += 1;
        if (step === 1) {
          yield toolCall("pressure-tool", "a.ts");
          yield {
            ...finish("tool-calls"),
            continuation: { provider: "fake", data: { projected: false } },
          };
          return;
        }
        yield { type: "text.delta", text: "Compacted before overflow." };
        yield finish("stop");
      },
    };
    const result = await runAgent({
      prompt: "pressure",
      model,
      tools: [fakeReadTool([])],
      policy: new ReadOnlyPolicy(),
      toolContext,
      signal: toolContext.signal,
      contextPressureMode: "automatic-session",
      contextConfiguration: {
        mode: "automatic",
        reservedOutputTokens: 2_000,
        bufferTokens: 1_000,
        recentTailTokens: 1_000,
        summaryTargetTokens: 500,
        activationThreshold: 0.78,
        minimumReclaimTokens: 100,
        minimumReclaimRatio: 0.2,
      },
    });
    expect(result.status).toBe("completed");
    expect(requests[1]?.continuation?.data).toEqual({ projected: true });
    expect(result.events).toContainEqual(
      expect.objectContaining({
        type: "context.compaction.completed",
        estimatedBeforeTokens: 9_000,
        estimatedAfterTokens: 3_000,
      }),
    );
  });

  it("does not retry an overflow after partial assistant output", async () => {
    let requestIndex = 0;
    let projections = 0;
    const model: ModelAdapter = {
      context: {
        provider: "fake",
        modelId: "fake",
        contextWindowTokens: 10_000,
        contextWindowSource: "adapter-table",
        nativeCompaction: "unsupported",
        continuationProjection: "adapter-owned",
        estimateRequestTokens: async () => ({
          tokens: 100,
          method: "sdk",
          confidence: "exact",
        }),
        isContextOverflow: () => true,
        projectContinuation: async (continuation) => {
          projections += 1;
          return continuation;
        },
      },
      stream: async function* () {
        const current = requestIndex;
        requestIndex += 1;
        if (current === 0) {
          yield toolCall("once", "a.ts");
          yield {
            ...finish("tool-calls"),
            continuation: { provider: "fake", data: { step: 1 } },
          };
          return;
        }
        yield { type: "text.delta", text: "partial" };
        throw new Error("context length exceeded");
      },
    };
    const result = await runAgent({
      prompt: "read",
      model,
      tools: [fakeReadTool([])],
      policy: new ReadOnlyPolicy(),
      toolContext,
      signal: toolContext.signal,
    });

    expect(result.status).toBe("failed");
    expect(requestIndex).toBe(2);
    expect(projections).toBe(0);
  });

  it("inspects multiple files and continues with tool results", async () => {
    const model = new ScriptedModel([
      [toolCall("call-1", "a.ts"), finish("tool-calls", 1)],
      [toolCall("call-2", "b.ts"), finish("tool-calls", 2)],
      [{ type: "text.delta", text: "The answer is 42." }, finish("stop")],
    ]);
    const executions: string[] = [];

    const result = await runAgent({
      runId: "run-structured",
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
    expect(result.canonicalDelta).toEqual([
      expect.objectContaining({
        id: "run-structured:user",
        role: "user",
      }),
      expect.objectContaining({
        id: "run-structured:assistant:1",
        role: "assistant",
        content: [
          expect.objectContaining({
            type: "tool-call",
            id: "call-1",
            name: "read_file",
          }),
        ],
      }),
      expect.objectContaining({
        id: "run-structured:tool:1:0",
        role: "tool",
        toolCallId: "call-1",
        isError: false,
      }),
      expect.objectContaining({
        id: "run-structured:assistant:2",
        role: "assistant",
      }),
      expect.objectContaining({
        id: "run-structured:tool:2:0",
        role: "tool",
        toolCallId: "call-2",
        isError: false,
      }),
      expect.objectContaining({
        id: "run-structured:assistant:3",
        role: "assistant",
        content: [{ type: "text", text: "The answer is 42." }],
      }),
    ]);

    const eventTypes = result.events.map(({ type }) => type);
    expect(eventTypes.indexOf("tool.decision")).toBeLessThan(
      eventTypes.indexOf("tool.started"),
    );
  });

  it("reports reasoning tokens when the provider returns no reasoning text", async () => {
    const hiddenReasoningUsage = {
      ...usage,
      outputTokens: 13,
      reasoningTokens: 12,
      totalTokens: 14,
    };
    const model = new ScriptedModel([
      [
        { type: "text.delta", text: "Final answer." },
        {
          type: "finish",
          finishReason: "stop",
          usage: hiddenReasoningUsage,
        },
      ],
    ]);

    const result = await runAgent({
      prompt: "Think",
      model,
      tools: [],
      policy: new ReadOnlyPolicy(),
      toolContext,
      signal: toolContext.signal,
    });

    expect(result.events).toContainEqual({
      type: "model.reasoning-unavailable",
      step: 1,
      reasoningTokens: 12,
    });
    expect(result.events.some(({ type }) => type === "model.reasoning")).toBe(
      false,
    );
  });

  it("does not report reasoning as unavailable when text was returned", async () => {
    const model = new ScriptedModel([
      [
        { type: "reasoning.delta", text: "Visible reasoning." },
        { type: "text.delta", text: "Final answer." },
        {
          type: "finish",
          finishReason: "stop",
          usage: { ...usage, reasoningTokens: 2, totalTokens: 4 },
        },
      ],
    ]);

    const result = await runAgent({
      prompt: "Think",
      model,
      tools: [],
      policy: new ReadOnlyPolicy(),
      toolContext,
      signal: toolContext.signal,
    });

    expect(
      result.events.some(({ type }) => type === "model.reasoning-unavailable"),
    ).toBe(false);
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

  it("returns policy denial to the model without executing the action", async () => {
    const executions: string[] = [];
    const deniedModel = new ScriptedModel([
      [toolCall("call-1", "a.ts"), finish("tool-calls", 1)],
      [
        { type: "text.delta", text: "I will use another approach." },
        finish("stop"),
      ],
    ]);
    const oneStepModel = () =>
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
      model: deniedModel,
      policy: denyPolicy,
    });
    const noChannel = await runAgent({
      ...base,
      model: oneStepModel(),
      policy: confirmPolicy,
    });

    expect(denied).toMatchObject({ status: "completed", exitCode: 0 });
    expect(noChannel).toMatchObject({ status: "denied", exitCode: 4 });
    expect(executions).toEqual([]);
    expect(denied.events.some(({ type }) => type === "tool.decision")).toBe(
      true,
    );
    expect(deniedModel.requests[1]?.toolResults?.[0]?.result).toMatchObject({
      ok: false,
      error: { code: "approval_denied", retryable: false },
    });
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

  it("reuses an explicit workspace-write grant in the active session only", async () => {
    const executions: string[] = [];
    const patchTool: ForgeTool = {
      name: "apply_patch",
      description: "Patch a fake file",
      inputSchema: z.object({ path: z.string() }),
      risk: "write",
      execute: async (input) => {
        executions.push((input as { path: string }).path);
        return { ok: true, output: {}, truncated: false };
      },
    };
    const patchCall = (id: string, path: string): ModelStreamEvent => ({
      type: "tool.call",
      call: { id, name: "apply_patch", input: { path } },
    });
    const model = new ScriptedModel([
      [patchCall("patch-1", "a.ts"), finish("tool-calls", 1)],
      [patchCall("patch-2", "b.ts"), finish("tool-calls", 2)],
      [{ type: "text.delta", text: "Patched." }, finish("stop")],
    ]);
    let approvals = 0;
    const approvalStore = new SessionApprovalStore({
      workspaceRoot: "/workspace",
      sessionId: "active",
    });

    const result = await runAgent({
      prompt: "Patch twice",
      model,
      tools: [patchTool],
      policy: new WorkspaceWritePolicy(),
      approvalChannel: {
        request: async () => {
          approvals += 1;
          return true;
        },
        requestStructured: async () => {
          approvals += 1;
          return { kind: "allow-session" };
        },
      },
      approvalStore,
      toolContext,
      signal: toolContext.signal,
    });

    expect(result.status).toBe("completed");
    expect(approvals).toBe(1);
    expect(executions).toEqual(["a.ts", "b.ts"]);
    expect(
      result.events
        .filter(({ type }) => type === "tool.decision")
        .map((event) =>
          event.type === "tool.decision" ? event.decision.kind : "",
        ),
    ).toEqual(["confirm", "confirm"]);
    expect(
      result.events
        .filter(({ type }) => type === "approval.scope-decision")
        .map((event) =>
          event.type === "approval.scope-decision" ? event.provenance : "",
        ),
    ).toEqual(["user", "policy"]);
    expect(
      await new WorkspaceWritePolicy().evaluate(
        {
          call: { id: "new-run", name: "apply_patch", input: {} },
          tool: patchTool,
          input: {},
        },
        toolContext.signal,
      ),
    ).toMatchObject({ kind: "confirm" });
  });

  it("does not widen patch scope when the approved patch fails", async () => {
    let executions = 0;
    const patchTool: ForgeTool = {
      name: "apply_patch",
      description: "Patch a fake file",
      inputSchema: z.object({ path: z.string() }),
      risk: "write",
      execute: async () => {
        executions += 1;
        return executions === 1
          ? {
              ok: false,
              error: {
                code: "stale_patch",
                message: "Changed.",
                retryable: true,
              },
            }
          : { ok: true, output: {}, truncated: false };
      },
    };
    const call = (id: string): ModelStreamEvent => ({
      type: "tool.call",
      call: { id, name: "apply_patch", input: { path: "a.ts" } },
    });
    const model = new ScriptedModel([
      [call("failed"), finish("tool-calls", 1)],
      [call("retry"), finish("tool-calls", 2)],
      [{ type: "text.delta", text: "Done." }, finish("stop")],
    ]);
    let approvals = 0;

    const result = await runAgent({
      prompt: "Retry a patch",
      model,
      tools: [patchTool],
      policy: new WorkspaceWritePolicy(),
      approvalChannel: {
        request: async () => {
          approvals += 1;
          return true;
        },
      },
      toolContext,
      signal: toolContext.signal,
    });

    expect(result.status).toBe("completed");
    expect(approvals).toBe(2);
  });

  it("returns bounded denial feedback to the active tool loop without approving", async () => {
    const executions: string[] = [];
    const model = new ScriptedModel([
      [toolCall("denied-call", "secret.ts"), finish("tool-calls", 1)],
      [{ type: "text.delta", text: "Understood." }, finish("stop")],
    ]);
    const result = await runAgent({
      prompt: "Read",
      model,
      tools: [fakeReadTool(executions)],
      policy: {
        evaluate: async () => ({ kind: "confirm", reason: "Confirm it." }),
      },
      approvalChannel: {
        request: async () => false,
        requestStructured: async () => ({
          kind: "deny",
          feedback: "Use the public fixture instead.",
        }),
      },
      toolContext,
      signal: toolContext.signal,
    });

    expect(result.status).toBe("completed");
    expect(executions).toEqual([]);
    expect(model.requests[1]?.toolResults?.[0]?.result).toMatchObject({
      ok: false,
      error: {
        code: "approval_denied",
        message: "The user denied this action: Use the public fixture instead.",
      },
    });
  });

  it("returns a denial without feedback and does not re-prompt unchanged calls", async () => {
    const executions: string[] = [];
    const repeated = toolCall("denied-again", "secret.ts");
    const model = new ScriptedModel([
      [toolCall("denied-once", "secret.ts"), finish("tool-calls", 1)],
      [repeated, finish("tool-calls", 2)],
      [
        { type: "text.delta", text: "I cannot perform that action." },
        finish("stop"),
      ],
    ]);
    let approvalRequests = 0;
    const result = await runAgent({
      prompt: "Read",
      model,
      tools: [fakeReadTool(executions)],
      policy: {
        evaluate: async () => ({ kind: "confirm", reason: "Confirm it." }),
      },
      approvalChannel: {
        request: async () => false,
        requestStructured: async () => {
          approvalRequests += 1;
          return { kind: "deny" };
        },
      },
      toolContext,
      signal: toolContext.signal,
    });

    expect(result.status).toBe("completed");
    expect(approvalRequests).toBe(1);
    expect(executions).toEqual([]);
    expect(model.requests[1]?.toolResults?.[0]?.result).toMatchObject({
      ok: false,
      error: { code: "approval_denied", retryable: false },
    });
    expect(model.requests[2]?.toolResults?.[0]?.result).toMatchObject({
      ok: false,
      error: { code: "approval_denied", retryable: false },
    });
  });

  it("returns approval preflight failures to the active model loop", async () => {
    const executions: string[] = [];
    const model = new ScriptedModel([
      [toolCall("create-existing", "existing.ts"), finish("tool-calls", 1)],
      [
        {
          type: "text.delta",
          text: "I will modify the existing file instead.",
        },
        finish("stop"),
      ],
    ]);
    const result = await runAgent({
      prompt: "Update existing.ts",
      model,
      tools: [fakeReadTool(executions)],
      policy: {
        evaluate: async () => ({ kind: "confirm", reason: "Confirm it." }),
      },
      approvalChannel: {
        request: async () => false,
        requestStructured: async () => ({
          kind: "preflight-failed",
          result: {
            ok: false,
            error: {
              code: "already_exists",
              message: "The requested path already exists; use apply_patch.",
              retryable: true,
            },
          },
        }),
      },
      toolContext,
      signal: toolContext.signal,
    });

    expect(result.status).toBe("completed");
    expect(executions).toEqual([]);
    expect(model.requests[1]?.toolResults?.[0]?.result).toMatchObject({
      ok: false,
      error: { code: "already_exists", retryable: true },
    });
  });

  it("summarizes partial side effects for the next conversation turn", () => {
    const messages = runConversationMessages("Delete old and restyle", {
      status: "denied",
      finalText: "Started the update.",
      message: "A later action was denied.",
      events: [
        {
          type: "tool.completed",
          step: 1,
          call: {
            id: "remove-old",
            name: "run_command",
            input: { program: "rm", args: ["old.html"] },
          },
          result: { ok: true, output: {}, truncated: false },
        },
        {
          type: "tool.failed",
          step: 2,
          call: {
            id: "create-existing",
            name: "create_file",
            input: { path: "style.css", content: "secret body omitted" },
          },
          result: {
            ok: false,
            error: {
              code: "already_exists",
              message: "Use apply_patch instead.",
              retryable: true,
            },
          },
        },
      ],
    });

    expect(messages[0]).toEqual({
      role: "user",
      content: "Delete old and restyle",
    });
    expect(messages[1]?.content).toContain(
      "Completed tools: run_command (program rm)",
    );
    expect(messages[1]?.content).toContain(
      "create_file (style.css) [already_exists]",
    );
    expect(messages[1]?.content).not.toContain("secret body omitted");
    expect(messages[1]?.content).toContain("grants no approval");

    const recovered = runConversationMessages("Use a safer alternative", {
      status: "completed",
      finalText: "I used apply_patch instead.",
      events: [
        {
          type: "tool.failed",
          step: 1,
          call: {
            id: "create-existing-again",
            name: "create_file",
            input: { path: "style.css", content: "still omitted" },
          },
          result: {
            ok: false,
            error: {
              code: "already_exists",
              message: "sensitive provider detail",
              retryable: true,
            },
          },
        },
      ],
    });
    expect(recovered[1]?.content).toContain("I used apply_patch instead.");
    expect(recovered[1]?.content).toContain("[already_exists]");
    expect(recovered[1]?.content).not.toContain("sensitive provider detail");
    expect(recovered[1]?.content).not.toContain("still omitted");
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
    expect(result.canonicalDelta).toHaveLength(2);
    expect(result.canonicalDelta?.[1]).toMatchObject({
      role: "assistant",
      content: [
        {
          type: "text",
          text: expect.stringContaining(
            "were not returned to the model: read_file",
          ),
        },
      ],
    });
    expect(result.canonicalDelta?.[1]).toEqual(
      expect.objectContaining({
        content: [
          expect.objectContaining({
            text: expect.stringContaining("Re-inspect relevant"),
          }),
        ],
      }),
    );
    expect(JSON.stringify(result.canonicalDelta)).not.toContain(
      '"type":"tool-call"',
    );
  });

  it("forwards images without exposing their bytes in run events", async () => {
    const model = new ScriptedModel([[finish("stop")]]);
    const images = [
      {
        type: "base64" as const,
        mediaType: "image/png" as const,
        data: "sensitive-base64-pixels",
      },
    ];

    const result = await runAgent({
      prompt: "Inspect this image",
      images,
      model,
      tools: [],
      policy: new ReadOnlyPolicy(),
      toolContext,
      signal: toolContext.signal,
    });

    expect(model.requests[0]?.images).toEqual(images);
    expect(result.events[0]).toEqual({
      type: "run.started",
      prompt: "Inspect this image",
      imageCount: 1,
    });
    expect(JSON.stringify(result.events)).not.toContain(
      "sensitive-base64-pixels",
    );
  });

  it("maps every terminal status to its documented exit code", () => {
    expect(exitCodeForRunStatus("completed")).toBe(0);
    expect(exitCodeForRunStatus("failed")).toBe(1);
    expect(exitCodeForRunStatus("limit_reached")).toBe(3);
    expect(exitCodeForRunStatus("denied")).toBe(4);
    expect(exitCodeForRunStatus("cancelled")).toBe(130);
  });
});
