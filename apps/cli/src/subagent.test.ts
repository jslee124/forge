import {
  copyFile,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import type {
  ModelAdapter,
  ModelRequest,
  ModelStreamEvent,
  ProposedAction,
  RunResult,
} from "@forge/core";
import { afterEach, describe, expect, it } from "vitest";

import type { RunMetadata } from "./run.js";
import { runTask } from "./run.js";

const temporaryDirectories: string[] = [];
const exampleDirectory = fileURLToPath(
  new URL("../../../examples/plugins/code-review-subagent/", import.meta.url),
);
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

describe("host-managed plugin subagents", () => {
  it("runs an isolated child with bounded tools and linked traces", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "forge-subagent-"));
    temporaryDirectories.push(root);
    const forgeHome = path.join(root, "forge-home");
    await mkdir(path.join(root, ".git"), { recursive: true });
    await writeFile(path.join(root, "AGENTS.md"), "Follow project rules.\n");
    await writeFile(path.join(root, "target.ts"), "export const value = 1;\n");
    await installExample(forgeHome);
    await writeFile(
      path.join(forgeHome, "config.json"),
      JSON.stringify({
        schemaVersion: 1,
        plugins: { enabled: ["code-review-subagent"] },
        trace: { enabled: true },
      }),
    );
    const parent = new ParentModel();
    const child = new ChildModel();
    const adapters = [parent, child];
    const approvals: ProposedAction[] = [];
    let result: RunResult | undefined;
    let metadata: RunMetadata | undefined;

    const exitCode = await runTask(
      "Review target.ts",
      {},
      {
        env: { FORGE_HOME: forgeHome, DEEPSEEK_API_KEY: "test-secret" },
        cwd: root,
        stdout: { write: () => undefined },
        stderr: { write: () => undefined },
        signal: new AbortController().signal,
        approvalChannel: {
          request: async (action) => {
            approvals.push(action);
            return true;
          },
        },
        createAdapter: () => {
          const adapter = adapters.shift();
          if (!adapter) throw new Error("Unexpected adapter creation.");
          return adapter;
        },
        renderEventsToOutput: false,
        onResult: (nextResult, nextMetadata) => {
          result = nextResult;
          metadata = nextMetadata;
        },
      },
    );

    expect(exitCode).toBe(0);
    expect(result).toMatchObject({
      status: "completed",
      finalText: "Parent accepted the review.",
    });
    expect(approvals.map(({ tool }) => [tool.name, tool.risk])).toEqual([
      ["delegate_code_review", "model"],
    ]);
    expect(parent.requests[0]?.tools?.map(({ name }) => name)).toContain(
      "delegate_code_review",
    );
    expect(child.requests[0]?.tools?.map(({ name }) => name)).toEqual([
      "list_files",
      "read_file",
      "search",
    ]);
    expect(child.requests[0]?.tools?.map(({ name }) => name)).not.toContain(
      "delegate_code_review",
    );
    expect(child.requests[0]?.instructions).toContain("Follow project rules.");
    expect(child.requests[0]?.instructions).toContain(
      "You are a focused code-review subagent.",
    );
    expect(parent.requests[1]?.toolResults?.[0]?.result).toMatchObject({
      ok: true,
      output: {
        subagent: "code-reviewer",
        status: "completed",
        finalText: "No actionable issue found.",
        tracePersisted: true,
        modelSteps: 2,
        toolCalls: 1,
      },
    });

    if (!metadata) throw new Error("Expected parent run metadata.");
    const parentTrace = await readFile(
      path.join(forgeHome, "runs", `${metadata.runId}.jsonl`),
      "utf8",
    );
    const completedTool = parentTrace
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line) as TraceLine)
      .find(({ event }) => event.type === "tool.completed");
    const childRunId = completedTool?.event.result?.output?.runId;
    expect(childRunId).toMatch(/^[0-9a-f-]{36}$/u);
    const childTrace = await readFile(
      path.join(forgeHome, "runs", `${childRunId}.jsonl`),
      "utf8",
    );
    const childLines = childTrace
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line) as TraceLine);
    expect(childLines.length).toBeGreaterThan(0);
    expect(
      childLines.every(
        (line) =>
          line.parentRunId === metadata?.runId &&
          line.subagentName === "code-reviewer",
      ),
    ).toBe(true);
    expect(
      childLines.some(({ event }) => event.type === "tool.completed"),
    ).toBe(true);
  });

  it("enforces the shared four-run budget before creating another child", async () => {
    const { root, forgeHome } = await createExampleWorkspace({
      trace: { enabled: false },
    });
    const parent = new RepeatedDelegateModel(5);
    let factoryCalls = 0;

    const exitCode = await runTask(
      "Delegate repeatedly",
      {},
      {
        env: { FORGE_HOME: forgeHome, DEEPSEEK_API_KEY: "test-secret" },
        cwd: root,
        stdout: { write: () => undefined },
        stderr: { write: () => undefined },
        signal: new AbortController().signal,
        approvalChannel: { request: async () => true },
        createAdapter: () => {
          factoryCalls += 1;
          return factoryCalls === 1 ? parent : new FinalOnlyModel("child done");
        },
        renderEventsToOutput: false,
      },
    );

    expect(exitCode).toBe(0);
    expect(factoryCalls).toBe(5);
    expect(parent.requests).toHaveLength(6);
    expect(parent.requests[5]?.toolResults?.[0]?.result).toMatchObject({
      ok: false,
      error: { code: "limit_reached" },
    });
  });

  it("bounds delegated final text by the configured tool output limit", async () => {
    const { root, forgeHome } = await createExampleWorkspace({
      limits: { maxToolOutputBytes: 256 },
      trace: { enabled: false },
    });
    const parent = new ParentModel();
    const adapters: ModelAdapter[] = [
      parent,
      new FinalOnlyModel("x".repeat(10_000)),
    ];

    const exitCode = await runTask(
      "Review target.ts",
      {},
      {
        env: { FORGE_HOME: forgeHome, DEEPSEEK_API_KEY: "test-secret" },
        cwd: root,
        stdout: { write: () => undefined },
        stderr: { write: () => undefined },
        signal: new AbortController().signal,
        approvalChannel: { request: async () => true },
        createAdapter: () => {
          const adapter = adapters.shift();
          if (!adapter) throw new Error("Unexpected adapter creation.");
          return adapter;
        },
        renderEventsToOutput: false,
      },
    );

    expect(exitCode).toBe(0);
    const childResult = parent.requests[1]?.toolResults?.[0]?.result;
    expect(childResult).toMatchObject({ ok: true, truncated: true });
    if (!childResult?.ok) throw new Error("Expected bounded child output.");
    expect(
      Buffer.byteLength(JSON.stringify(childResult.output)),
    ).toBeLessThanOrEqual(256);
  });

  it("rejects a subagent that references an unknown child tool before streaming", async () => {
    const { root, forgeHome, pluginDirectory } = await createExampleWorkspace({
      trace: { enabled: false },
    });
    await writeFile(
      path.join(pluginDirectory, "index.mjs"),
      `export default (api) => api.registerSubagent({
  name: "broken",
  toolName: "delegate_broken",
  description: "Broken example",
  instructions: "Inspect files.",
  tools: ["missing_tool"]
});\n`,
    );
    let streamed = false;
    let stderr = "";

    const exitCode = await runTask(
      "Try delegation",
      {},
      {
        env: { FORGE_HOME: forgeHome, DEEPSEEK_API_KEY: "test-secret" },
        cwd: root,
        stdout: { write: () => undefined },
        stderr: { write: (text) => (stderr += text) },
        signal: new AbortController().signal,
        createAdapter: () => ({
          stream: async function* () {
            streamed = true;
            yield { type: "finish", finishReason: "stop", usage };
          },
        }),
      },
    );

    expect(exitCode).toBe(2);
    expect(streamed).toBe(false);
    expect(stderr).toContain("references unknown tool(s): missing_tool");
  });
});

class ParentModel implements ModelAdapter {
  readonly requests: ModelRequest[] = [];

  async *stream(request: ModelRequest): AsyncIterable<ModelStreamEvent> {
    this.requests.push(request);
    if (this.requests.length === 1) {
      yield {
        type: "tool.call",
        call: {
          id: "delegate-1",
          name: "delegate_code_review",
          input: { task: "Review target.ts for correctness." },
        },
      };
      yield {
        type: "finish",
        finishReason: "tool-calls",
        usage,
        continuation: { provider: "fake", data: { step: 1 } },
      };
      return;
    }
    yield { type: "text.delta", text: "Parent accepted the review." };
    yield { type: "finish", finishReason: "stop", usage };
  }
}

class ChildModel implements ModelAdapter {
  readonly requests: ModelRequest[] = [];

  async *stream(request: ModelRequest): AsyncIterable<ModelStreamEvent> {
    this.requests.push(request);
    if (this.requests.length === 1) {
      yield {
        type: "tool.call",
        call: {
          id: "read-1",
          name: "read_file",
          input: { path: "target.ts" },
        },
      };
      yield {
        type: "finish",
        finishReason: "tool-calls",
        usage,
        continuation: { provider: "fake", data: { step: 1 } },
      };
      return;
    }
    yield { type: "text.delta", text: "No actionable issue found." };
    yield { type: "finish", finishReason: "stop", usage };
  }
}

class FinalOnlyModel implements ModelAdapter {
  constructor(readonly text: string) {}

  async *stream(): AsyncIterable<ModelStreamEvent> {
    yield { type: "text.delta", text: this.text };
    yield { type: "finish", finishReason: "stop", usage };
  }
}

class RepeatedDelegateModel implements ModelAdapter {
  readonly requests: ModelRequest[] = [];

  constructor(readonly count: number) {}

  async *stream(request: ModelRequest): AsyncIterable<ModelStreamEvent> {
    this.requests.push(request);
    if (this.requests.length <= this.count) {
      yield {
        type: "tool.call",
        call: {
          id: `delegate-${this.requests.length}`,
          name: "delegate_code_review",
          input: { task: `Review pass ${this.requests.length}` },
        },
      };
      yield {
        type: "finish",
        finishReason: "tool-calls",
        usage,
        continuation: {
          provider: "fake",
          data: { step: this.requests.length },
        },
      };
      return;
    }
    yield { type: "text.delta", text: "Delegation complete." };
    yield { type: "finish", finishReason: "stop", usage };
  }
}

interface TraceLine {
  readonly parentRunId?: string;
  readonly subagentName?: string;
  readonly event: {
    readonly type: string;
    readonly result?: {
      readonly output?: { readonly runId?: string };
    };
  };
}

async function installExample(forgeHome: string): Promise<string> {
  const target = path.join(forgeHome, "plugins", "code-review-subagent");
  await mkdir(target, { recursive: true });
  await Promise.all(
    ["plugin.json", "index.mjs"].map((file) =>
      copyFile(path.join(exampleDirectory, file), path.join(target, file)),
    ),
  );
  return target;
}

async function createExampleWorkspace(
  config: Record<string, unknown>,
): Promise<{
  readonly root: string;
  readonly forgeHome: string;
  readonly pluginDirectory: string;
}> {
  const root = await mkdtemp(path.join(tmpdir(), "forge-subagent-"));
  temporaryDirectories.push(root);
  const forgeHome = path.join(root, "forge-home");
  await mkdir(path.join(root, ".git"), { recursive: true });
  await writeFile(path.join(root, "target.ts"), "export const value = 1;\n");
  const pluginDirectory = await installExample(forgeHome);
  await writeFile(
    path.join(forgeHome, "config.json"),
    JSON.stringify({
      schemaVersion: 1,
      plugins: { enabled: ["code-review-subagent"] },
      ...config,
    }),
  );
  return { root, forgeHome, pluginDirectory };
}
