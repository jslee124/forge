import { describe, expect, it } from "vitest";

import {
  isLoopbackHost,
  ProviderEndpointError,
  parseProviderBaseUrl,
  providerUrl,
} from "./providers.js";
import { forgeConfigFileSchema } from "./schema.js";

describe("provider routes", () => {
  it("accepts TLS endpoints and loopback HTTP while preserving path prefixes", () => {
    expect(parseProviderBaseUrl(" https://gateway.example/openai/v1/ ")).toBe(
      "https://gateway.example/openai/v1",
    );
    expect(parseProviderBaseUrl("http://127.0.0.42:11434/v1/")).toBe(
      "http://127.0.0.42:11434/v1",
    );
    expect(providerUrl("https://gateway.example/openai/v1", "/models")).toBe(
      "https://gateway.example/openai/v1/models",
    );
    expect(isLoopbackHost("[::1]")).toBe(true);
  });

  it("rejects plaintext remote endpoints and URL-carried credentials", () => {
    expect(() => parseProviderBaseUrl("http://gateway.example/v1")).toThrow(
      ProviderEndpointError,
    );
    expect(() =>
      parseProviderBaseUrl("https://user:secret@gateway.example/v1"),
    ).toThrow(/must not embed/iu);
    expect(() =>
      parseProviderBaseUrl("https://gateway.example/v1?token=secret"),
    ).toThrow(/query/iu);
  });

  it("requires an explicit authentication mode and reserves built-in names", () => {
    const route = {
      api: "openai-completions",
      baseUrl: "http://localhost:11434/v1",
      auth: { type: "none" },
      models: [{ id: "qwen3", reasoningGears: false }],
    };
    expect(
      forgeConfigFileSchema.parse({
        schemaVersion: 1,
        providers: { ollama: route },
      }).providers,
    ).toEqual({ ollama: route });
    expect(() =>
      forgeConfigFileSchema.parse({
        schemaVersion: 1,
        providers: { openai: route },
      }),
    ).toThrow(/reserved/iu);
    expect(() =>
      forgeConfigFileSchema.parse({
        schemaVersion: 1,
        providers: {
          ollama: {
            api: "openai-completions",
            baseUrl: "http://localhost:11434/v1",
          },
        },
      }),
    ).toThrow(/auth/iu);
  });
});
