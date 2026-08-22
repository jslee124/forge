import { APICallError, type streamText } from "ai";
import { describe, expect, it } from "vitest";

import { AiSdkCompatTransport, mapCompatError } from "./ai-sdk-transport.js";

async function* streamParts(parts: readonly unknown[]): AsyncIterable<unknown> {
  for (const part of parts) yield part;
}

describe("AI SDK compatibility transport", () => {
  it("forces reasoning only when a configured reasoning effort is sent", async () => {
    let capturedOptions: unknown;
    const streamTextStub = ((options: unknown) => {
      capturedOptions = options;
      return {
        stream: streamParts([
          { type: "finish", finishReason: "stop", totalUsage: usage() },
        ]),
        responseMessages: Promise.resolve([]),
      };
    }) as unknown as typeof streamText;
    const transport = new AiSdkCompatTransport(streamTextStub);

    for await (const _event of transport.stream(
      {
        route: "xiaomi-mimo",
        api: "openai-responses",
        baseUrl: "https://api.xiaomimimo.com/v1",
        model: "mimo-v2.5-pro",
        reasoningEffort: "medium",
        prompt: "hello",
      },
      new AbortController().signal,
    )) {
      // Consume the response.
    }

    expect(capturedOptions).toMatchObject({
      providerOptions: {
        openai: {
          reasoningEffort: "medium",
          forceReasoning: true,
          store: false,
        },
      },
    });
  });

  it("sends explicit none without requesting reasoning continuation state", async () => {
    let capturedOptions: unknown;
    const transport = new AiSdkCompatTransport(((options: unknown) => {
      capturedOptions = options;
      return {
        stream: streamParts([
          { type: "finish", finishReason: "stop", totalUsage: usage() },
        ]),
        responseMessages: Promise.resolve([]),
      };
    }) as unknown as typeof streamText);

    for await (const _event of transport.stream(
      {
        route: "gateway",
        api: "openai-responses",
        baseUrl: "https://gateway.example/v1",
        model: "reasoning-model",
        reasoningEffort: "none",
        prompt: "hello",
      },
      new AbortController().signal,
    )) {
      // Consume the response.
    }

    expect(capturedOptions).toMatchObject({
      providerOptions: {
        openai: { reasoningEffort: "none", forceReasoning: true },
      },
    });
    expect(capturedOptions).not.toMatchObject({
      providerOptions: { openai: { store: expect.anything() } },
    });
  });

  it("keeps reasoning provider metadata in stateless tool continuation", async () => {
    const responseMessages = [
      {
        role: "assistant" as const,
        content: [
          {
            type: "reasoning" as const,
            text: "provider reasoning",
            providerOptions: {
              openai: {
                itemId: "reasoning-1",
                reasoningEncryptedContent: "opaque-state",
              },
            },
          },
          {
            type: "tool-call" as const,
            toolCallId: "call-1",
            toolName: "list_files",
            input: {},
          },
        ],
      },
    ];
    const transport = new AiSdkCompatTransport((() => ({
      stream: streamParts([
        {
          type: "finish",
          finishReason: "tool-calls",
          totalUsage: usage(),
        },
      ]),
      responseMessages: Promise.resolve(responseMessages),
    })) as unknown as typeof streamText);
    const events = [];

    for await (const event of transport.stream(
      {
        route: "gateway",
        api: "openai-responses",
        baseUrl: "https://gateway.example/v1",
        model: "reasoning-model",
        prompt: "inspect",
      },
      new AbortController().signal,
    )) {
      events.push(event);
    }

    expect(events.at(-1)).toMatchObject({
      type: "finish",
      continuation: {
        data: {
          messages: expect.arrayContaining([
            expect.objectContaining({ role: "user", content: "inspect" }),
            expect.objectContaining({
              role: "assistant",
              content: expect.arrayContaining([
                expect.objectContaining({
                  type: "reasoning",
                  providerOptions: {
                    openai: expect.objectContaining({
                      reasoningEncryptedContent: "opaque-state",
                    }),
                  },
                }),
              ]),
            }),
          ]),
        },
      },
    });
  });

  it("renders structured AI SDK warnings instead of hiding their details", async () => {
    const streamTextStub = (() => ({
      stream: streamParts([
        {
          type: "start-step",
          warnings: [
            {
              type: "unsupported",
              feature: "reasoningEffort",
              details: "not supported for this model",
            },
          ],
        },
        { type: "finish", finishReason: "stop", totalUsage: usage() },
      ]),
      responseMessages: Promise.resolve([]),
    })) as unknown as typeof streamText;
    const transport = new AiSdkCompatTransport(streamTextStub);
    const events = [];

    for await (const event of transport.stream(
      {
        route: "gateway",
        api: "openai-responses",
        baseUrl: "https://gateway.example/v1",
        model: "custom-model",
        prompt: "hello",
      },
      new AbortController().signal,
    )) {
      events.push(event);
    }

    expect(events[0]).toEqual({
      type: "warning",
      message: "reasoningEffort: not supported for this model",
    });
  });

  it("warns when thinking tool calls have no replayable reasoning state", async () => {
    const transport = new AiSdkCompatTransport((() => ({
      stream: streamParts([
        {
          type: "finish",
          finishReason: "tool-calls",
          totalUsage: usage(17),
        },
      ]),
      responseMessages: Promise.resolve([
        {
          role: "assistant",
          content: [
            {
              type: "tool-call",
              toolCallId: "call-1",
              toolName: "list_files",
              input: {},
            },
          ],
        },
      ]),
    })) as unknown as typeof streamText);
    const events = [];

    for await (const event of transport.stream(
      {
        route: "gateway",
        api: "openai-responses",
        baseUrl: "https://gateway.example/v1",
        model: "reasoning-model",
        prompt: "inspect",
      },
      new AbortController().signal,
    )) {
      events.push(event);
    }

    expect(events).toContainEqual({
      type: "warning",
      message: expect.stringContaining("no replayable reasoning content"),
    });
  });

  it("shows bounded structured provider errors without exposing credentials", () => {
    const mapped = mapCompatError(
      new APICallError({
        message: "bad request",
        url: "https://gateway.example/v1/responses",
        requestBodyValues: {},
        statusCode: 400,
        responseBody: JSON.stringify({
          error: {
            code: "invalid_reasoning_effort",
            message: "API key=sk-super-secret and effort max is unsupported",
          },
        }),
      }),
      "gateway",
    );

    expect(mapped.message).toContain(
      "HTTP 400: invalid_reasoning_effort: API key=[redacted] and effort max is unsupported",
    );
    expect(mapped.message).not.toContain("sk-super-secret");
  });
});

function usage(reasoningTokens = 0) {
  return {
    inputTokens: 1,
    inputTokenDetails: {
      noCacheTokens: 1,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
    },
    outputTokens: 1,
    outputTokenDetails: { textTokens: 1, reasoningTokens },
    totalTokens: 2,
  };
}
