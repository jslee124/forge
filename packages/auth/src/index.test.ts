import { describe, expect, it } from "vitest";

import { AuthenticationManager } from "./index.js";

describe("AuthenticationManager", () => {
  it("resolves multiple API-key providers without persisting credentials", () => {
    const manager = new AuthenticationManager({
      DEEPSEEK_API_KEY: " deepseek-secret ",
      OPENAI_API_KEY: " openai-secret ",
    });

    expect(manager.requireApiKey("deepseek")).toMatchObject({
      provider: "deepseek",
      apiKey: "deepseek-secret",
      source: "environment",
    });
    expect(manager.requireApiKey("openai")).toMatchObject({
      provider: "openai",
      apiKey: "openai-secret",
      source: "environment",
    });
  });

  it("explains that ChatGPT subscription access is a different path", () => {
    expect(() => new AuthenticationManager({}).requireApiKey("openai")).toThrow(
      /forge codex.*subscription access/iu,
    );
  });
});
