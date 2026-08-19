import { ModelProviderError } from "@forge/core";
import type { streamText } from "ai";
import { describe, expect, it } from "vitest";

import { AiSdkCompatTransport, mapCompatError } from "./ai-sdk-transport.js";
import type { CompatTransportRequest } from "./transport.js";

async function* streamParts(parts: readonly unknown[]): AsyncIterable<unknown> {
  for (const part of parts) yield part;
}

/** The streamText options one dispatch produced. */
interface CapturedCall {
  readonly model?: { readonly modelId?: string; readonly provider?: string };
  readonly providerOptions?: unknown;
}

function capturingStreamText(parts: readonly unknown[] = []): {
  readonly streamTextFunction: typeof streamText;
  captured(): CapturedCall;
} {
  let captured: Record<string, unknown> = {};
  const streamTextFunction = ((options: Record<string, unknown>) => {
    captured = options;
    return {
      stream: streamParts(parts),
      responseMessages: Promise.resolve([]),
    };
  }) as unknown as typeof streamText;
  return { streamTextFunction, captured: () => captured };
}

const baseRequest: CompatTransportRequest = {
  apiKey: "test-only-secret",
  route: "my-gateway",
  api: "openai-completions",
  baseUrl: "https://gateway.example/openai/v1",
  model: "glm-4.6",
  prompt: "hello",
};

async function run(
  request: CompatTransportRequest,
  parts: readonly unknown[] = [],
): Promise<{
  readonly events: unknown[];
  readonly captured: CapturedCall;
}> {
  const stub = capturingStreamText(parts);
  const transport = new AiSdkCompatTransport(stub.streamTextFunction);
  const events: unknown[] = [];
  for await (const event of transport.stream(
    request,
    new AbortController().signal,
  )) {
    events.push(event);
  }
  return { events, captured: stub.captured() };
}

describe("AI SDK compatible-endpoint transport", () => {
  it("selects the chat request shape for openai-completions", async () => {
    const { captured } = await run(baseRequest);
    expect(captured.model?.modelId).toBe("glm-4.6");
    // The two protocols must reach different SDK implementations, not just
    // carry the same model id.
    expect(captured.model?.provider).toBe("openai.chat");
    // No reasoning parameter is sent when the adapter resolved none.
    expect(captured.providerOptions).toBeUndefined();
  });

  it("selects the responses request shape for openai-responses", async () => {
    const { captured } = await run({
      ...baseRequest,
      api: "openai-responses",
    });
    expect(captured.model?.modelId).toBe("glm-4.6");
    expect(captured.model?.provider).toBe("openai.responses");
  });

  it("passes the resolved reasoning wire value through unchanged", async () => {
    const { captured } = await run({
      ...baseRequest,
      reasoningEffort: "think-hard",
    });
    expect(captured.providerOptions).toEqual({
      openai: { reasoningEffort: "think-hard" },
    });
  });

  it("tags the continuation with the route rather than a vendor", async () => {
    const { events } = await run(baseRequest, [
      { type: "text-delta", text: "answer" },
      {
        type: "finish",
        finishReason: "stop",
        totalUsage: {
          inputTokens: 1,
          inputTokenDetails: {
            noCacheTokens: 1,
            cacheReadTokens: 0,
            cacheWriteTokens: 0,
          },
          outputTokens: 1,
          outputTokenDetails: { textTokens: 1, reasoningTokens: 0 },
          totalTokens: 2,
        },
      },
    ]);
    expect(events.at(-1)).toMatchObject({
      type: "finish",
      continuation: { provider: "my-gateway" },
    });
  });

  it("refuses a continuation produced by another route", async () => {
    await expect(
      run({
        ...baseRequest,
        continuation: { provider: "other", data: { messages: [] } },
      }),
    ).rejects.toThrow(/incompatible continuation data/u);
  });
});

describe("mapCompatError", () => {
  it("names the route rather than a vendor", () => {
    const error = mapCompatError(new Error("boom"), "my-gateway");
    expect(error).toBeInstanceOf(ModelProviderError);
    expect(error.message).toContain('"my-gateway"');
    expect(error.message).not.toContain("OpenAI");
  });

  it("passes a Forge provider error through unchanged", () => {
    const original = new ModelProviderError("original", {
      provider: "my-gateway",
      retryable: false,
    });
    expect(mapCompatError(original, "my-gateway")).toBe(original);
  });
});
