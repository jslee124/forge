import { tmpdir } from "node:os";
import path from "node:path";
import type { ModelStreamEvent } from "@forge/core";
import { ModelConfigurationError } from "@forge/core";
import { describe, expect, it } from "vitest";

import {
  createDeepSeekModelAdapter,
  DEFAULT_DEEPSEEK_MODEL,
  resolveDeepSeekApiKey,
} from "./index.js";
import type {
  DeepSeekTransport,
  DeepSeekTransportRequest,
} from "./transport.js";

class FakeTransport implements DeepSeekTransport {
  request: DeepSeekTransportRequest | undefined;

  async *stream(
    request: DeepSeekTransportRequest,
    _signal: AbortSignal,
  ): AsyncIterable<ModelStreamEvent> {
    this.request = request;
    yield { type: "reasoning.delta", text: "inspect" };
    yield { type: "text.delta", text: "hello" };
    yield {
      type: "finish",
      finishReason: "stop",
      usage: {
        inputTokens: 4,
        outputTokens: 2,
        reasoningTokens: 1,
        cachedInputTokens: 3,
        cacheWriteTokens: 0,
        totalTokens: 6,
      },
      providerMetadata: { deepseek: { promptCacheHitTokens: 3 } },
    };
  }
}

describe("DeepSeek model adapter", () => {
  it("uses an explicit model table and a conservative unknown-model fallback", () => {
    const known = createDeepSeekModelAdapter({
      env: { DEEPSEEK_API_KEY: "test" },
      model: "deepseek-v4-flash",
      transport: new FakeTransport(),
    });
    const unknown = createDeepSeekModelAdapter({
      env: { DEEPSEEK_API_KEY: "test" },
      model: "future-unknown",
      transport: new FakeTransport(),
    });
    expect(known.context).toMatchObject({
      contextWindowTokens: 1_048_576,
      contextWindowSource: "adapter-table",
    });
    expect(unknown.context).toMatchObject({
      contextWindowTokens: 32_768,
      contextWindowSource: "configured-fallback",
    });
  });

  it("rejects a missing API key without exposing a secret", () => {
    const forgeHome = path.join(
      tmpdir(),
      `forge-no-auth-deepseek-${process.pid}`,
    );
    expect(() => resolveDeepSeekApiKey({ FORGE_HOME: forgeHome })).toThrow(
      ModelConfigurationError,
    );
    expect(() =>
      resolveDeepSeekApiKey({
        FORGE_HOME: forgeHome,
        DEEPSEEK_API_KEY: "  ",
      }),
    ).toThrow("Missing DEEPSEEK_API_KEY");
  });

  it("uses explicit defaults and forwards normalized stream events", async () => {
    const transport = new FakeTransport();
    const adapter = createDeepSeekModelAdapter({
      env: { DEEPSEEK_API_KEY: "test-secret" },
      transport,
    });
    const events: ModelStreamEvent[] = [];

    for await (const event of adapter.stream(
      {
        prompt: "hello",
        conversation: [
          { role: "user", content: "previous" },
          { role: "assistant", content: "previous answer" },
        ],
      },
      new AbortController().signal,
    )) {
      events.push(event);
    }

    expect(transport.request).toEqual({
      apiKey: "test-secret",
      model: DEFAULT_DEEPSEEK_MODEL,
      thinking: "enabled",
      reasoningEffort: "high",
      prompt: "hello",
      conversation: [
        { role: "user", content: "previous" },
        { role: "assistant", content: "previous answer" },
      ],
    });
    expect(events.map((event) => event.type)).toEqual([
      "reasoning.delta",
      "text.delta",
      "finish",
    ]);
  });

  it("advertises and forwards image input for the vision model", async () => {
    const transport = new FakeTransport();
    const adapter = createDeepSeekModelAdapter({
      env: { DEEPSEEK_API_KEY: "test-secret" },
      model: "deepseek-v4-flash-vision-exp",
      transport,
    });
    const images = [
      {
        type: "base64" as const,
        mediaType: "image/png" as const,
        data: "iVBORw0KGgo=",
        filename: "screen.png",
      },
    ];

    for await (const _event of adapter.stream(
      { prompt: "inspect", images },
      new AbortController().signal,
    )) {
      // Consume the response.
    }

    expect(adapter.context).toMatchObject({
      contextWindowTokens: 1_048_576,
      contextWindowSource: "adapter-table",
    });
    expect(transport.request).toMatchObject({
      model: "deepseek-v4-flash-vision-exp",
      images,
    });
  });

  it("rejects image input for text-only DeepSeek models", () => {
    const adapter = createDeepSeekModelAdapter({
      env: { DEEPSEEK_API_KEY: "test-secret" },
      model: "deepseek-v4-pro",
      transport: new FakeTransport(),
    });
    expect(() =>
      adapter.stream(
        {
          prompt: "inspect",
          images: [{ type: "url", url: "https://example.com/a.png" }],
        },
        new AbortController().signal,
      ),
    ).toThrow("does not accept image input");
  });
});
