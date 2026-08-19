import type { streamText } from "ai";
import { describe, expect, it } from "vitest";

import { AiSdkOpenAITransport } from "./ai-sdk-transport.js";

async function* streamParts(parts: readonly unknown[]): AsyncIterable<unknown> {
  for (const part of parts) yield part;
}

describe("AI SDK OpenAI Responses transport", () => {
  it("maps reasoning effort and streaming output without a network call", async () => {
    let captured: unknown;
    const streamTextStub = ((options: unknown) => {
      captured = options;
      return {
        stream: streamParts([
          { type: "reasoning-delta", text: "reason" },
          { type: "text-delta", text: "answer" },
          {
            type: "finish",
            finishReason: "stop",
            totalUsage: {
              inputTokens: 2,
              inputTokenDetails: {
                noCacheTokens: 2,
                cacheReadTokens: 0,
                cacheWriteTokens: 0,
              },
              outputTokens: 2,
              outputTokenDetails: { textTokens: 1, reasoningTokens: 1 },
              totalTokens: 4,
            },
          },
        ]),
        responseMessages: Promise.resolve([]),
      };
    }) as unknown as typeof streamText;
    const events = [];
    const transport = new AiSdkOpenAITransport(streamTextStub);

    for await (const event of transport.stream(
      {
        apiKey: "test-only-secret",
        model: "gpt-test",
        reasoningEffort: "high",
        prompt: "hello",
      },
      new AbortController().signal,
    )) {
      events.push(event);
    }

    expect(captured).toMatchObject({
      messages: [{ role: "user", content: "hello" }],
      providerOptions: {
        openai: { reasoningEffort: "high", store: false },
      },
      onError: expect.any(Function),
    });
    expect(events).toEqual([
      { type: "reasoning.delta", text: "reason" },
      { type: "text.delta", text: "answer" },
      {
        type: "finish",
        finishReason: "stop",
        usage: {
          inputTokens: 2,
          outputTokens: 2,
          reasoningTokens: 1,
          cachedInputTokens: 0,
          cacheWriteTokens: 0,
          totalTokens: 4,
        },
        continuation: {
          provider: "openai",
          data: { messages: [{ role: "user", content: "hello" }] },
        },
      },
    ]);
  });
});
