import {
  filterSlashCommands,
  formatSlashCommandHelp,
  SLASH_COMMANDS,
} from "@forge/application/slash-commands";
import { describe, expect, it } from "vitest";

describe("slash command registry", () => {
  it("drives both completion and help", () => {
    expect(filterSlashCommands("/c").map(({ name }) => name)).toEqual([
      "/clear",
      "/context",
      "/compact",
    ]);
    expect(filterSlashCommands("/n").map(({ name }) => name)).toEqual(["/new"]);
    for (const command of SLASH_COMMANDS) {
      expect(formatSlashCommandHelp()).toContain(command.name);
      expect(formatSlashCommandHelp()).toContain(command.description);
    }
  });
});
