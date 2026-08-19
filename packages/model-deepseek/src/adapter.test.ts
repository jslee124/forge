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
});
