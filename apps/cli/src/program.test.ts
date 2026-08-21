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
    expect(program.commands.map((command) => command.name())).toContain(
      "inspect",
    );
    expect(program.commands.map((command) => command.name())).toContain(
      "resume",
    );
    expect(program.commands.map((command) => command.name())).toContain("auth");
    expect(program.commands.map((command) => command.name())).toContain(
      "models",
    );
    expect(program.commands.map((command) => command.name())).toContain(
      "codex",
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
    let receivedImages: readonly string[] | undefined;
    let exitCode: number | undefined;
    const program = createProgram({
      env: { DEEPSEEK_API_KEY: "test-secret" },
      runTask: async (prompt, options) => {
        receivedPrompt = `${prompt}:${options.thinking}`;
        receivedImages = options.image;
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
      "--image",
      "screen.png",
      "https://example.com/reference.webp",
    ]);

    expect(receivedPrompt).toBe("inspect repository:disabled");
    expect(receivedImages).toEqual([
      "screen.png",
      "https://example.com/reference.webp",
    ]);
    expect(exitCode).toBe(3);
  });

  it("routes the Codex engine with model and reasoning selection", async () => {
    let received: string | undefined;
    let exitCode: number | undefined;
    const program = createProgram({
      env: {},
      runCodex: async (prompt, options) => {
        received = `${prompt}:${options.model}:${options.reasoningEffort}`;
        return 0;
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
      "--engine",
      "codex",
      "--model",
      "gpt-test",
      "--reasoning-effort",
      "high",
    ]);

    expect(received).toBe("inspect repository:gpt-test:high");
    expect(exitCode).toBe(0);
  });

  it("routes auth and model discovery commands", async () => {
    const received: string[] = [];
    const program = createProgram({
      env: {},
      runAuth: async (mode, provider, options) => {
        received.push(`${mode}:${provider}:${options.method ?? "none"}`);
        return 0;
      },
      runModels: async (provider) => {
        received.push(`models:${provider}`);
        return 0;
      },
      setExitCode: () => undefined,
    });

    await program.parseAsync([
      "node",
      "forge",
      "auth",
      "login",
      "openai",
      "--method",
      "device-code",
    ]);
    await program.parseAsync([
      "node",
      "forge",
      "models",
      "list",
      "--provider",
      "openai",
    ]);

    expect(received).toEqual(["login:openai:device-code", "models:openai"]);
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

  it("routes inspect and resume commands", async () => {
    const received: string[] = [];
    let exitCode: number | undefined;
    const program = createProgram({
      env: { FORGE_HOME: "/tmp/forge-test-home" },
      runInspect: async (runId) => {
        received.push(`inspect:${runId}`);
        return 0;
      },
      runResume: async (sessionId, options) => {
        received.push(`resume:${sessionId ?? "last"}:${options.last === true}`);
        return 0;
      },
      setExitCode: (value) => {
        exitCode = value;
      },
    });

    await program.parseAsync(["node", "forge", "inspect", "run-id"]);
    await program.parseAsync(["node", "forge", "resume", "--last"]);

    expect(received).toEqual(["inspect:run-id", "resume:last:true"]);
    expect(exitCode).toBe(0);
  });
});
