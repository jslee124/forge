import { describe, expect, it } from "vitest";

import { FORGE_VERSION } from "./index.js";

describe("Forge core", () => {
  it("exposes a semantic version for the CLI", () => {
    expect(FORGE_VERSION).toMatch(/^\d+\.\d+\.\d+$/);
  });
});
