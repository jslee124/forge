import { FORGE_VERSION } from "@forge/core";
import { Command } from "commander";

import { type AskOptions, runAskFromCli } from "./ask.js";
import {
  type CodexAuthOptions,
  runCodexAuthFromCli,
  runCodexModelsFromCli,
  runCodexTaskFromCli,
} from "./codex-command.js";
import { runConfigCommand } from "./config-command.js";
import { runInspectFromCli } from "./inspect.js";
import { runPluginsCommand } from "./plugins-command.js";
import { type ResumeOptions, runResumeFromCli } from "./resume.js";
import { runTaskFromCli } from "./run.js";
import { runInteractiveFromCli } from "./session.js";
import { maybeNotifyUpdate, runUpdateCommand } from "./update.js";

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
  readonly runCodex?: (
    prompt: string,
    options: AskOptions,
    env: NodeJS.ProcessEnv,
  ) => Promise<number>;
  readonly runAuth?: (
    mode: "login" | "status" | "logout",
    provider: string,
    options: CodexAuthOptions,
    env: NodeJS.ProcessEnv,
  ) => Promise<number>;
  readonly runModels?: (
    provider: string,
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
  readonly runUpdate?: (
    mode: "check" | "install",
    options: { readonly target?: string },
    env: NodeJS.ProcessEnv,
  ) => Promise<number>;
  readonly notifyUpdate?: (env: NodeJS.ProcessEnv) => Promise<void>;
}

export function createProgram(dependencies: ProgramDependencies = {}): Command {
  const env = dependencies.env ?? process.env;
  const {
    FORGE_MODEL,
    FORGE_PROVIDER,
    FORGE_REASONING_EFFORT,
    FORGE_THINKING,
  } = env;
  const ask = dependencies.runAsk ?? runAskFromCli;
  const run = dependencies.runTask ?? runTaskFromCli;
  const codex = dependencies.runCodex ?? runCodexTaskFromCli;
  const auth = dependencies.runAuth ?? runCodexAuthFromCli;
  const models = dependencies.runModels ?? runCodexModelsFromCli;
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
  const update =
    dependencies.runUpdate ??
    ((mode, options, updateEnv) =>
      runUpdateCommand(mode, options, updateEnv, {
        stdout: process.stdout,
        stderr: process.stderr,
      }));
  const notifyUpdate =
    dependencies.notifyUpdate ??
    ((updateEnv) =>
      maybeNotifyUpdate({
        env: updateEnv,
        stderr: process.stderr,
        isTTY: process.stderr.isTTY === true,
      }));
  const program = new Command()
    .name("forge")
    .description("A safe, observable, and evaluable coding agent")
    .enablePositionalOptions()
    .version(FORGE_VERSION)
    .showHelpAfterError()
    .option(
      "--provider <provider>",
      "API provider: deepseek, openai, or a configured route",
    )
    .option("--model <model>", "model ID")
    .option(
      "--reasoning-effort <effort>",
      "reasoning effort supported by the selected model/provider",
    )
    .option("--thinking <mode>", "thinking mode: enabled or disabled")
    .option(
      "--permission-profile <profile>",
      "permission profile: safe or workspace-write",
    )
    .action(async (options: AskOptions) => {
      await notifyUpdate(env);
      setExitCode(await interactive(options, env));
    });

  program
    .command("ask")
    .description("Send one prompt through a configured API provider")
    .argument("<prompt>", "prompt to send to the model")
    .option("--model <model>", "model ID", FORGE_MODEL)
    .option(
      "--provider <provider>",
      "API provider: deepseek, openai, or a configured route",
      FORGE_PROVIDER,
    )
    .option(
      "--reasoning-effort <effort>",
      "reasoning effort supported by the selected model/provider",
      FORGE_REASONING_EFFORT,
    )
    .option(
      "--thinking <mode>",
      "thinking mode: enabled or disabled",
      FORGE_THINKING ?? "enabled",
    )
    .option("--image <source...>", "attach JPEG, PNG, GIF, or WebP images")
    .action(async (prompt: string, options: AskOptions) => {
      setExitCode(await ask(prompt, options, env));
    });

  program
    .command("run")
    .description("Run a safe multi-step coding-agent task")
    .argument("<prompt>", "repository task for Forge")
    .option(
      "--engine <engine>",
      "execution engine: forge or codex",
      parseEngine,
    )
    .option(
      "--provider <provider>",
      "Forge API provider: deepseek, openai, or a configured route",
    )
    .option("--model <model>", "model ID")
    .option(
      "--reasoning-effort <effort>",
      "reasoning effort supported by the selected model/provider",
    )
    .option("--thinking <mode>", "thinking mode: enabled or disabled")
    .option("--image <source...>", "attach JPEG, PNG, GIF, or WebP images")
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
    .option("--context-mode <mode>", "context mode: off, warn, or compact")
    .option(
      "--reserved-output-tokens <count>",
      "tokens reserved for model output",
      parsePositiveInteger,
    )
    .option(
      "--buffer-tokens <count>",
      "context estimation safety buffer",
      parsePositiveInteger,
    )
    .option(
      "--recent-tail-tokens <count>",
      "verbatim recent conversation budget",
      parsePositiveInteger,
    )
    .option(
      "--summary-target-tokens <count>",
      "checkpoint summary target",
      parsePositiveInteger,
    )
    .action(async (prompt: string, options: AskOptions) => {
      setExitCode(
        options.engine === "codex"
          ? await codex(prompt, options, env)
          : await run(prompt, options, env),
      );
    });

  program
    .command("codex")
    .description("Run a task with Codex using ChatGPT subscription access")
    .argument("<prompt>", "repository task for Codex")
    .option("--model <model>", "Codex model ID")
    .option(
      "--reasoning-effort <effort>",
      "reasoning effort supported by the selected model",
    )
    .option(
      "--permission-profile <profile>",
      "permission profile: safe or workspace-write",
    )
    .action(async (prompt: string, options: AskOptions) => {
      setExitCode(await codex(prompt, options, env));
    });

  const authCommand = program
    .command("auth")
    .description("Manage Forge model authentication");
  authCommand
    .command("login")
    .description("Sign in through the official Codex authentication flow")
    .argument("[provider]", "authentication provider", "openai")
    .option(
      "--method <method>",
      "login method: browser or device-code",
      parseLoginMethod,
      "browser",
    )
    .action(async (provider: string, options: CodexAuthOptions) => {
      setExitCode(await auth("login", provider, options, env));
    });
  authCommand
    .command("status")
    .description("Show the current authentication state")
    .argument("[provider]", "authentication provider", "openai")
    .action(async (provider: string) => {
      setExitCode(await auth("status", provider, {}, env));
    });
  authCommand
    .command("logout")
    .description("Sign out of the selected provider")
    .argument("[provider]", "authentication provider", "openai")
    .action(async (provider: string) => {
      setExitCode(await auth("logout", provider, {}, env));
    });

  const modelsCommand = program
    .command("models")
    .description("Discover models and reasoning capabilities");
  modelsCommand
    .command("list")
    .description("List available models")
    .option("--provider <provider>", "model provider", "openai")
    .action(async (options: { readonly provider: string }) => {
      setExitCode(await models(options.provider, env));
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
    .option(
      "--provider <provider>",
      "API provider: deepseek, openai, or a configured route",
    )
    .option("--model <model>", "model ID")
    .option("--reasoning-effort <effort>", "OpenAI API reasoning effort")
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

  program
    .command("update")
    .description("Check for or install Forge releases from npm")
    .argument("[target]", "semantic version, dist-tag, or check", "latest")
    .option("--check", "check without installing")
    .action(async (target: string, options: { readonly check?: boolean }) => {
      const checkOnly = options.check === true || target === "check";
      setExitCode(
        await update(
          checkOnly ? "check" : "install",
          { target: target === "check" ? "latest" : target },
          env,
        ),
      );
    });

  return program;
}

function parsePositiveInteger(value: string): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`Expected a positive integer, received "${value}".`);
  }
  return parsed;
}

function parseEngine(value: string): "forge" | "codex" {
  if (value === "forge" || value === "codex") return value;
  throw new Error(`Invalid engine "${value}". Use "forge" or "codex".`);
}

function parseLoginMethod(value: string): "browser" | "device-code" {
  if (value === "browser" || value === "device-code") return value;
  throw new Error(
    `Invalid login method "${value}". Use "browser" or "device-code".`,
  );
}
