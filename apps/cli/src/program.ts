import { FORGE_VERSION } from "@forge/core";
import { DEFAULT_DEEPSEEK_MODEL } from "@forge/model-deepseek";
import { Command } from "commander";

import { type AskOptions, runAskFromCli } from "./ask.js";
import { runTaskFromCli } from "./run.js";

export interface ProgramDependencies {
  readonly env?: NodeJS.ProcessEnv;
  readonly runAsk?: (
    prompt: string,
    options: AskOptions,
    env: NodeJS.ProcessEnv,
  ) => Promise<number>;
  readonly runTask?: (
    prompt: string,
    options: AskOptions,
    env: NodeJS.ProcessEnv,
  ) => Promise<number>;
  readonly setExitCode?: (exitCode: number) => void;
}

export function createProgram(dependencies: ProgramDependencies = {}): Command {
  const env = dependencies.env ?? process.env;
  const { FORGE_MODEL, FORGE_THINKING } = env;
  const ask = dependencies.runAsk ?? runAskFromCli;
  const run = dependencies.runTask ?? runTaskFromCli;
  const setExitCode =
    dependencies.setExitCode ??
    ((exitCode: number) => (process.exitCode = exitCode));
  const program = new Command()
    .name("forge")
    .description("A safe, observable, and evaluable coding agent")
    .version(FORGE_VERSION)
    .showHelpAfterError();

  program
    .command("ask")
    .description("Send one prompt to DeepSeek and stream the response")
    .argument("<prompt>", "prompt to send to the model")
    .option(
      "--model <model>",
      "DeepSeek model ID",
      FORGE_MODEL ?? DEFAULT_DEEPSEEK_MODEL,
    )
    .option(
      "--thinking <mode>",
      "thinking mode: enabled or disabled",
      FORGE_THINKING ?? "enabled",
    )
    .action(async (prompt: string, options: AskOptions) => {
      setExitCode(await ask(prompt, options, env));
    });

  program
    .command("run")
    .description("Run a safe multi-step coding-agent task")
    .argument("<prompt>", "repository task for Forge")
    .option(
      "--model <model>",
      "DeepSeek model ID",
      FORGE_MODEL ?? DEFAULT_DEEPSEEK_MODEL,
    )
    .option(
      "--thinking <mode>",
      "thinking mode: enabled or disabled",
      FORGE_THINKING ?? "enabled",
    )
    .action(async (prompt: string, options: AskOptions) => {
      setExitCode(await run(prompt, options, env));
    });

  return program;
}
