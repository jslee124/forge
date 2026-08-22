import { describe, expect, it } from "vitest";

import {
  discoverModels,
  MAX_DISCOVERY_RESPONSE_BYTES,
  ModelDiscoveryError,
  readModelListing,
} from "./discovery.js";

describe("model discovery", () => {
  it("reads common capacity extensions, deduplicates, and bounds the catalog", () => {
    expect(
      readModelListing({
        data: [
          {
            id: "model-a",
            display_name: "Model A",
            context_length: 128_000,
            max_output_tokens: 8_192,
            capabilities: {
              reasoning: {
                efforts: ["none", "low", "high", "invented", "high"],
              },
            },
          },
          { id: "model-a" },
          { broken: true },
        ],
      }),
    ).toEqual([
      {
        id: "model-a",
        name: "Model A",
        contextWindow: 128_000,
        maxOutputTokens: 8_192,
        reasoningEfforts: ["none", "low", "high"],
      },
    ]);
  });

  it("accepts conservative reasoning metadata aliases without guessing", () => {
    expect(
      readModelListing({
        data: [
          { id: "one", reasoning_efforts: ["none", "medium"] },
          {
            id: "two",
            reasoning: { supported_efforts: ["low", "xhigh"] },
          },
          { id: "three", supported_parameters: ["reasoning"] },
        ],
      }),
    ).toEqual([
      { id: "one", reasoningEfforts: ["none", "medium"] },
      { id: "two", reasoningEfforts: ["low", "xhigh"] },
      { id: "three" },
    ]);
  });

  it("preserves the endpoint prefix and omits authorization for auth none", async () => {
    let url = "";
    let authorization: string | null = "unexpected";
    const models = await discoverModels({
      api: "openai-completions",
      baseUrl: "http://localhost:11434/openai/v1/",
      fetch: async (input, init) => {
        url = String(input);
        authorization = new Headers(init?.headers).get("authorization");
        return new Response(JSON.stringify({ data: [{ id: "qwen3" }] }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      },
    });
    expect(url).toBe("http://localhost:11434/openai/v1/models");
    expect(authorization).toBeNull();
    expect(models).toEqual([{ id: "qwen3" }]);
  });

  it("refuses oversized replies before reading the body", async () => {
    await expect(
      discoverModels({
        api: "openai-responses",
        baseUrl: "https://gateway.example/v1",
        apiKey: "secret",
        fetch: async () =>
          new Response("{}", {
            status: 200,
            headers: {
              "content-length": String(MAX_DISCOVERY_RESPONSE_BYTES + 1),
            },
          }),
      }),
    ).rejects.toBeInstanceOf(ModelDiscoveryError);
  });
});
