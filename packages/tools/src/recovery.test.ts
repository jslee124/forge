import { cp, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import {
  type ModelAdapter,
  type ModelRequest,
  type ModelStreamEvent,
  runAgent,
  WorkspaceWritePolicy,
} from "@forge/core";
import { afterEach, describe, expect, it } from "vitest";

import { builtinTools, resolveWorkspace } from "./index.js";

const temporaryDirectories: string[] = [];
const usage = {
  inputTokens: 1,
  outputTokens: 1,
  reasoningTokens: 0,
  cachedInputTokens: 0,
  cacheWriteTokens: 0,
  totalTokens: 2,
};

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

class RecoveryModel implements ModelAdapter {
  readonly requests: ModelRequest[] = [];

  async *stream(request: ModelRequest): AsyncIterable<ModelStreamEvent> {
    this.requests.push(request);
    const step = this.requests.length;
    if (step === 1) {
      yield toolCall("read-implementation", "read_file", {
        path: "src/parse-port.ts",
      });
      yield toolCall("read-caller", "read_file", {
        path: "src/server-config.ts",
      });
      yield toolCall("read-tests", "read_file", {
        path: "test/parse-port.test.ts",
      });
      yield finish(step);
      return;
    }
    if (step === 2) {
      yield toolCall("incomplete-patch", "edit_file", {
        operation: "replace",
        path: "src/parse-port.ts",
        edits: [
          {
            oldText:
              '  const port = Number.parseInt(value, 10);\n  if (Number.isNaN(port)) {\n    throw new Error("Port must be a number.");\n  }\n  return port;',
            newText:
              '  if (!/^\\d+$/u.test(value)) {\n    throw new Error("Port must be a valid port.");\n  }\n  return Number(value);',
          },
        ],
      });
      yield finish(step);
      return;
    }
    if (step === 3) {
      yield toolCall("failing-test", "run_command", {
        program: "pnpm",
        args: ["test"],
        cwd: ".",
        timeoutMs: 60_000,
      });
      yield finish(step);
      return;
    }
    if (step === 4) {
      yield toolCall("corrective-patch", "edit_file", {
        operation: "replace",
        path: "src/parse-port.ts",
        edits: [
          {
            oldText:
              '  if (!/^\\d+$/u.test(value)) {\n    throw new Error("Port must be a valid port.");\n  }\n  return Number(value);',
            newText:
              '  if (!/^\\d+$/u.test(value)) {\n    throw new Error("Port must be a valid port.");\n  }\n  const port = Number(value);\n  if (port < 1 || port > 65535) {\n    throw new Error("Port must be a valid port from 1 through 65535.");\n  }\n  return port;',
          },
        ],
      });
      yield finish(step);
      return;
    }
    if (step === 5) {
      yield toolCall("passing-test", "run_command", {
        program: "pnpm",
        args: ["test"],
        cwd: ".",
        timeoutMs: 60_000,
      });
      yield finish(step);
      return;
    }
    yield {
      type: "text.delta",
      text: "Validated strict decimal input, corrected the range check, and pnpm test passes.",
    };
    yield { type: "finish", finishReason: "stop", usage };
  }
}

function toolCall(
  id: string,
  name: string,
  input: unknown,
): Extract<ModelStreamEvent, { readonly type: "tool.call" }> {
  return { type: "tool.call", call: { id, name, input } };
}

function finish(
  step: number,
): Extract<ModelStreamEvent, { readonly type: "finish" }> {
  return {
    type: "finish",
    finishReason: "tool-calls",
    usage,
    continuation: { provider: "fake", data: { step } },
  };
}

describe("canonical safe-coding vertical slice", () => {
  it("recovers from failing verification with fresh allow-once approvals", async () => {
    const parent = await mkdtemp(path.join(tmpdir(), "forge-recovery-"));
    temporaryDirectories.push(parent);
    const workspaceRoot = path.join(parent, "validation-bug");
    await cp(
      path.join(process.cwd(), "fixtures", "validation-bug"),
      workspaceRoot,
      { recursive: true },
    );
    const workspace = await resolveWorkspace(workspaceRoot);
    const originalCaller = await readFile(
      path.join(workspaceRoot, "src", "server-config.ts"),
      "utf8",
    );
    const originalTests = await readFile(
      path.join(workspaceRoot, "test", "parse-port.test.ts"),
      "utf8",
    );
    const controller = new AbortController();
    const model = new RecoveryModel();
    const approvals: string[] = [];

    const result = await runAgent({
      prompt: "Fix parsePort and verify the result.",
      model,
      tools: builtinTools,
      policy: new WorkspaceWritePolicy(),
      approvalChannel: {
        request: async (action) => {
          approvals.push(action.call.id);
          return true;
        },
      },
      toolContext: {
        workspace,
        signal: controller.signal,
        limits: { maxOutputBytes: 65_536, maxEntries: 200 },
      },
      signal: controller.signal,
    });

    expect(result).toMatchObject({
      status: "completed",
      exitCode: 0,
      modelSteps: 6,
      toolCalls: 7,
    });
    expect(approvals).toEqual([
      "incomplete-patch",
      "failing-test",
      "corrective-patch",
      "passing-test",
    ]);
    const failingResult = model.requests[3]?.toolResults?.[0]?.result;
    const passingResult = model.requests[5]?.toolResults?.[0]?.result;
    expect(failingResult).toMatchObject({
      ok: true,
      output: { timedOut: false },
    });
    expect(passingResult).toMatchObject({
      ok: true,
      output: { exitCode: 0, timedOut: false },
    });
    if (failingResult?.ok) {
      expect((failingResult.output as { exitCode: number }).exitCode).not.toBe(
        0,
      );
    }
    await expect(
      readFile(path.join(workspaceRoot, "src", "parse-port.ts"), "utf8"),
    ).resolves.toContain("port > 65535");
    await expect(
      readFile(path.join(workspaceRoot, "src", "server-config.ts"), "utf8"),
    ).resolves.toBe(originalCaller);
    await expect(
      readFile(path.join(workspaceRoot, "test", "parse-port.test.ts"), "utf8"),
    ).resolves.toBe(originalTests);
    expect(result.finalText).toContain("pnpm test passes");
  });
});
