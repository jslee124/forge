import { loadPluginHost } from "@forge/plugin-api";
import { describe, expect, it } from "vitest";

describe("example-plugin", () => {
  it("activates through the real host and registers its declared tool", async () => {
    const host = await loadPluginHost({
      forgeHome: process.env.FORGE_HOME ?? "",
      workspaceRoot: process.cwd(),
      enabledUserPlugins: ["example-plugin"],
    });

    expect(host.tools.map(({ name }) => name)).toContain("example_tool");
  });
});
