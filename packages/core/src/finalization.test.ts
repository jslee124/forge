import { describe, expect, it } from "vitest";
import { z } from "zod";
import type { ModelAdapter, ModelRequest, ModelStreamEvent } from "./model.js";
import { validateCanonicalConversation } from "./model.js";
import { ReadOnlyPolicy } from "./policy.js";
import { type RunAgentOptions, runAgent } from "./runtime.js";

const usage = {
  inputTokens: 1,
  outputTokens: 1,
  reasoningTokens: 0,
  cachedInputTokens: 0,
  cacheWriteTokens: 0,
  totalTokens: 2,
};
const finish = (calls = false): ModelStreamEvent => ({
  type: "finish",
  finishReason: calls ? "tool-calls" : "stop",
  usage,
  ...(calls
    ? { continuation: { provider: "fake", data: { messages: "opaque" } } }
    : {}),
});
function call(id: string): ModelStreamEvent {
  return {
    type: "tool.call",
    call: { id, name: "read_file", input: { path: "note" } },
  };
}
function fixture(
  respond?: (
    request: ModelRequest,
    step: number,
  ) => readonly ModelStreamEvent[] | Error,
) {
  const requests: ModelRequest[] = [];
  let effects = 0;
  const model: ModelAdapter = {
    supportsToolChoiceNone: true,
    async *stream(request) {
      requests.push(request);
      const next =
        respond?.(request, requests.length) ??
        (request.toolChoice === "none"
          ? [
              {
                type: "text.delta",
                text: "Partial answer based on the observed read.",
              },
              finish(),
            ]
          : [call(`read-${requests.length}`), finish(true)]);
      if (next instanceof Error) throw next;
      yield* next;
    },
  };
  const options: RunAgentOptions = {
    runId: "test-run",
    prompt: "Inspect and explain",
    completionPolicy: "reserve-final-step",
    model,
    tools: [
      {
        name: "read_file",
        description: "Fixture read",
        risk: "read",
        inputSchema: z.object({ path: z.string() }),
        execute: async () => {
          effects++;
          return {
            ok: true,
            output: { content: "observed evidence" },
            truncated: false,
          };
        },
      },
    ],
    policy: new ReadOnlyPolicy(),
    signal: new AbortController().signal,
    toolContext: {
      workspace: { root: "/workspace", cwd: "/workspace" },
      signal: new AbortController().signal,
      limits: { maxOutputBytes: 1000, maxEntries: 100 },
    },
  };
  return { options, requests, effects: () => effects };
}
describe("reserved final model step", () => {
  it.each(["direct", "reserve-final-step"] as const)(
    "allows a progressing %s task beyond both old default ceilings",
    async (completionPolicy) => {
      const f = fixture((request, step) =>
        request.toolChoice === "none" || step > 45
          ? [{ type: "text.delta", text: "Task complete" }, finish()]
          : [call(`read-${step}`), finish(true)],
      );
      let version = 0;
      const tool = f.options.tools[0];
      if (!tool) throw new Error("Fixture tool missing");
      const result = await runAgent({
        ...f.options,
        completionPolicy,
        tools: [
          {
            ...tool,
            execute: async () => ({
              ok: true,
              output: {
                content: "new evidence",
                resourceVersion: String(++version),
              },
              truncated: false,
            }),
          },
        ],
      });
      expect(result).toMatchObject({
        status: "completed",
        modelSteps: 46,
        toolCalls: 45,
      });
      expect(f.requests).toHaveLength(46);
      expect(JSON.stringify(result)).not.toContain("Infinity");
      expect(
        f.requests.every(
          (request) => !request.instructions?.includes("null model"),
        ),
      ).toBe(true);
    },
  );
  it.each(["direct", "reserve-final-step"] as const)(
    "stops repeated invalid actions without a configured %s total cap",
    async (completionPolicy) => {
      const f = fixture((request, step) =>
        request.toolChoice === "none"
          ? [{ type: "text.delta", text: "Invalid action stopped" }, finish()]
          : [
              {
                type: "tool.call",
                call: { id: String(step), name: "nonexistent", input: {} },
              },
              finish(true),
            ],
      );
      const result = await runAgent({ ...f.options, completionPolicy });
      expect(result).toMatchObject({
        status: "limit_reached",
        partial: true,
        limitReason: "no_progress",
      });
      expect(f.requests).toHaveLength(completionPolicy === "direct" ? 3 : 4);
      expect(f.effects()).toBe(0);
    },
  );
  it("honors cancellation in an unlimited fast-adapter loop", async () => {
    const f = fixture();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 10);
    try {
      const result = await runAgent({
        ...f.options,
        signal: controller.signal,
      });
      expect(result.status).toBe("cancelled");
    } finally {
      clearTimeout(timer);
    }
  });
  it("warns about the model-step boundary even while the tool-call budget is plentiful", async () => {
    const f = fixture();
    const result = await runAgent({
      ...f.options,
      limits: { maxModelSteps: 6, maxToolCalls: 1000 },
    });
    expect(result).toMatchObject({
      modelSteps: 6,
      toolCalls: 5,
      limitReason: "model_step_limit",
      partial: true,
    });
    expect(f.requests[0]?.instructions).not.toContain(
      "Model-response allowance is nearly exhausted",
    );
    expect(f.requests[1]?.instructions).not.toContain(
      "Model-response allowance is nearly exhausted",
    );
    for (const request of f.requests.slice(2, 5)) {
      expect(request.instructions).toContain(
        "at most three tool-capable model responses remain",
      );
      expect(request.instructions).toContain(
        "Do not skip necessary verification",
      );
      expect(request.instructions).not.toContain(
        "Investigation allowance is nearly exhausted",
      );
    }
    expect(f.requests[2]?.instructions).toBe(f.requests[3]?.instructions);
    expect(f.requests[3]?.instructions).toBe(f.requests[4]?.instructions);
    expect(f.requests[5]).toMatchObject({ toolChoice: "none" });
    expect(f.requests[5]?.instructions).not.toContain(
      "Model-response allowance is nearly exhausted",
    );
    expect(f.effects()).toBe(5);
  });
  it.each([1, 2, 12])(
    "stays inside a %i-step total budget and executes no tools in the final step",
    async (maxModelSteps) => {
      const f = fixture();
      const result = await runAgent({
        ...f.options,
        limits: { maxModelSteps },
      });
      expect(result).toMatchObject({
        status: "limit_reached",
        partial: true,
        limitReason: "model_step_limit",
        modelSteps: maxModelSteps,
        toolCalls: maxModelSteps - 1,
      });
      expect(f.requests).toHaveLength(maxModelSteps);
      expect(f.effects()).toBe(maxModelSteps - 1);
      expect(f.requests.at(-1)).toMatchObject({
        toolChoice: "none",
        responseDirective: expect.stringContaining("Inspect and explain"),
        tools: [{ name: "read_file" }],
      });
      expect(result.finalText).toContain("Partial answer");
      validateCanonicalConversation(result.canonicalDelta ?? []);
      expect(
        (result.canonicalDelta ?? []).filter(
          (message) =>
            message.role === "assistant" &&
            message.content.some(
              (part) =>
                part.type === "text" && part.text.includes("Partial answer"),
            ),
        ),
      ).toHaveLength(1);
    },
  );
  it("keeps the default direct policy unchanged", async () => {
    const f = fixture();
    const { completionPolicy: _, ...direct } = f.options;
    const result = await runAgent({ ...direct, limits: { maxModelSteps: 1 } });
    expect(result.partial).toBeUndefined();
    expect(f.effects()).toBe(1);
    expect(f.requests).toHaveLength(1);
    expect(f.requests[0]?.toolChoice).toBeUndefined();
    expect(f.requests[0]?.responseDirective).toBeUndefined();
    expect(f.requests[0]?.instructions).toBeUndefined();
  });
  it("reports remaining low tool allowance on the next request without splitting or executing oversized batches", async () => {
    const f = fixture((request, step) =>
      request.toolChoice === "none"
        ? [
            {
              type: "text.delta",
              text: "Partial result; the oversized batch was not executed.",
            },
            finish(),
          ]
        : step === 1
          ? [
              call("a"),
              call("b"),
              call("c"),
              call("d"),
              call("e"),
              finish(true),
            ]
          : [call("f"), call("g"), call("h"), call("i"), finish(true)],
    );
    const result = await runAgent({
      ...f.options,
      limits: { maxModelSteps: 6, maxToolCalls: 8 },
    });
    expect(f.requests[0]?.instructions).not.toContain("nearly exhausted");
    expect(f.requests[1]?.instructions).toContain("3 tool calls remain");
    expect(f.requests[1]?.instructions).toContain("refused in full");
    expect(f.requests[2]?.toolChoice).toBe("none");
    expect(f.requests[2]?.toolResults).toHaveLength(4);
    expect(f.effects()).toBe(5);
    expect(result).toMatchObject({
      partial: true,
      modelSteps: 3,
      toolCalls: 5,
      limitReason: "tool_call_limit",
    });
    validateCanonicalConversation(result.canonicalDelta ?? []);
  });

  it("updates the low-allowance hint as successful calls consume the fixed total", async () => {
    const f = fixture();
    const result = await runAgent({
      ...f.options,
      limits: { maxModelSteps: 6, maxToolCalls: 3 },
    });
    expect(
      f.requests
        .slice(0, 3)
        .map(
          (request) =>
            request.instructions?.match(/(\d) tool calls remain/u)?.[1],
        ),
    ).toEqual(["3", "2", "1"]);
    expect(f.requests[3]?.toolChoice).toBe("none");
    expect(result.toolCalls).toBe(3);
    expect(f.effects()).toBe(3);
  });
  it("gives bounded runs their actual total allowance and permits an early answer", async () => {
    const f = fixture(() => [
      { type: "text.delta", text: "Enough evidence; here is the answer." },
      finish(),
    ]);
    const result = await runAgent({
      ...f.options,
      instructions: "Original instructions",
      limits: { maxModelSteps: 6, maxToolCalls: 8 },
    });
    expect(result.status).toBe("completed");
    expect(f.requests).toHaveLength(1);
    expect(f.effects()).toBe(0);
    expect(f.requests[0]?.instructions).toContain("Original instructions");
    expect(f.requests[0]?.instructions).toContain(
      "6 model steps and 8 tool calls",
    );
    expect(f.requests[0]?.instructions).toContain(
      "do not claim unexecuted verification",
    );
  });
  it("finalizes an alternating read cycle without exhausting the total budget", async () => {
    const f = fixture((request, step) =>
      request.toolChoice === "none"
        ? [
            { type: "text.delta", text: "Partial answer; no new evidence." },
            finish(),
          ]
        : [
            {
              type: "tool.call",
              call: {
                id: `read-${step}`,
                name: "read_file",
                input: { path: step % 2 ? "a" : "b" },
              },
            },
            finish(true),
          ],
    );
    const reader = f.options.tools[0];
    if (!reader) throw new Error("missing reader");
    const result = await runAgent({
      ...f.options,
      limits: { maxModelSteps: 12 },
      tools: [
        {
          ...reader,
          execute: async (input, context) => {
            await reader.execute(input, context);
            return {
              ok: true,
              output: { content: "same", resourceVersion: "v1" },
              truncated: false,
            };
          },
        },
      ],
    });
    expect(result).toMatchObject({
      status: "limit_reached",
      limitReason: "no_progress",
      partial: true,
      modelSteps: 6,
      toolCalls: 5,
    });
    expect(f.effects()).toBe(5);
    expect(f.requests.at(-1)?.toolChoice).toBe("none");
    validateCanonicalConversation(result.canonicalDelta ?? []);
  });
  it("finalizes after using the tool allowance and preserves its actual results", async () => {
    const f = fixture();
    const result = await runAgent({
      ...f.options,
      limits: { maxModelSteps: 12, maxToolCalls: 1 },
    });
    expect(result).toMatchObject({
      status: "limit_reached",
      limitReason: "tool_call_limit",
      modelSteps: 2,
      toolCalls: 1,
    });
    expect(f.requests[1]?.toolResults?.[0]?.result).toMatchObject({
      ok: true,
      output: { content: "observed evidence" },
    });
    expect(f.requests[1]?.continuation).toEqual({
      provider: "fake",
      data: { messages: "opaque" },
    });
  });
  it("refuses an oversized batch with paired nonexecuted results before any effects", async () => {
    const f = fixture((request) =>
      request.toolChoice === "none"
        ? [{ type: "text.delta", text: "No batch actions executed." }, finish()]
        : [call("a"), call("b"), call("c"), finish(true)],
    );
    const result = await runAgent({
      ...f.options,
      limits: { maxModelSteps: 4, maxToolCalls: 2 },
    });
    expect(result).toMatchObject({
      status: "limit_reached",
      limitReason: "tool_call_limit",
      modelSteps: 2,
      toolCalls: 0,
    });
    expect(f.effects()).toBe(0);
    expect(f.requests[1]?.toolResults).toHaveLength(3);
    expect(
      f.requests[1]?.toolResults?.every(
        (entry) =>
          !entry.result.ok && entry.result.error.code === "limit_reached",
      ),
    ).toBe(true);
    validateCanonicalConversation(result.canonicalDelta ?? []);
  });
  it("falls back without calling an adapter that cannot request none", async () => {
    const f = fixture();
    const model = { ...f.options.model, supportsToolChoiceNone: false };
    const result = await runAgent({
      ...f.options,
      model,
      limits: { maxModelSteps: 2 },
    });
    expect(f.requests).toHaveLength(1);
    expect(result).toMatchObject({
      status: "limit_reached",
      partial: true,
      modelSteps: 1,
    });
    expect(result.finalText).toContain("Observed tool success");
    expect(
      result.canonicalDelta?.some(
        (message) =>
          message.role === "assistant" &&
          message.content.some(
            (part) => part.type === "text" && part.text === result.finalText,
          ),
      ),
    ).toBe(true);
    validateCanonicalConversation(result.canonicalDelta ?? []);
  });
  it("blocks tool calls when the provider ignores none and does not show untrusted summary text", async () => {
    const f = fixture((request) =>
      request.toolChoice === "none"
        ? [
            { type: "text.delta", text: "UNVERIFIED_SUCCESS" },
            call("forbidden"),
            finish(true),
          ]
        : [call("read"), finish(true)],
    );
    const result = await runAgent({
      ...f.options,
      limits: { maxModelSteps: 2 },
    });
    expect(f.effects()).toBe(1);
    expect(result.finalText).not.toContain("UNVERIFIED_SUCCESS");
    expect(
      result.events.some(
        (event) =>
          event.type === "model.text" &&
          event.text.includes("UNVERIFIED_SUCCESS"),
      ),
    ).toBe(false);
    expect(
      result.events.some(
        (event) =>
          event.type === "tool.started" && event.call.id === "forbidden",
      ),
    ).toBe(false);
    validateCanonicalConversation(result.canonicalDelta ?? []);
  });
  it("does not make a hidden retry after finalization fails", async () => {
    const f = fixture((request) =>
      request.toolChoice === "none"
        ? new Error("provider failed")
        : [call("read"), finish(true)],
    );
    const result = await runAgent({
      ...f.options,
      limits: { maxModelSteps: 2 },
    });
    expect(f.requests).toHaveLength(2);
    expect(result).toMatchObject({
      status: "limit_reached",
      partial: true,
      modelSteps: 2,
    });
    expect(result.finalText).toContain("unconfirmed");
    validateCanonicalConversation(result.canonicalDelta ?? []);
  });
  it("cancels finalization without replacing cancellation with a partial success", async () => {
    const controller = new AbortController();
    const f = fixture((request) => {
      if (request.toolChoice === "none") {
        controller.abort();
        return [{ type: "abort" }];
      }
      return [call("read"), finish(true)];
    });
    const result = await runAgent({
      ...f.options,
      signal: controller.signal,
      limits: { maxModelSteps: 2 },
    });
    expect(result.status).toBe("cancelled");
    expect(f.requests).toHaveLength(2);
    expect(f.effects()).toBe(1);
    validateCanonicalConversation(result.canonicalDelta ?? []);
  });
  it("summarizes uncapped tasks after three identical reads with known unchanged versions", async () => {
    const f = fixture();
    const reader = f.options.tools[0];
    if (!reader) throw new Error("missing fixture tool");
    const result = await runAgent({
      ...f.options,
      tools: [
        {
          ...reader,
          execute: async (input, context) => {
            await reader.execute(input, context);
            return {
              ok: true,
              output: {
                content: "same evidence",
                resourceVersion: "known-version",
              },
              truncated: false,
            };
          },
        },
      ],
    });
    expect(result).toMatchObject({
      status: "limit_reached",
      limitReason: "no_progress",
      partial: true,
      modelSteps: 4,
      toolCalls: 3,
    });
    expect(f.effects()).toBe(3);
    expect(f.requests).toHaveLength(4);
    expect(f.requests[3]?.toolChoice).toBe("none");
  });
  it("permits legitimate rereads after each resource version changes", async () => {
    const f = fixture();
    const reader = f.options.tools[0];
    if (!reader) throw new Error("missing fixture tool");
    let version = 0;
    const result = await runAgent({
      ...f.options,
      tools: [
        {
          ...reader,
          execute: async (input, context) => {
            await reader.execute(input, context);
            return {
              ok: true,
              output: {
                content: "new evidence",
                resourceVersion: `version-${++version}`,
              },
              truncated: false,
            };
          },
        },
      ],
      limits: { maxModelSteps: 6 },
    });
    expect(result).toMatchObject({
      limitReason: "model_step_limit",
      modelSteps: 6,
      toolCalls: 5,
    });
    expect(f.effects()).toBe(5);
  });
  it("does not infer no-progress when versions are unavailable", async () => {
    const f = fixture();
    const result = await runAgent({
      ...f.options,
      limits: { maxModelSteps: 6 },
    });
    expect(result).toMatchObject({
      limitReason: "model_step_limit",
      modelSteps: 6,
      toolCalls: 5,
    });
    expect(f.effects()).toBe(5);
  });
  it("does not send a finalization request that fails context admission", async () => {
    const f = fixture();
    const result = await runAgent({
      ...f.options,
      limits: { maxModelSteps: 1 },
      model: {
        ...f.options.model,
        context: {
          provider: "fixture",
          modelId: "tiny",
          contextWindowTokens: 32,
          contextWindowSource: "configured-fallback",
          nativeCompaction: "unsupported",
          continuationProjection: "unsupported",
          estimateRequestTokens: async () => ({
            tokens: 1000,
            method: "conservative-fallback",
            confidence: "estimated",
          }),
        },
      },
    });
    expect(f.requests).toHaveLength(0);
    expect(f.effects()).toBe(0);
    expect(result).toMatchObject({
      status: "limit_reached",
      partial: true,
      modelSteps: 0,
    });
    expect(
      result.events.some((event) => event.type === "context.limit_reached"),
    ).toBe(true);
  });
  it("invalidates prefix telemetry when finalization changes instructions and tool choice", async () => {
    const f = fixture();
    const result = await runAgent({
      ...f.options,
      limits: { maxModelSteps: 2 },
      promptPrefix: {
        provider: "fixture",
        modelId: "fixture",
        coreContract: "fixture",
        instructions: ["original"],
        resourceCatalog: "",
        enabledResourceIds: [],
        enabledPluginIds: [],
        checkpointGeneration: "same",
        providerOptions: {},
      },
    });
    const prefixes = result.events.filter(
      (event) => event.type === "cache.prefix",
    );
    expect(prefixes).toHaveLength(2);
    const last = prefixes.at(-1);
    if (last?.type !== "cache.prefix")
      throw new Error("missing prefix observation");
    expect(last.observation.invalidatedBy).toContain("instructions");
    expect(last.observation.invalidatedBy).toContain("provider-or-model");
  });
});
