import { describe, expect, it } from "vitest";
import { SLASH_COMMANDS as cliCommands } from "../../../apps/cli/src/commands.js";
import {
  commands as desktopCommands,
  routeCommand,
} from "../../../apps/desktop/src/renderer/src/slash-commands.js";
import {
  completeSlashCommand,
  parseSlashCommand,
  SLASH_COMMANDS,
} from "./slash-commands.js";

describe("shared command contract", () => {
  it("keeps both clients on the same sixteen-entry catalog", () => {
    expect(cliCommands).toEqual(SLASH_COMMANDS);
    expect(desktopCommands.map((x) => `/${x[0]}`)).toEqual(
      SLASH_COMMANDS.map((x) => x.name),
    );
    expect(new Set(SLASH_COMMANDS.map((x) => x.name)).size).toBe(16);
  });
  it("matches TUI argument and case rules", () => {
    for (const { name } of SLASH_COMMANDS)
      expect(parseSlashCommand(name)).toMatchObject({
        kind: "command",
        name,
        args: "",
      });
    expect(parseSlashCommand(" /compact --dry-run ")).toMatchObject({
      kind: "command",
      args: "--dry-run",
    });
    expect(parseSlashCommand("/effort HIGH")).toMatchObject({
      kind: "command",
      args: "high",
    });
    for (const input of [
      "/model foo",
      "/compact --DRY-RUN",
      "/compact  --dry-run",
      "/effort turbo",
      "/effort high extra",
    ])
      expect(parseSlashCommand(input)).toMatchObject({
        kind: "error",
        reason: "invalid-arguments",
      });
    for (const input of ["/HELP", "/unknown", "/src/file.ts", "/help\n/model"])
      expect(parseSlashCommand(input).kind).toBe("error");
    for (const input of [
      "read /help",
      "https://example.com",
      "```\n/help\n```",
      "hello",
    ])
      expect(parseSlashCommand(input).kind).toBe("message");
  });
  it("completes arguments without inventing executable commands", () => {
    expect(completeSlashCommand("/compact --d").map((x) => x.name)).toEqual([
      "/compact --dry-run",
    ]);
    expect(completeSlashCommand("/effort h").map((x) => x.name)).toEqual([
      "/effort high",
    ]);
    expect(completeSlashCommand("/effort ")).toHaveLength(7);
    expect(completeSlashCommand("/src/file.ts")).toEqual([]);
  });
  it("returns local results and blocks mutations during runs", () => {
    for (const name of ["/help", "/context"])
      expect(routeCommand(name, true).kind).toBe("read");
    for (const name of [
      "/new",
      "/clear",
      "/compact",
      "/model",
      "/permissions",
      "/resume",
      "/login",
      "/exit",
    ])
      expect(routeCommand(name, true)).toEqual({
        kind: "error",
        reason: "busy",
      });
    expect(routeCommand("/update-dismiss", false).kind).toBe("not-applicable");
    for (const input of ["/compact --dry-run", "/effort high", "/resources"])
      expect(routeCommand(input, false)).toEqual({
        kind: "error",
        reason: "unsupported",
      });
    expect(routeCommand("/model", false)).toEqual({
      kind: "open",
      target: "model",
    });
    expect(routeCommand("/clear", false)).toEqual({
      kind: "manage",
      target: "reset",
    });
    expect(routeCommand("/context", false)).toEqual({
      kind: "read",
      target: "context",
    });
  });
});
