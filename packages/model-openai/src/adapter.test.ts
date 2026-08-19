import { describe, expect, it } from "vitest";

import { createOpenAIModelAdapter } from "./index.js";
import type { OpenAITransportRequest } from "./transport.js";

describe("OpenAI model adapter", () => {
  it("supports API-key authentication without making a paid request", async () => {
    let captured: OpenAITransportRequest | undefined;
    const adapter = createOpenAIModelAdapter({
      env: { OPENAI_API_KEY: "test-only-secret" },
      model: "gpt-test",
      reasoningEffort: "high",
      transport: {
        async *stream(request) {
          captured = request;
          yield {
            type: "finish",
            finishReason: "stop",
            usage: {
              inputTokens: 1,
              outputTokens: 1,
              reasoningTokens: 0,
              cachedInputTokens: 0,
              cacheWriteTokens: 0,
              totalTokens: 2,
            },
          };
        },
      },
    });
    for await (const _event of adapter.stream(
      { prompt: "test" },
      new AbortController().signal,
    )) {
      // Mock transport only: no network and no API charge.
    }
    expect(captured).toMatchObject({
      apiKey: "test-only-secret",
      model: "gpt-test",
      reasoningEffort: "high",
    });
  });
});
