import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { createCompatModelAdapter } from "./index.js";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe("createCompatModelAdapter", () => {
  it("creates an auth-none adapter without any stored credential", async () => {
    const forgeHome = await mkdtemp(path.join(tmpdir(), "forge-compat-"));
    temporaryDirectories.push(forgeHome);
    let apiKeyPresent = true;
    const adapter = createCompatModelAdapter({
      env: { FORGE_HOME: forgeHome },
      route: "ollama",
      profile: {
        api: "openai-completions",
        baseUrl: "http://localhost:11434/v1",
        auth: { type: "none" },
        models: [{ id: "qwen3", reasoningGears: false }],
      },
      model: "qwen3",
      reasoningEffort: "none",
      transport: {
        async *stream(request) {
          apiKeyPresent = "apiKey" in request;
          yield {
            type: "finish",
            finishReason: "stop",
            usage: {
              inputTokens: 1,
              outputTokens: 1,
              reasoningTokens: undefined,
              cachedInputTokens: undefined,
              cacheWriteTokens: undefined,
              totalTokens: 2,
            },
          };
        },
      },
    });

    for await (const _event of adapter.stream(
      { prompt: "hello" },
      new AbortController().signal,
    )) {
      // consume
    }
    expect(apiKeyPresent).toBe(false);
  });
});
