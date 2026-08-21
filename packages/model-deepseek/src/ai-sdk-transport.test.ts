import type { DeepSeekProviderSettings } from "@ai-sdk/deepseek";
import { APICallError, type streamText } from "ai";
import { describe, expect, it, vi } from "vitest";
import { z } from "zod";

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
  it("uses the Responses API message shape for the vision model", async () => {
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
    const transport = new AiSdkDeepSeekTransport(streamTextStub);

    for await (const _event of transport.stream(
      {
        apiKey: "test-secret",
        model: "deepseek-v4-flash-vision-exp",
        thinking: "enabled",
        prompt: "What is shown?",
        images: [
          {
            type: "base64",
            mediaType: "image/png",
            data: "iVBORw0KGgo=",
            filename: "screen.png",
          },
          { type: "url", url: "https://example.com/reference.webp" },
        ],
      },
      new AbortController().signal,
    )) {
      // Consume the response.
    }

    expect(capturedOptions).toMatchObject({
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: "What is shown?" },
            {
              type: "file",
              mediaType: "image/png",
              data: { type: "data", data: "iVBORw0KGgo=" },
              filename: "screen.png",
            },
            {
              type: "file",
              mediaType: "image",
              data: {
                type: "url",
                url: new URL("https://example.com/reference.webp"),
              },
            },
          ],
        },
      ],
      providerOptions: {
        openai: { store: false },
      },
    });
  });

  it("serializes vision input to DeepSeek's /responses endpoint", async () => {
    let requestUrl = "";
    let requestBody: unknown;
    const fetchMock: NonNullable<DeepSeekProviderSettings["fetch"]> = async (
      input,
      init,
    ) => {
      requestUrl = String(input);
      requestBody = JSON.parse(String(init?.body));
      return new Response(JSON.stringify({ error: { message: "test stop" } }), {
        status: 400,
        headers: { "content-type": "application/json" },
      });
    };
    const transport = new AiSdkDeepSeekTransport({ fetch: fetchMock });

    await expect(async () => {
      for await (const _event of transport.stream(
        {
          apiKey: "test-secret",
          model: "deepseek-v4-flash-vision-exp",
          thinking: "enabled",
          reasoningEffort: "max",
          prompt: "Inspect",
          images: [
            {
              type: "base64",
              mediaType: "image/png",
              data: "iVBORw0KGgo=",
            },
          ],
        },
        new AbortController().signal,
      )) {
        // Consume until the mocked provider error.
      }
    }).rejects.toThrow("HTTP 400");

    expect(requestUrl).toBe("https://api.deepseek.com/responses");
    expect(requestBody).toMatchObject({
      model: "deepseek-v4-flash-vision-exp",
      input: [
        {
          role: "user",
          content: [
            { type: "input_text", text: "Inspect" },
            {
              type: "input_image",
              image_url: "data:image/png;base64,iVBORw0KGgo=",
            },
          ],
        },
      ],
      reasoning: { effort: "max" },
      store: false,
      stream: true,
    });
  });

  it("places interactive conversation history before the current prompt", async () => {
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
    const transport = new AiSdkDeepSeekTransport(streamTextStub);

    for await (const _event of transport.stream(
      {
        apiKey: "test-secret",
        model: "deepseek-v4-flash",
        thinking: "disabled",
        prompt: "current task",
        instructions: "Follow repository instructions.",
        conversation: [
          { role: "user", content: "previous task" },
          { role: "assistant", content: "previous answer" },
        ],
      },
      new AbortController().signal,
    )) {
      // Consume the response.
    }

    expect(capturedOptions).toMatchObject({
      messages: [
        { role: "system", content: "Follow repository instructions." },
        { role: "user", content: "previous task" },
        { role: "assistant", content: "previous answer" },
        { role: "user", content: "current task" },
      ],
    });
  });

  it("maps reasoning, text, metadata, and usage without a network call", async () => {
    let capturedOptions: unknown;
    const streamTextStub = ((options: unknown) => {
      capturedOptions = options;
      const responseMessages = [
        {
          role: "assistant",
          content: [
            { type: "reasoning", text: "reason" },
            { type: "text", text: "answer" },
            {
              type: "tool-call",
              toolCallId: "call-1",
              toolName: "read_file",
              input: { path: "README.md" },
            },
          ],
        },
      ];
      return {
        stream: streamParts([
          {
            type: "start-step",
            warnings: [{ message: "test warning" }],
          },
          { type: "reasoning-delta", id: "r1", text: "reason" },
          { type: "text-delta", id: "t1", text: "answer" },
          {
            type: "tool-call",
            toolCallId: "call-1",
            toolName: "read_file",
            input: { path: "README.md" },
          },
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
        responseMessages: Promise.resolve(responseMessages),
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
        tools: [
          {
            name: "read_file",
            description: "Read one file",
            inputSchema: z.object({ path: z.string() }),
          },
        ],
      },
      signal,
    )) {
      events.push(event);
    }

    expect(capturedOptions).toMatchObject({
      messages: [{ role: "user", content: "hello" }],
      abortSignal: signal,
      onError: expect.any(Function),
      providerOptions: {
        deepseek: { thinking: { type: "enabled" } },
      },
    });
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
    (
      capturedOptions as {
        onError(options: { readonly error: unknown }): void;
      }
    ).onError({ error: new Error("raw provider failure") });
    expect(consoleError).not.toHaveBeenCalled();
    consoleError.mockRestore();
    const capturedTools = (
      capturedOptions as { tools: Record<string, Record<string, unknown>> }
    ).tools;
    const { read_file } = capturedTools;
    expect(Object.keys(capturedTools)).toEqual(["read_file"]);
    expect(read_file).not.toHaveProperty("execute");
    expect(events).toEqual([
      { type: "warning", message: "test warning" },
      { type: "reasoning.delta", text: "reason" },
      { type: "text.delta", text: "answer" },
      {
        type: "tool.call",
        call: {
          id: "call-1",
          name: "read_file",
          input: { path: "README.md" },
        },
      },
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
        continuation: {
          provider: "deepseek",
          data: {
            messages: [
              { role: "user", content: "hello" },
              {
                role: "assistant",
                content: [
                  { type: "reasoning", text: "reason" },
                  { type: "text", text: "answer" },
                  {
                    type: "tool-call",
                    toolCallId: "call-1",
                    toolName: "read_file",
                    input: { path: "README.md" },
                  },
                ],
              },
            ],
          },
        },
      },
    ]);
  });

  it("preserves reasoning across a mocked thinking-mode tool round trip", async () => {
    const capturedOptions: unknown[] = [];
    let invocation = 0;
    const streamTextStub = ((options: unknown) => {
      capturedOptions.push(options);
      invocation += 1;
      if (invocation === 1) {
        return {
          stream: streamParts([
            { type: "reasoning-delta", id: "r1", text: "inspect first" },
            {
              type: "tool-call",
              toolCallId: "call-1",
              toolName: "read_file",
              input: { path: "README.md" },
            },
            { type: "finish", finishReason: "tool-calls", totalUsage: usage() },
          ]),
          responseMessages: Promise.resolve([
            {
              role: "assistant",
              content: [
                { type: "reasoning", text: "inspect first" },
                {
                  type: "tool-call",
                  toolCallId: "call-1",
                  toolName: "read_file",
                  input: { path: "README.md" },
                },
              ],
            },
          ]),
        };
      }

      return {
        stream: streamParts([
          { type: "text-delta", id: "t1", text: "done" },
          { type: "finish", finishReason: "stop", totalUsage: usage() },
        ]),
        responseMessages: Promise.resolve([
          {
            role: "assistant",
            content: [{ type: "text", text: "done" }],
          },
        ]),
      };
    }) as unknown as typeof streamText;
    const transport = new AiSdkDeepSeekTransport(streamTextStub);
    const request = {
      apiKey: "test-secret",
      model: "deepseek-v4-flash",
      thinking: "enabled" as const,
      prompt: "inspect",
      tools: [
        {
          name: "read_file",
          description: "Read one file",
          inputSchema: z.object({ path: z.string() }),
        },
      ],
    };
    const firstEvents = [];
    for await (const event of transport.stream(
      request,
      new AbortController().signal,
    )) {
      firstEvents.push(event);
    }
    const firstFinish = firstEvents.find(({ type }) => type === "finish");
    expect(firstFinish?.type).toBe("finish");
    if (firstFinish?.type !== "finish" || !firstFinish.continuation) {
      throw new Error("Expected continuation data.");
    }

    for await (const _event of transport.stream(
      {
        ...request,
        continuation: firstFinish.continuation,
        toolResults: [
          {
            callId: "call-1",
            toolName: "read_file",
            result: {
              ok: true,
              output: { content: "Forge" },
              truncated: false,
            },
          },
        ],
      },
      new AbortController().signal,
    )) {
      // Consume the second provider turn.
    }

    expect(capturedOptions[1]).toMatchObject({
      messages: [
        { role: "user", content: "inspect" },
        {
          role: "assistant",
          content: [
            { type: "reasoning", text: "inspect first" },
            { type: "tool-call", toolCallId: "call-1" },
          ],
        },
        {
          role: "tool",
          content: [
            {
              type: "tool-result",
              toolCallId: "call-1",
              toolName: "read_file",
            },
          ],
        },
      ],
    });
  });

  it("preserves raw DeepSeek reasoning through the real AI SDK translation", async () => {
    const requestBodies: unknown[] = [];
    let invocation = 0;
    const fetchMock: NonNullable<DeepSeekProviderSettings["fetch"]> = async (
      _input,
      init,
    ) => {
      requestBodies.push(JSON.parse(String(init?.body)));
      invocation += 1;
      return new Response(
        invocation === 1 ? firstDeepSeekResponse() : secondDeepSeekResponse(),
        { headers: { "content-type": "text/event-stream" }, status: 200 },
      );
    };
    const transport = new AiSdkDeepSeekTransport({ fetch: fetchMock });
    const baseRequest = {
      apiKey: "test-secret",
      model: "deepseek-v4-flash",
      thinking: "enabled" as const,
      prompt: "inspect",
      tools: [
        {
          name: "read_file",
          description: "Read one file",
          inputSchema: z.object({ path: z.string() }),
        },
      ],
    };
    const firstEvents = [];
    for await (const event of transport.stream(
      baseRequest,
      new AbortController().signal,
    )) {
      firstEvents.push(event);
    }
    const firstFinish = firstEvents.find(({ type }) => type === "finish");
    if (firstFinish?.type !== "finish" || !firstFinish.continuation) {
      throw new Error("Expected DeepSeek continuation data.");
    }

    for await (const _event of transport.stream(
      {
        ...baseRequest,
        continuation: firstFinish.continuation,
        toolResults: [
          {
            callId: "call-1",
            toolName: "read_file",
            result: {
              ok: true,
              output: { content: "Forge" },
              truncated: false,
            },
          },
        ],
      },
      new AbortController().signal,
    )) {
      // Consume the second provider turn.
    }

    expect(requestBodies[1]).toMatchObject({
      model: "deepseek-v4-flash",
      thinking: { type: "enabled" },
      messages: [
        { role: "user", content: "inspect" },
        {
          role: "assistant",
          reasoning_content: "inspect first",
          tool_calls: [
            {
              id: "call-1",
              function: {
                name: "read_file",
                arguments: '{"path":"README.md"}',
              },
            },
          ],
        },
        { role: "tool", tool_call_id: "call-1" },
      ],
    });
  });

  it("returns exactly one Forge-owned tool result after invalid model input", async () => {
    const requestBodies: unknown[] = [];
    let invocation = 0;
    const fetchMock: NonNullable<DeepSeekProviderSettings["fetch"]> = async (
      _input,
      init,
    ) => {
      requestBodies.push(JSON.parse(String(init?.body)));
      invocation += 1;
      return new Response(
        invocation === 1
          ? invalidCreateFileDeepSeekResponse()
          : secondDeepSeekResponse(),
        { headers: { "content-type": "text/event-stream" }, status: 200 },
      );
    };
    const transport = new AiSdkDeepSeekTransport({ fetch: fetchMock });
    const baseRequest = {
      apiKey: "test-secret",
      model: "deepseek-v4-flash",
      thinking: "enabled" as const,
      prompt: "create hello.md",
      tools: [
        {
          name: "create_file",
          description: "Create a file",
          inputSchema: z.object({ path: z.string(), content: z.string() }),
        },
      ],
    };
    const firstEvents = [];
    for await (const event of transport.stream(
      baseRequest,
      new AbortController().signal,
    )) {
      firstEvents.push(event);
    }
    const firstFinish = firstEvents.find(({ type }) => type === "finish");
    if (firstFinish?.type !== "finish" || !firstFinish.continuation) {
      throw new Error("Expected continuation data for invalid tool input.");
    }

    for await (const _event of transport.stream(
      {
        ...baseRequest,
        continuation: firstFinish.continuation,
        toolResults: [
          {
            callId: "create-1",
            toolName: "create_file",
            result: {
              ok: false,
              error: {
                code: "invalid_input",
                message: 'Invalid input for tool "create_file".',
                retryable: false,
              },
            },
          },
        ],
      },
      new AbortController().signal,
    )) {
      // Consume the recovery response.
    }

    expect(firstEvents).toContainEqual({
      type: "tool.call",
      call: {
        id: "create-1",
        name: "create_file",
        input: { path: "hello.md" },
      },
    });
    expect(requestBodies[1]).toMatchObject({
      messages: [
        { role: "user", content: "create hello.md" },
        {
          role: "assistant",
          tool_calls: [
            {
              id: "create-1",
              function: {
                name: "create_file",
                arguments: '{"path":"hello.md"}',
              },
            },
          ],
        },
        { role: "tool", tool_call_id: "create-1" },
      ],
    });
    const secondRequest = requestBodies[1] as {
      readonly messages: readonly { readonly role: string }[];
    };
    expect(
      secondRequest.messages.filter(({ role }) => role === "tool"),
    ).toHaveLength(1);
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

function usage() {
  return {
    inputTokens: 1,
    inputTokenDetails: {
      noCacheTokens: 1,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
    },
    outputTokens: 1,
    outputTokenDetails: { textTokens: 1, reasoningTokens: 0 },
    totalTokens: 2,
  };
}

function firstDeepSeekResponse(): string {
  return sse([
    {
      id: "response-1",
      created: 1,
      model: "deepseek-v4-flash",
      choices: [
        {
          delta: { role: "assistant", reasoning_content: "inspect first" },
          finish_reason: null,
        },
      ],
    },
    {
      id: "response-1",
      created: 1,
      model: "deepseek-v4-flash",
      choices: [
        {
          delta: {
            tool_calls: [
              {
                index: 0,
                id: "call-1",
                function: {
                  name: "read_file",
                  arguments: '{"path":"README.md"}',
                },
              },
            ],
          },
          finish_reason: null,
        },
      ],
    },
    {
      id: "response-1",
      created: 1,
      model: "deepseek-v4-flash",
      choices: [{ delta: {}, finish_reason: "tool_calls" }],
      usage: deepSeekUsage(),
    },
  ]);
}

function secondDeepSeekResponse(): string {
  return sse([
    {
      id: "response-2",
      created: 2,
      model: "deepseek-v4-flash",
      choices: [
        {
          delta: { role: "assistant", content: "done" },
          finish_reason: null,
        },
      ],
    },
    {
      id: "response-2",
      created: 2,
      model: "deepseek-v4-flash",
      choices: [{ delta: {}, finish_reason: "stop" }],
      usage: deepSeekUsage(),
    },
  ]);
}

function invalidCreateFileDeepSeekResponse(): string {
  return sse([
    {
      id: "invalid-response",
      created: 1,
      model: "deepseek-v4-flash",
      choices: [
        {
          delta: { role: "assistant", reasoning_content: "create the file" },
          finish_reason: null,
        },
      ],
    },
    {
      id: "invalid-response",
      created: 1,
      model: "deepseek-v4-flash",
      choices: [
        {
          delta: {
            tool_calls: [
              {
                index: 0,
                id: "create-1",
                function: {
                  name: "create_file",
                  arguments: '{"path":"hello.md"}',
                },
              },
            ],
          },
          finish_reason: null,
        },
      ],
    },
    {
      id: "invalid-response",
      created: 1,
      model: "deepseek-v4-flash",
      choices: [{ delta: {}, finish_reason: "tool_calls" }],
      usage: deepSeekUsage(),
    },
  ]);
}

function deepSeekUsage() {
  return {
    prompt_tokens: 4,
    completion_tokens: 3,
    total_tokens: 7,
    prompt_cache_hit_tokens: 0,
    prompt_cache_miss_tokens: 4,
    completion_tokens_details: { reasoning_tokens: 2 },
  };
}

function sse(values: readonly unknown[]): string {
  return `${values.map((value) => `data: ${JSON.stringify(value)}\n\n`).join("")}data: [DONE]\n\n`;
}
