import { ModelConfigurationError } from "@forge/core";
import { afterEach, describe, expect, it, vi } from "vitest";

import { createMiMoModelAdapter, miMoModelContext } from "./index.js";
import type { MiMoTransportRequest } from "./transport.js";

afterEach(() => vi.unstubAllEnvs());

describe("MiMo model adapter", () => {
  it("uses only the explicitly passed environment for the key and endpoint", async () => {
    vi.stubEnv("MIMO_API_KEY", "wrong-global-key");
    vi.stubEnv("MIMO_BASE_URL", "https://wrong.invalid/v1");
    let captured: MiMoTransportRequest | undefined;
    const adapter = createMiMoModelAdapter({
      env: {
        MIMO_API_KEY: "explicit-key",
        MIMO_BASE_URL: "https://mimo.example/v1/",
      },
      transport: {
        async *stream(request) {
          captured = request;
          yield { type: "abort" as const };
        },
      },
    });

    for await (const _event of adapter.stream(
      { prompt: "hello" },
      new AbortController().signal,
    )) {
      // The mock transport makes no network request.
    }

    expect(captured).toMatchObject({
      apiKey: "explicit-key",
      baseURL: "https://mimo.example/v1",
      model: "mimo-v2.5",
      reasoningEffort: "medium",
    });
  });

  it("uses an exact Agent-model context table and conservative fallbacks", () => {
    expect(miMoModelContext("mimo-v2.5")).toEqual({
      window: 1_048_576,
      output: 131_072,
    });
    expect(miMoModelContext("mimo-v2.5-pro")).toEqual({
      window: 1_048_576,
      output: 131_072,
    });
    expect(miMoModelContext("mimo-v2.5-asr")).toBeUndefined();
    expect(miMoModelContext("mimo-v2.5-tts")).toBeUndefined();
    expect(miMoModelContext("mimo-v2.5-future")).toBeUndefined();

    const adapter = createMiMoModelAdapter({
      env: { MIMO_API_KEY: "test" },
      model: "mimo-v2.5-asr",
      transport: { async *stream() {} },
    });
    expect(adapter.context).toMatchObject({
      contextWindowTokens: 32_768,
      maxOutputTokens: 4_096,
      contextWindowSource: "configured-fallback",
    });
  });

  it("accepts images only for the confirmed mimo-v2.5 model", () => {
    const image = {
      type: "base64" as const,
      mediaType: "image/png" as const,
      data: "AA==",
    };
    const transport = { async *stream() {} };
    const vision = createMiMoModelAdapter({
      env: { MIMO_API_KEY: "test" },
      model: "mimo-v2.5",
      transport,
    });
    expect(() =>
      vision.stream(
        { prompt: "describe", images: [image] },
        new AbortController().signal,
      ),
    ).not.toThrow();

    const pro = createMiMoModelAdapter({
      env: { MIMO_API_KEY: "test" },
      model: "mimo-v2.5-pro",
      transport,
    });
    expect(() =>
      pro.stream(
        { prompt: "describe", images: [image] },
        new AbortController().signal,
      ),
    ).toThrow(ModelConfigurationError);
  });
});
