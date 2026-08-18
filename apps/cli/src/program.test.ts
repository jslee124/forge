import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import { FORGE_VERSION } from "@forge/core";
import { describe, expect, it } from "vitest";

import { createProgram } from "./program.js";

const cliPath = fileURLToPath(new URL("../dist/index.js", import.meta.url));

describe("Forge CLI", () => {
  it("exposes its name and version", () => {
    const program = createProgram();

    expect(program.name()).toBe("forge");
    expect(program.version()).toBe(FORGE_VERSION);
    expect(program.commands.map((command) => command.name())).toContain("ask");
    expect(program.commands.map((command) => command.name())).toContain("run");
    expect(program.commands.map((command) => command.name())).toContain(
      "config",
    );
  });

  it("passes model options and environment to the ask command", async () => {
    let received:
      | {
          prompt: string;
          model: string | undefined;
          thinking: string | undefined;
          apiKey: string | undefined;
        }
      | undefined;
    let exitCode: number | undefined;
    const env = {
      DEEPSEEK_API_KEY: "test-secret",
      FORGE_MODEL: "deepseek-v4-pro",
      FORGE_THINKING: "disabled",
    };
    const program = createProgram({
      env,
      runAsk: async (prompt, options, receivedEnv) => {
        const { DEEPSEEK_API_KEY } = receivedEnv;
        received = {
          prompt,
          model: options.model,
          thinking: options.thinking,
          apiKey: DEEPSEEK_API_KEY,
        };
        return 0;
      },
      setExitCode: (value) => {
        exitCode = value;
      },
    });

    await program.parseAsync(["node", "forge", "ask", "hello"]);

    expect(received).toEqual({
      prompt: "hello",
      model: "deepseek-v4-pro",
      thinking: "disabled",
      apiKey: "test-secret",
    });
    expect(exitCode).toBe(0);
  });

  it("routes the run command through the native runtime entry point", async () => {
    let receivedPrompt: string | undefined;
    let exitCode: number | undefined;
    const program = createProgram({
      env: { DEEPSEEK_API_KEY: "test-secret" },
      runTask: async (prompt, options) => {
        receivedPrompt = `${prompt}:${options.thinking}`;
        return 3;
      },
      setExitCode: (value) => {
        exitCode = value;
      },
    });

    await program.parseAsync([
      "node",
      "forge",
      "run",
      "inspect repository",
      "--thinking",
      "disabled",
    ]);

    expect(receivedPrompt).toBe("inspect repository:disabled");
    expect(exitCode).toBe(3);
  });

  it("starts the interactive session when no subcommand is provided", async () => {
    let received:
      | {
          readonly model: string | undefined;
          readonly thinking: string | undefined;
          readonly apiKey: string | undefined;
        }
      | undefined;
    let exitCode: number | undefined;
    const program = createProgram({
      env: {
        DEEPSEEK_API_KEY: "test-secret",
        FORGE_MODEL: "deepseek-v4-pro",
        FORGE_THINKING: "disabled",
      },
      runInteractive: async (options, env) => {
        const { DEEPSEEK_API_KEY } = env;
        received = {
          model: options.model,
          thinking: options.thinking,
          apiKey: DEEPSEEK_API_KEY,
        };
        return 0;
      },
      setExitCode: (value) => {
        exitCode = value;
      },
    });

    await program.parseAsync(["node", "forge"]);

    expect(received).toEqual({
      model: undefined,
      thinking: undefined,
      apiKey: "test-secret",
    });
    expect(exitCode).toBe(0);
  });

  it("runs the compiled version command", () => {
    const output = execFileSync(process.execPath, [cliPath, "--version"], {
      encoding: "utf8",
    });

    expect(output.trim()).toBe(FORGE_VERSION);
  });

  it("routes config show without starting a model command", async () => {
    let received: string | undefined;
    let exitCode: number | undefined;
    const program = createProgram({
      env: { FORGE_HOME: "/tmp/forge-test-home" },
      runConfig: async (mode, env) => {
        const { FORGE_HOME } = env;
        received = `${mode}:${FORGE_HOME}`;
        return 0;
      },
      setExitCode: (value) => {
        exitCode = value;
      },
    });

    await program.parseAsync(["node", "forge", "config", "show"]);

    expect(received).toBe("show:/tmp/forge-test-home");
    expect(exitCode).toBe(0);
  });
});
