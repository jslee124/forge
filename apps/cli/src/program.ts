import { FORGE_VERSION } from "@forge/core";
import { DEFAULT_DEEPSEEK_MODEL } from "@forge/model-deepseek";
import { Command } from "commander";

import { type AskOptions, runAskFromCli } from "./ask.js";
import { runConfigCommand } from "./config-command.js";
import { runInspectFromCli } from "./inspect.js";
import { runPluginsCommand } from "./plugins-command.js";
import { type ResumeOptions, runResumeFromCli } from "./resume.js";
import { runTaskFromCli } from "./run.js";
import { runInteractiveFromCli } from "./session.js";

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
  readonly runInteractive?: (
    options: AskOptions,
    env: NodeJS.ProcessEnv,
  ) => Promise<number>;
  readonly setExitCode?: (exitCode: number) => void;
  readonly runConfig?: (
    mode: "show" | "validate",
    env: NodeJS.ProcessEnv,
  ) => Promise<number>;
  readonly runInspect?: (
    runId: string,
    env: NodeJS.ProcessEnv,
  ) => Promise<number>;
  readonly runResume?: (
    sessionId: string | undefined,
    options: ResumeOptions,
    env: NodeJS.ProcessEnv,
  ) => Promise<number>;
  readonly runPlugins?: (
    mode: "list" | "trust" | "untrust" | "run",
    options: {
      readonly yes?: boolean;
      readonly name?: string;
      readonly args?: readonly string[];
    },
    env: NodeJS.ProcessEnv,
  ) => Promise<number>;
}

export function createProgram(dependencies: ProgramDependencies = {}): Command {
  const env = dependencies.env ?? process.env;
  const { FORGE_MODEL, FORGE_THINKING } = env;
  const ask = dependencies.runAsk ?? runAskFromCli;
  const run = dependencies.runTask ?? runTaskFromCli;
  const interactive = dependencies.runInteractive ?? runInteractiveFromCli;
  const setExitCode =
    dependencies.setExitCode ??
    ((exitCode: number) => (process.exitCode = exitCode));
  const config =
    dependencies.runConfig ??
    ((mode: "show" | "validate", configEnv: NodeJS.ProcessEnv) =>
      runConfigCommand(mode, {
        cwd: process.cwd(),
        env: configEnv,
        stdout: process.stdout,
        stderr: process.stderr,
      }));
  const inspect = dependencies.runInspect ?? runInspectFromCli;
  const resume = dependencies.runResume ?? runResumeFromCli;
  const plugins =
    dependencies.runPlugins ??
    ((mode, options, pluginEnv) =>
      runPluginsCommand(mode, options, {
        cwd: process.cwd(),
        env: pluginEnv,
        stdout: process.stdout,
        stderr: process.stderr,
        isTTY: process.stdin.isTTY === true,
        confirm: async (prompt) => {
          const { createInterface } = await import("node:readline/promises");
          const readline = createInterface({
            input: process.stdin,
            output: process.stderr,
          });
          try {
            const answer = await readline.question(prompt);
            return /^(?:y|yes)$/iu.test(answer.trim());
          } finally {
            readline.close();
          }
        },
      }));
  const program = new Command()
    .name("forge")
    .description("A safe, observable, and evaluable coding agent")
    .enablePositionalOptions()
    .version(FORGE_VERSION)
    .showHelpAfterError()
    .option("--model <model>", "DeepSeek model ID")
    .option("--thinking <mode>", "thinking mode: enabled or disabled")
    .option(
      "--permission-profile <profile>",
      "permission profile: safe or workspace-write",
    )
    .action(async (options: AskOptions) => {
      setExitCode(await interactive(options, env));
    });

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
    .option("--model <model>", "DeepSeek model ID")
    .option("--thinking <mode>", "thinking mode: enabled or disabled")
    .option(
      "--permission-profile <profile>",
      "permission profile: safe or workspace-write",
    )
    .option("--max-steps <count>", "maximum model steps", parsePositiveInteger)
    .option(
      "--max-tool-calls <count>",
      "maximum tool calls",
      parsePositiveInteger,
    )
    .option(
      "--command-timeout-ms <milliseconds>",
      "maximum command duration",
      parsePositiveInteger,
    )
    .option(
      "--max-tool-output-bytes <bytes>",
      "maximum retained tool output",
      parsePositiveInteger,
    )
    .action(async (prompt: string, options: AskOptions) => {
      setExitCode(await run(prompt, options, env));
    });

  const configCommand = program
    .command("config")
    .description("Inspect and validate effective Forge configuration");
  configCommand
    .command("show")
    .description("Show effective values and their sources")
    .action(async () => setExitCode(await config("show", env)));
  configCommand
    .command("validate")
    .description("Validate user and project configuration")
    .action(async () => setExitCode(await config("validate", env)));

  program
    .command("inspect")
    .description("Inspect a persisted run trace")
    .argument("<run-id>", "run UUID")
    .action(async (runId: string) => {
      setExitCode(await inspect(runId, env));
    });

  program
    .command("resume")
    .description("Resume a persisted interactive session")
    .argument("[session-id]", "session UUID")
    .option("--last", "resume the latest session in this workspace")
    .option("--model <model>", "DeepSeek model ID")
    .option("--thinking <mode>", "thinking mode: enabled or disabled")
    .option(
      "--permission-profile <profile>",
      "permission profile: safe or workspace-write",
    )
    .action(async (sessionId: string | undefined, options: ResumeOptions) => {
      setExitCode(await resume(sessionId, options, env));
    });

  const pluginsCommand = program
    .command("plugins")
    .description("Inspect, trust, and run trusted plugins");
  pluginsCommand
    .command("list")
    .description("List discovered plugins and portable skills")
    .action(async () => setExitCode(await plugins("list", {}, env)));
  pluginsCommand
    .command("trust")
    .description("Trust project-local plugins for this canonical workspace")
    .option("--yes", "record an explicit non-interactive trust decision")
    .action(async (options: { readonly yes?: boolean }) =>
      setExitCode(await plugins("trust", options, env)),
    );
  pluginsCommand
    .command("untrust")
    .description("Remove project-plugin trust for this workspace")
    .action(async () => setExitCode(await plugins("untrust", {}, env)));
  pluginsCommand
    .command("run")
    .description("Run a command registered by a trusted plugin")
    .argument("<name>", "registered plugin command")
    .argument("[args...]", "arguments passed to the plugin command")
    .action(async (name: string, args: readonly string[]) =>
      setExitCode(await plugins("run", { name, args }, env)),
    );

  return program;
}

function parsePositiveInteger(value: string): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`Expected a positive integer, received "${value}".`);
  }
  return parsed;
}
