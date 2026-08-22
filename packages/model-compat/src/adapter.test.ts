import { describe, expect, it } from "vitest";

import { CompatModelAdapter, resolveReasoningWireValue } from "./adapter.js";
import type { CompatTransportRequest } from "./transport.js";

describe("CompatModelAdapter", () => {
  it("maps configured reasoning gears and forwards route capabilities", async () => {
    let received: CompatTransportRequest | undefined;
    const adapter = new CompatModelAdapter({
      route: "local",
      api: "openai-responses",
      baseUrl: "http://localhost:11434/v1",
      model: "vision-model",
      reasoningEffort: "high",
      profile: {
        id: "vision-model",
        contextWindow: 65_536,
        maxOutputTokens: 8_192,
        reasoningGears: { none: null, high: "deep" },
        supportsImages: true,
      },
      transport: {
        async *stream(request) {
          received = request;
          yield {
            type: "finish",
            finishReason: "stop",
            usage: {
              inputTokens: 1,
              outputTokens: 1,
              reasoningTokens: undefined,
              cachedInputTokens: undefined,
              cacheWriteTokens: undefined,
              totalTokens: 2,
            },
          };
        },
      },
    });

    for await (const _event of adapter.stream(
      {
        prompt: "describe",
        images: [{ type: "url", url: "https://example.test/image.png" }],
      },
      new AbortController().signal,
    )) {
      // consume
    }

    expect(received).toMatchObject({
      route: "local",
      reasoningEffort: "deep",
      model: "vision-model",
      images: [{ type: "url" }],
    });
    expect(adapter.context.contextWindowTokens).toBe(65_536);
    expect(adapter.context.maxOutputTokens).toBe(8_192);
  });

  it("distinguishes an explicit none gear from the provider default", () => {
    expect(resolveReasoningWireValue("high")).toBeUndefined();
    expect(
      resolveReasoningWireValue("none", {
        id: "model",
        reasoningGears: { none: null },
      }),
    ).toBe("none");
    expect(
      resolveReasoningWireValue("none", {
        id: "model",
        reasoningGears: { none: "none" },
      }),
    ).toBe("none");
    expect(
      resolveReasoningWireValue("high", {
        id: "model",
        reasoningGears: false,
      }),
    ).toBeUndefined();
  });
});
