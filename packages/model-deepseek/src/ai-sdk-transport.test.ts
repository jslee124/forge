import { APICallError, type streamText } from "ai";
import { describe, expect, it } from "vitest";

import {
  AiSdkDeepSeekTransport,
  mapDeepSeekError,
} from "./ai-sdk-transport.js";

async function* streamParts(parts: readonly unknown[]): AsyncIterable<unknown> {
  for (const part of parts) {
    yield part;
  }
}

describe("AI SDK DeepSeek transport", () => {
  it("maps reasoning, text, metadata, and usage without a network call", async () => {
    let capturedOptions: unknown;
    const streamTextStub = ((options: unknown) => {
      capturedOptions = options;
      return {
        stream: streamParts([
          {
            type: "start-step",
            warnings: [{ message: "test warning" }],
          },
          { type: "reasoning-delta", id: "r1", text: "reason" },
          { type: "text-delta", id: "t1", text: "answer" },
          {
            type: "finish-step",
            providerMetadata: {
              deepseek: { promptCacheHitTokens: 7 },
            },
          },
          {
            type: "finish",
            finishReason: "stop",
            totalUsage: {
              inputTokens: 10,
              inputTokenDetails: {
                noCacheTokens: 3,
                cacheReadTokens: 7,
                cacheWriteTokens: 0,
              },
              outputTokens: 5,
              outputTokenDetails: {
                textTokens: 3,
                reasoningTokens: 2,
              },
              totalTokens: 15,
            },
          },
        ]),
      };
    }) as unknown as typeof streamText;
    const transport = new AiSdkDeepSeekTransport(streamTextStub);
    const signal = new AbortController().signal;
    const events = [];

    for await (const event of transport.stream(
      {
        apiKey: "test-secret",
        model: "deepseek-v4-flash",
        thinking: "enabled",
        prompt: "hello",
      },
      signal,
    )) {
      events.push(event);
    }

    expect(capturedOptions).toMatchObject({
      prompt: "hello",
      abortSignal: signal,
      providerOptions: {
        deepseek: { thinking: { type: "enabled" } },
      },
    });
    expect(events).toEqual([
      { type: "warning", message: "test warning" },
      { type: "reasoning.delta", text: "reason" },
      { type: "text.delta", text: "answer" },
      {
        type: "finish",
        finishReason: "stop",
        usage: {
          inputTokens: 10,
          outputTokens: 5,
          reasoningTokens: 2,
          cachedInputTokens: 7,
          cacheWriteTokens: 0,
          totalTokens: 15,
        },
        providerMetadata: {
          deepseek: { promptCacheHitTokens: 7 },
        },
      },
    ]);
  });

  it("maps authentication failures to a safe actionable error", () => {
    const error = new APICallError({
      message: "provider response containing sensitive details",
      url: "https://api.deepseek.com/chat/completions",
      requestBodyValues: {},
      statusCode: 401,
      responseBody: "sensitive provider response",
    });

    const mapped = mapDeepSeekError(error);

    expect(mapped.message).toBe(
      "DeepSeek rejected the API key. Check DEEPSEEK_API_KEY.",
    );
    expect(mapped.statusCode).toBe(401);
    expect(mapped.retryable).toBe(false);
    expect(mapped.message).not.toContain("sensitive");
  });

  it("turns an aborted stream into an abort event", async () => {
    const streamTextStub = (() => ({
      stream: (async function* () {
        yield* [];
        throw new DOMException("cancelled", "AbortError");
      })(),
    })) as unknown as typeof streamText;
    const transport = new AiSdkDeepSeekTransport(streamTextStub);
    const controller = new AbortController();
    controller.abort("SIGINT");
    const events = [];

    for await (const event of transport.stream(
      {
        apiKey: "test-secret",
        model: "deepseek-v4-flash",
        thinking: "enabled",
        prompt: "hello",
      },
      controller.signal,
    )) {
      events.push(event);
    }

    expect(events).toEqual([{ type: "abort", reason: "SIGINT" }]);
  });
});
