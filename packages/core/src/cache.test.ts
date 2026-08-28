import { describe, expect, it } from "vitest";
import { z } from "zod";

import { observePromptPrefix, type PromptPrefixInputs } from "./index.js";

const base: PromptPrefixInputs = {
  provider: "fake",
  modelId: "fake-v1",
  coreContract: "forge-core-v1",
  instructions: ["Follow repository rules."],
  resourceCatalog: "skill-a: inspect code",
  enabledResourceIds: ["skill-a"],
  enabledPluginIds: ["plugin-a"],
  checkpointGeneration: "canonical",
};

const tool = {
  name: "read_file",
  description: "Read a file",
  inputSchema: z.object({ path: z.string() }),
};

describe("prompt-cache prefix observations", () => {
  it("keeps the prefix stable across user requests and tool-loop continuations", () => {
    const first = observePromptPrefix({
      request: { prompt: "first", tools: [tool] },
      inputs: base,
      capabilities: { mode: "automatic" },
    });
    const second = observePromptPrefix({
      request: {
        prompt: "a different request",
        tools: [tool],
        continuation: { provider: "fake", data: { step: 2 } },
        toolResults: [],
      },
      inputs: base,
      capabilities: { mode: "automatic" },
      previous: first,
    });

    expect(second.stablePrefixHash).toBe(first.stablePrefixHash);
    expect(second.invalidatedBy).toEqual([]);
  });

  it.each([
    ["provider-or-model", { modelId: "fake-v2" }],
    ["instructions", { instructions: ["Changed rules."] }],
    ["resource-catalog", { resourceCatalog: "skill-b: test code" }],
    ["enabled-resources", { enabledResourceIds: ["skill-b"] }],
    ["enabled-plugins", { enabledPluginIds: ["plugin-b"] }],
    ["checkpoint-generation", { checkpointGeneration: "checkpoint-2" }],
  ] as const)("records %s invalidation", (reason, change) => {
    const first = observePromptPrefix({
      request: { prompt: "same", tools: [tool] },
      inputs: base,
      capabilities: { mode: "unsupported" },
    });
    const second = observePromptPrefix({
      request: { prompt: "same", tools: [tool] },
      inputs: { ...base, ...change },
      capabilities: { mode: "unsupported" },
      previous: first,
    });
    expect(second.stablePrefixHash).not.toBe(first.stablePrefixHash);
    expect(second.invalidatedBy).toContain(reason);
  });

  it("emits a redacted keyed identity only for declared keyed caching", () => {
    const observation = observePromptPrefix({
      request: { prompt: "request", tools: [tool] },
      inputs: base,
      capabilities: { mode: "keyed", keyScope: "workspace" },
      workspaceRoot: "/secret/workspace",
    });
    expect(observation.cacheKey).toMatch(/^[a-f0-9]{64}$/u);
    expect(JSON.stringify(observation)).not.toContain("/secret/workspace");
  });

  it("invalidates when the advertised tool schema changes", () => {
    const first = observePromptPrefix({
      request: { prompt: "same", tools: [tool] },
      inputs: base,
      capabilities: { mode: "automatic" },
    });
    const second = observePromptPrefix({
      request: {
        prompt: "same",
        tools: [
          {
            ...tool,
            inputSchema: z.object({ path: z.string(), line: z.number() }),
          },
        ],
      },
      inputs: base,
      capabilities: { mode: "automatic" },
      previous: first,
    });
    expect(second.invalidatedBy).toContain("tool-schema");
  });
});
