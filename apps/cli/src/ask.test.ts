import { tmpdir } from "node:os";
import path from "node:path";
import {
  type ModelAdapter,
  ModelProviderError,
  type ModelStreamEvent,
} from "@forge/core";
import { describe, expect, it } from "vitest";

import { runAsk } from "./ask.js";

function adapterFrom(events: readonly ModelStreamEvent[]): ModelAdapter {
  return {
    async *stream() {
      for (const event of events) {
        yield event;
      }
    },
  };
}

function outputBuffer(): {
  readonly output: { write(chunk: string): void };
  read(): string;
} {
  let value = "";

  return {
    output: {
      write(chunk: string) {
        value += chunk;
      },
    },
    read: () => value,
  };
}

describe("forge ask", () => {
  it("renders reasoning and answer separately and reports usage", async () => {
    const stdout = outputBuffer();
    const stderr = outputBuffer();
    const adapter = adapterFrom([
      { type: "reasoning.delta", text: "inspect" },
      { type: "text.delta", text: "hello" },
      {
        type: "finish",
        finishReason: "stop",
        usage: {
          inputTokens: 4,
          outputTokens: 2,
          reasoningTokens: 1,
          cachedInputTokens: 3,
          cacheWriteTokens: 0,
          totalTokens: 6,
        },
      },
    ]);

    const exitCode = await runAsk(
      "hello",
      {},
      {
        env: { DEEPSEEK_API_KEY: "test-secret" },
        stdout: stdout.output,
        stderr: stderr.output,
        signal: new AbortController().signal,
        createAdapter: () => adapter,
      },
    );

    expect(exitCode).toBe(0);
    expect(stdout.read()).toBe("[reasoning]\ninspect\n[answer]\nhello\n");
    expect(stderr.read()).toContain(
      "[usage] input=4 output=2 reasoning=1 cached=3 total=6",
    );
  });

  it("returns exit code 2 for a missing API key without a stack trace", async () => {
    const stdout = outputBuffer();
    const stderr = outputBuffer();

    const exitCode = await runAsk(
      "hello",
      {},
      {
        env: {
          FORGE_HOME: path.join(tmpdir(), `forge-no-auth-ask-${process.pid}`),
        },
        stdout: stdout.output,
        stderr: stderr.output,
        signal: new AbortController().signal,
      },
    );

    expect(exitCode).toBe(2);
    expect(stdout.read()).toBe("");
    expect(stderr.read()).toContain("Missing DEEPSEEK_API_KEY");
    expect(stderr.read()).not.toContain("at ");
  });

  it("returns exit code 1 for a safe provider error", async () => {
    const stdout = outputBuffer();
    const stderr = outputBuffer();
    const adapter: ModelAdapter = {
      async *stream(): AsyncIterable<ModelStreamEvent> {
        yield* [];
        throw new ModelProviderError("DeepSeek is unavailable.", {
          provider: "deepseek",
          retryable: true,
        });
      },
    };

    const exitCode = await runAsk(
      "hello",
      {},
      {
        env: { DEEPSEEK_API_KEY: "test-secret" },
        stdout: stdout.output,
        stderr: stderr.output,
        signal: new AbortController().signal,
        createAdapter: () => adapter,
      },
    );

    expect(exitCode).toBe(1);
    expect(stderr.read()).toBe("Provider error: DeepSeek is unavailable.\n");
  });

  it("returns exit code 130 for an aborted stream", async () => {
    const stdout = outputBuffer();
    const stderr = outputBuffer();
    const adapter = adapterFrom([{ type: "abort", reason: "SIGINT" }]);

    const exitCode = await runAsk(
      "hello",
      {},
      {
        env: { DEEPSEEK_API_KEY: "test-secret" },
        stdout: stdout.output,
        stderr: stderr.output,
        signal: new AbortController().signal,
        createAdapter: () => adapter,
      },
    );

    expect(exitCode).toBe(130);
    expect(stderr.read()).toBe("Cancelled.\n");
  });
});
