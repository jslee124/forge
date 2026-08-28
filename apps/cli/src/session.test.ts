import { PassThrough } from "node:stream";
import type { ApprovalChannel, ForgeTool, RunResult } from "@forge/core";
import { describe, expect, it } from "vitest";

import type { WritableOutput } from "./ask.js";
import {
  createReadlineTerminal,
  type InteractiveTerminal,
  runInteractiveSession,
} from "./session.js";

function outputBuffer(): {
  readonly output: WritableOutput;
  read(): string;
} {
  let value = "";
  return {
    output: { write: (chunk) => (value += chunk) },
    read: () => value,
  };
}

class FakeTerminal implements InteractiveTerminal {
  readonly questions: string[] = [];
  readonly #sigintListeners = new Set<() => void>();
  #mainInputs: string[];
  #approvalInputs: string[];
  closed = false;

  constructor(
    mainInputs: string[],
    approvalInputs: string[] = [],
    readonly isTTY = true,
  ) {
    this.#mainInputs = [...mainInputs];
    this.#approvalInputs = [...approvalInputs];
  }

  async question(prompt: string, signal?: AbortSignal): Promise<string | null> {
    this.questions.push(prompt);
    if (signal?.aborted || this.closed) {
      return null;
    }
    return prompt === "forge> "
      ? (this.#mainInputs.shift() ?? null)
      : (this.#approvalInputs.shift() ?? "n");
  }

  onSigint(listener: () => void): void {
    this.#sigintListeners.add(listener);
  }

  offSigint(listener: () => void): void {
    this.#sigintListeners.delete(listener);
  }

  emitSigint(): void {
    for (const listener of this.#sigintListeners) {
      listener();
    }
  }

  close(): void {
    this.closed = true;
  }
}

function completed(finalText: string): RunResult {
  return {
    status: "completed",
    exitCode: 0,
    finalText,
    modelSteps: 1,
    toolCalls: 0,
    events: [],
  };
}

describe("interactive Forge session", () => {
  it("settles a pending prompt when the terminal closes", async () => {
    const input = new PassThrough() as PassThrough & { isTTY: boolean };
    input.isTTY = true;
    const output = new PassThrough();
    const terminal = await createReadlineTerminal(input, output);

    const pending = terminal.question("forge> ");
    terminal.close();

    await expect(pending).resolves.toBeNull();
  });

  it("preserves multi-turn context and clears it with slash commands", async () => {
    const terminal = new FakeTerminal([
      "first task",
      "second task",
      "/clear",
      "third task",
      "/help",
      "/unknown",
      "/exit",
    ]);
    const stdout = outputBuffer();
    const stderr = outputBuffer();
    const received: Array<{
      readonly prompt: string;
      readonly conversation: unknown;
    }> = [];

    const exitCode = await runInteractiveSession(
      { model: "test-model", thinking: "disabled" },
      {
        env: { DEEPSEEK_API_KEY: "test-secret" },
        cwd: "/workspace",
        terminal,
        stdout: stdout.output,
        stderr: stderr.output,
        executeTask: async (prompt, _options, dependencies) => {
          received.push({
            prompt,
            conversation: dependencies.conversation,
          });
          dependencies.onResult?.(completed(`answer:${prompt}`));
          return 0;
        },
      },
    );

    expect(exitCode).toBe(0);
    expect(received).toEqual([
      { prompt: "first task", conversation: [] },
      {
        prompt: "second task",
        conversation: [
          { role: "user", content: "first task" },
          { role: "assistant", content: "answer:first task" },
        ],
      },
      { prompt: "third task", conversation: [] },
    ]);
    expect(stdout.read()).toContain("Conversation context cleared.");
    expect(stdout.read()).toContain("Interactive commands:");
    expect(stdout.read()).toContain("Unknown command: /unknown");
    expect(stdout.read()).toContain("Goodbye.");
    expect(stderr.read()).toBe("");
    expect(terminal.closed).toBe(true);
  });

  it("rejects bare Forge in a non-TTY environment", async () => {
    const terminal = new FakeTerminal([], [], false);
    const stdout = outputBuffer();
    const stderr = outputBuffer();
    let executions = 0;

    const exitCode = await runInteractiveSession(
      {},
      {
        env: {},
        cwd: "/workspace",
        terminal,
        stdout: stdout.output,
        stderr: stderr.output,
        executeTask: async () => {
          executions += 1;
          return 0;
        },
      },
    );

    expect(exitCode).toBe(2);
    expect(executions).toBe(0);
    expect(stderr.read()).toContain("Interactive mode requires a TTY");
    expect(terminal.closed).toBe(true);
  });

  it("provides a fresh approval channel for every task", async () => {
    const terminal = new FakeTerminal(
      ["first", "second", "/exit"],
      ["y", "yes"],
    );
    const stdout = outputBuffer();
    const stderr = outputBuffer();
    const channels: ApprovalChannel[] = [];
    const processTool = {
      name: "run_command",
      risk: "process",
    } as ForgeTool;

    await runInteractiveSession(
      {},
      {
        env: { DEEPSEEK_API_KEY: "test-secret" },
        cwd: "/workspace",
        terminal,
        stdout: stdout.output,
        stderr: stderr.output,
        executeTask: async (prompt, _options, dependencies) => {
          const channel = dependencies.approvalChannel;
          if (!channel) {
            throw new Error("Expected an approval channel.");
          }
          channels.push(channel);
          const approved = await channel.request(
            {
              call: {
                id: prompt,
                name: "run_command",
                input: {
                  program: "pnpm",
                  args: ["test"],
                  cwd: ".",
                  timeoutMs: 60_000,
                },
              },
              tool: processTool,
              input: {
                program: "pnpm",
                args: ["test"],
                cwd: ".",
                timeoutMs: 60_000,
              },
            },
            dependencies.signal,
            {
              workspace: { root: "/workspace", cwd: "/workspace" },
              signal: dependencies.signal,
              limits: { maxOutputBytes: 65_536, maxEntries: 200 },
            },
          );
          expect(approved).toBe(true);
          dependencies.onResult?.(completed(`answer:${prompt}`));
          return 0;
        },
      },
    );

    expect(channels).toHaveLength(2);
    expect(channels[0]).not.toBe(channels[1]);
    expect(
      terminal.questions.filter((prompt) => prompt.includes("1  Allow once")),
    ).toHaveLength(2);
    expect(stderr.read()).toContain("$ pnpm test");
    expect(stderr.read()).toContain("Working directory  .");
    expect(stderr.read()).toContain("Timeout            60s");
  });

  it("exits cleanly on end-of-input", async () => {
    const terminal = new FakeTerminal([]);
    const stdout = outputBuffer();
    const stderr = outputBuffer();

    const exitCode = await runInteractiveSession(
      {},
      {
        env: {},
        cwd: "/workspace",
        terminal,
        stdout: stdout.output,
        stderr: stderr.output,
      },
    );

    expect(exitCode).toBe(0);
    expect(terminal.closed).toBe(true);
    expect(stdout.read()).toContain("Goodbye.");
  });

  it("cancels an active task on Ctrl+C and returns to the session", async () => {
    const terminal = new FakeTerminal(["long task", "/exit"]);
    const stdout = outputBuffer();
    const stderr = outputBuffer();
    let cancelled = false;

    const exitCode = await runInteractiveSession(
      {},
      {
        env: { DEEPSEEK_API_KEY: "test-secret" },
        cwd: "/workspace",
        terminal,
        stdout: stdout.output,
        stderr: stderr.output,
        executeTask: async (_prompt, _options, dependencies) => {
          queueMicrotask(() => terminal.emitSigint());
          await new Promise<void>((resolve) => {
            dependencies.signal.addEventListener(
              "abort",
              () => {
                cancelled = true;
                resolve();
              },
              { once: true },
            );
          });
          return 130;
        },
      },
    );

    expect(exitCode).toBe(0);
    expect(cancelled).toBe(true);
    expect(
      terminal.questions.filter((prompt) => prompt === "forge> "),
    ).toHaveLength(2);
    expect(stderr.read()).toContain("Cancelling the active task");
  });

  it("exits on a second Ctrl+C while cancellation is in progress", async () => {
    const terminal = new FakeTerminal(["long task"]);
    const stdout = outputBuffer();
    const stderr = outputBuffer();

    const exitCode = await runInteractiveSession(
      {},
      {
        env: { DEEPSEEK_API_KEY: "test-secret" },
        cwd: "/workspace",
        terminal,
        stdout: stdout.output,
        stderr: stderr.output,
        executeTask: async (_prompt, _options, dependencies) => {
          queueMicrotask(() => {
            terminal.emitSigint();
            terminal.emitSigint();
          });
          await new Promise<void>((resolve) => {
            dependencies.signal.addEventListener("abort", () => resolve(), {
              once: true,
            });
          });
          return 130;
        },
      },
    );

    expect(exitCode).toBe(0);
    expect(terminal.closed).toBe(true);
    expect(stdout.read()).toContain("Goodbye.");
  });
});
