import { FORGE_VERSION } from "@forge/core";
import { Command } from "commander";

export function createProgram(): Command {
  return new Command()
    .name("forge")
    .description("A safe, observable, and evaluable coding agent")
    .version(FORGE_VERSION)
    .showHelpAfterError();
}
