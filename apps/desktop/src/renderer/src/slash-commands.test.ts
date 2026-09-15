import { describe, expect, it } from "vitest";
import { parseRunCommand } from "../../shared/run-protocol.js";
import { parseSlash, suggestions } from "./slash-commands.js";

describe("desktop input routing", () => {
  it("does not offer commands for embedded slashes or paths", () => {
    for (const text of [
      "read /help",
      "https://example.com",
      "/src/app.ts",
      "```\n/help\n```",
    ])
      expect(suggestions(text)).toEqual([]);
    expect(suggestions("/mo").map((x) => x[0])).toEqual(["model"]);
    expect(parseSlash("/compact --dry-run")).toEqual({
      name: "compact",
      args: "--dry-run",
    });
  });
  it("validates permission profiles before crossing the run boundary", () => {
    const request = {
      type: "start",
      requestId: "req",
      runId: "run",
      sessionId: "session",
      prompt: "test",
      engine: "native",
    };
    expect(
      parseRunCommand({ ...request, permissionProfile: "workspace-write" }),
    ).toBeDefined();
    expect(
      parseRunCommand({ ...request, permissionProfile: "unrestricted" }),
    ).toBeUndefined();
    expect(
      parseRunCommand({ ...request, permissionProfile: null }),
    ).toBeUndefined();
  });
});
