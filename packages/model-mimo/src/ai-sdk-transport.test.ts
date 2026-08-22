import { ModelProviderError } from "@forge/core";
import type { streamText } from "ai";
import { describe, expect, it } from "vitest";
import { z } from "zod";

import { AiSdkMiMoTransport } from "./ai-sdk-transport.js";

async function* streamParts(parts: readonly unknown[]): AsyncIterable<unknown> {
  for (const part of parts) yield part;
}

describe("AI SDK MiMo Responses transport", () => {
  it("maps the supported reasoning effort and image content", async () => {
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
            totalUsage: usage(2, 2, 1),
          },
        ]),
        responseMessages: Promise.resolve([]),
      };
    }) as unknown as typeof streamText;
    const transport = new AiSdkMiMoTransport(streamTextStub);
    const events = [];

    for await (const event of transport.stream(
      {
        apiKey: "test-key",
        baseURL: "https://mimo.example/v1",
        model: "mimo-v2.5",
        reasoningEffort: "high",
        prompt: "describe",
        images: [
          {
            type: "base64",
            mediaType: "image/png",
            data: "AA==",
          },
        ],
      },
      new AbortController().signal,
    )) {
      events.push(event);
    }

    expect(captured).toMatchObject({
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: "describe" },
            { type: "file", mediaType: "image/png" },
          ],
        },
      ],
      providerOptions: { mimo: { reasoningEffort: "high" } },
    });
    expect(events.map(({ type }) => type)).toEqual([
      "reasoning.delta",
      "text.delta",
      "finish",
    ]);
  });

  it("preserves reasoning and function-call items for the tool-result turn", async () => {
    const bodies: unknown[] = [];
    const urls: string[] = [];
    const authorizations: string[] = [];
    let call = 0;
    const fetch = async (url: string | URL | Request, init?: RequestInit) => {
      urls.push(String(url));
      authorizations.push(
        new Headers(init?.headers).get("authorization") ?? "",
      );
      bodies.push(JSON.parse(String(init?.body)));
      call += 1;
      return sseResponse(call === 1 ? toolCallEvents() : answerEvents());
    };
    const transport = new AiSdkMiMoTransport({ fetch });

    const firstEvents = [];
    for await (const event of transport.stream(
      {
        apiKey: "explicit-key",
        baseURL: "https://mimo.example/v1/",
        model: "mimo-v2.5",
        reasoningEffort: "medium",
        prompt: "weather?",
        images: [
          {
            type: "base64",
            mediaType: "image/png",
            data: "AA==",
          },
        ],
        tools: [
          {
            name: "get_weather",
            description: "Get weather",
            inputSchema: z.object({ city: z.string() }),
          },
        ],
      },
      new AbortController().signal,
    )) {
      firstEvents.push(event);
    }
    const finish = firstEvents.find((event) => event.type === "finish");
    expect(firstEvents).toEqual(
      expect.arrayContaining([
        { type: "reasoning.delta", text: "Need weather." },
        expect.objectContaining({
          type: "tool.call",
          call: expect.objectContaining({ id: "call_1", name: "get_weather" }),
        }),
      ]),
    );
    expect(finish?.continuation).toBeDefined();
    if (!finish?.continuation) throw new Error("missing continuation");

    const secondEvents = [];
    for await (const event of transport.stream(
      {
        apiKey: "explicit-key",
        baseURL: "https://mimo.example/v1/",
        model: "mimo-v2.5",
        reasoningEffort: "medium",
        prompt: "",
        continuation: finish.continuation,
        toolResults: [
          {
            callId: "call_1",
            toolName: "get_weather",
            result: { ok: true, output: "sunny", truncated: false },
          },
        ],
      },
      new AbortController().signal,
    )) {
      secondEvents.push(event);
    }

    expect(urls).toEqual([
      "https://mimo.example/v1/responses",
      "https://mimo.example/v1/responses",
    ]);
    expect(authorizations).toEqual([
      "Bearer explicit-key",
      "Bearer explicit-key",
    ]);
    expect(bodies[0]).toMatchObject({
      input: [
        {
          type: "message",
          role: "user",
          content: [
            { type: "input_text", text: "weather?" },
            {
              type: "input_image",
              image_url: "data:image/png;base64,AA==",
            },
          ],
        },
      ],
    });
    expect(bodies[1]).toMatchObject({
      reasoning: { effort: "medium" },
      input: expect.arrayContaining([
        expect.objectContaining({
          id: "rs_1",
          type: "reasoning",
          content: [{ type: "reasoning_text", text: "Need weather." }],
        }),
        expect.objectContaining({
          id: "fc_1",
          type: "function_call",
          call_id: "call_1",
          name: "get_weather",
        }),
        expect.objectContaining({
          type: "function_call_output",
          call_id: "call_1",
        }),
      ]),
    });
    expect(secondEvents).toContainEqual({ type: "text.delta", text: "Sunny." });
  });

  it("maps authentication and retryability without exposing the key", async () => {
    const transport = new AiSdkMiMoTransport({
      fetch: async () =>
        new Response(
          JSON.stringify({
            error: {
              message: "rejected",
              type: "authentication_error",
              param: "",
              code: "invalid_api_key",
            },
          }),
          { status: 401, headers: { "content-type": "application/json" } },
        ),
    });

    let error: unknown;
    try {
      for await (const _event of transport.stream(
        {
          apiKey: "must-not-appear",
          baseURL: "https://mimo.example/v1",
          model: "mimo-v2.5",
          reasoningEffort: "low",
          prompt: "hello",
        },
        new AbortController().signal,
      )) {
        // The response fails before yielding output.
      }
    } catch (caught) {
      error = caught;
    }
    expect(error).toBeInstanceOf(ModelProviderError);
    expect(error).toMatchObject({
      provider: "mimo",
      statusCode: 401,
      retryable: false,
    });
    expect(String(error)).not.toContain("must-not-appear");
  });
});

function usage(input: number, output: number, reasoning: number) {
  return {
    inputTokens: input,
    inputTokenDetails: {
      noCacheTokens: input,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
    },
    outputTokens: output,
    outputTokenDetails: {
      textTokens: output - reasoning,
      reasoningTokens: reasoning,
    },
    totalTokens: input + output,
  };
}

function sseResponse(events: readonly object[]): Response {
  return new Response(
    `${events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join("")}data: [DONE]\n\n`,
    { headers: { "content-type": "text/event-stream" } },
  );
}

function toolCallEvents(): readonly object[] {
  return [
    {
      type: "response.output_item.added",
      item: { type: "reasoning", id: "rs_1", summary: [], content: [] },
    },
    {
      type: "response.reasoning_text.delta",
      item_id: "rs_1",
      delta: "Need weather.",
    },
    {
      type: "response.output_item.done",
      item: {
        type: "reasoning",
        id: "rs_1",
        summary: [],
        content: [{ type: "reasoning_text", text: "Need weather." }],
      },
    },
    {
      type: "response.output_item.added",
      item: {
        type: "function_call",
        id: "fc_1",
        call_id: "call_1",
        name: "get_weather",
        arguments: '{"city":"Beijing"}',
        status: "in_progress",
      },
    },
    {
      type: "response.output_item.done",
      item: {
        type: "function_call",
        id: "fc_1",
        call_id: "call_1",
        name: "get_weather",
        arguments: '{"city":"Beijing"}',
        status: "completed",
      },
    },
    completedResponse("resp_1", 8, 6, 4),
  ];
}

function answerEvents(): readonly object[] {
  return [
    {
      type: "response.output_item.added",
      item: {
        type: "message",
        id: "msg_2",
        status: "in_progress",
        role: "assistant",
        content: [],
      },
    },
    {
      type: "response.output_text.delta",
      item_id: "msg_2",
      delta: "Sunny.",
    },
    {
      type: "response.output_item.done",
      item: {
        type: "message",
        id: "msg_2",
        status: "completed",
        role: "assistant",
        content: [
          {
            type: "output_text",
            text: "Sunny.",
            annotations: [],
            logprobs: [],
          },
        ],
      },
    },
    completedResponse("resp_2", 12, 2, 0),
  ];
}

function completedResponse(
  id: string,
  inputTokens: number,
  outputTokens: number,
  reasoningTokens: number,
): object {
  return {
    type: "response.completed",
    response: {
      id,
      object: "response",
      created_at: 0,
      status: "completed",
      model: "mimo-v2.5",
      output: [],
      usage: {
        input_tokens: inputTokens,
        output_tokens: outputTokens,
        total_tokens: inputTokens + outputTokens,
        input_tokens_details: { cached_tokens: 0 },
        output_tokens_details: { reasoning_tokens: reasoningTokens },
      },
    },
  };
}
