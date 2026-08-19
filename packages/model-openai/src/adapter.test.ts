import { describe, expect, it } from "vitest";

import { createOpenAIModelAdapter } from "./index.js";
import type { OpenAITransportRequest } from "./transport.js";

describe("OpenAI model adapter", () => {
  it("uses an explicit model table and a conservative unknown-model fallback", () => {
    const transport = {
      async *stream() {
        yield { type: "abort" as const };
      },
    };
    const known = createOpenAIModelAdapter({
      env: { OPENAI_API_KEY: "test" },
      model: "gpt-5.4-mini",
      transport,
    });
    const unknown = createOpenAIModelAdapter({
      env: { OPENAI_API_KEY: "test" },
      model: "future-unknown",
      transport,
    });
    expect(known.context).toMatchObject({
      contextWindowTokens: 400_000,
      contextWindowSource: "adapter-table",
    });
    expect(unknown.context).toMatchObject({
      contextWindowTokens: 32_768,
      contextWindowSource: "configured-fallback",
    });
  });

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
