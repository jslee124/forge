import { spawn } from "node:child_process";
import { createInterface } from "node:readline/promises";
import type {
  CodexAuthOptions,
  CodexCommandDependencies,
} from "@forge/application/codex";
import * as service from "@forge/application/codex";
import { ForgeConfigError, loadForgeConfig } from "@forge/config";
import type { AskOptions } from "./ask.js";
import { terminalHyperlink } from "./hyperlink.js";
import { createSigintCancellationScope } from "./signals.js";

export * from "@forge/application/codex";

function terminalDependencies(
  dependencies: CodexCommandDependencies,
): CodexCommandDependencies {
  return {
    ...dependencies,
    openUrl: dependencies.openUrl ?? openExternalUrl,
    confirm: dependencies.confirm ?? confirmInTerminal,
    formatAuthLink:
      dependencies.formatAuthLink ??
      ((url) => terminalHyperlink(url, dependencies)),
  };
}
export const runCodexAuthCommand: typeof service.runCodexAuthCommand = (
  mode,
  provider,
  options,
  dependencies,
) =>
  service.runCodexAuthCommand(
    mode,
    provider,
    options,
    terminalDependencies(dependencies),
  );
export const runCodexModelsCommand = service.runCodexModelsCommand;
export const runCodexTask: typeof service.runCodexTask = (
  prompt,
  options,
  dependencies,
) => service.runCodexTask(prompt, options, terminalDependencies(dependencies));
export async function runCodexAuthFromCli(
  mode: "login" | "status" | "logout",
  provider: string,
  options: CodexAuthOptions,
  env: NodeJS.ProcessEnv = process.env,
): Promise<number> {
  return withCliDependencies(env, (dependencies) =>
    runCodexAuthCommand(mode, provider, options, dependencies),
  );
}

export async function runCodexModelsFromCli(
  provider: string,
  env: NodeJS.ProcessEnv = process.env,
): Promise<number> {
  return withCliDependencies(env, (dependencies) =>
    runCodexModelsCommand(provider, dependencies),
  );
}

export async function runCodexTaskFromCli(
  prompt: string,
  options: AskOptions,
  env: NodeJS.ProcessEnv = process.env,
): Promise<number> {
  try {
    const loaded = await loadForgeConfig({
      cwd: process.cwd(),
      env,
      cli: options,
    });
    return withCliDependencies(env, (dependencies) =>
      runCodexTask(
        prompt,
        {
          ...options,
          contextMode: loaded.config.context.mode,
          reservedOutputTokens: loaded.config.context.reservedOutputTokens,
          bufferTokens: loaded.config.context.bufferTokens,
          recentTailTokens: loaded.config.context.recentTailTokens,
          summaryTargetTokens: loaded.config.context.summaryTargetTokens,
        },
        dependencies,
      ),
    );
  } catch (error) {
    if (error instanceof ForgeConfigError) {
      process.stderr.write(`Configuration error: ${error.message}\n`);
      return 2;
    }
    throw error;
  }
}

async function withCliDependencies(
  env: NodeJS.ProcessEnv,
  operation: (dependencies: CodexCommandDependencies) => Promise<number>,
): Promise<number> {
  const cancellation = createSigintCancellationScope();
  try {
    return await operation({
      env,
      cwd: process.cwd(),
      stdout: process.stdout,
      stderr: process.stderr,
      signal: cancellation.signal,
      isTTY: process.stdin.isTTY === true && process.stderr.isTTY === true,
    });
  } finally {
    cancellation.dispose();
  }
}

async function openExternalUrl(url: string): Promise<void> {
  const parsed = new URL(url);
  if (parsed.protocol !== "https:") {
    throw new Error("Refusing to open a non-HTTPS authentication URL.");
  }
  const command =
    process.platform === "darwin"
      ? { file: "open", args: [url] }
      : process.platform === "win32"
        ? {
            file: "rundll32",
            args: ["url.dll,FileProtocolHandler", url],
          }
        : { file: "xdg-open", args: [url] };
  await new Promise<void>((resolve, reject) => {
    const child = spawn(command.file, command.args, {
      detached: true,
      stdio: "ignore",
    });
    child.once("error", reject);
    child.once("spawn", () => {
      child.unref();
      resolve();
    });
  });
}

async function confirmInTerminal(prompt: string): Promise<boolean> {
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
}
