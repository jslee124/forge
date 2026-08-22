import { ModelConfigurationError } from "@forge/core";
import { describe, expect, it } from "vitest";

import { createForgeModelAdapter } from "./model-adapter.js";

describe("createForgeModelAdapter MiMo effort validation", () => {
  it.each(["none", "low", "medium", "high"] as const)(
    "accepts MiMo effort %s",
    (reasoningEffort) => {
      expect(() =>
        createForgeModelAdapter({
          env: { MIMO_API_KEY: "test" },
          provider: "mimo",
          model: "mimo-v2.5",
          thinking: "enabled",
          reasoningEffort,
        }),
      ).not.toThrow();
    },
  );

  it.each(["minimal", "xhigh", "max", "ultra"] as const)(
    "rejects unsupported MiMo effort %s before a request",
    (reasoningEffort) => {
      expect(() =>
        createForgeModelAdapter({
          env: { MIMO_API_KEY: "test" },
          provider: "mimo",
          model: "mimo-v2.5",
          thinking: "enabled",
          reasoningEffort,
        }),
      ).toThrow(ModelConfigurationError);
    },
  );
});
