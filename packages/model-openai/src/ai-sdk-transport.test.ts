import type { OpenAIProviderSettings } from "@ai-sdk/openai";
import { InvalidPromptError, type streamText } from "ai";
import { describe, expect, it } from "vitest";

import { AiSdkOpenAITransport, mapOpenAIError } from "./ai-sdk-transport.js";

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
        instructions: "Follow repository instructions.",
      },
      new AbortController().signal,
    )) {
      events.push(event);
    }

    expect(captured).toMatchObject({
      instructions: "Follow repository instructions.",
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

  it("passes instructions through AI SDK prompt standardization", async () => {
    let requestBody: unknown;
    const fetchMock: NonNullable<OpenAIProviderSettings["fetch"]> = async (
      _input,
      init,
    ) => {
      requestBody = JSON.parse(String(init?.body));
      return new Response(JSON.stringify({ error: { message: "test stop" } }), {
        status: 400,
        headers: { "content-type": "application/json" },
      });
    };
    const transport = new AiSdkOpenAITransport({ fetch: fetchMock });

    await expect(async () => {
      for await (const _event of transport.stream(
        {
          apiKey: "test-only-secret",
          model: "gpt-test",
          reasoningEffort: "medium",
          prompt: "hello",
          instructions: "Follow repository instructions.",
        },
        new AbortController().signal,
      )) {
        // Consume until the mocked provider error.
      }
    }).rejects.toThrow("HTTP 400");

    expect(requestBody).toMatchObject({
      input: [
        { role: "system", content: "Follow repository instructions." },
        {
          role: "user",
          content: [{ type: "input_text", text: "hello" }],
        },
      ],
    });
  });

  it("maps invalid prompts to a non-retryable configuration error", () => {
    const mapped = mapOpenAIError(
      new InvalidPromptError({
        prompt: { messages: [] },
        message: "sensitive prompt validation details",
      }),
    );

    expect(mapped.message).toBe(
      "Could not construct the OpenAI API request. Check the prompt and model configuration.",
    );
    expect(mapped.retryable).toBe(false);
    expect(mapped.message).not.toContain("sensitive");
  });
});
