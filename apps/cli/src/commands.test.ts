import { describe, expect, it } from "vitest";

import {
  filterSlashCommands,
  formatSlashCommandHelp,
  SLASH_COMMANDS,
} from "./commands.js";

describe("slash command registry", () => {
  it("drives both completion and help", () => {
    expect(filterSlashCommands("/c").map(({ name }) => name)).toEqual([
      "/clear",
    ]);
    for (const command of SLASH_COMMANDS) {
      expect(formatSlashCommandHelp()).toContain(command.name);
      expect(formatSlashCommandHelp()).toContain(command.description);
    }
  });
});
