import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { PassThrough } from "node:stream";

import type {
  ModelAdapter,
  ModelRequest,
  ModelStreamEvent,
  RunEvent,
} from "@forge/core";
import { applyPatchTool, createFileTool, resolveWorkspace } from "@forge/tools";
import { afterEach, describe, expect, it } from "vitest";

import {
  createTerminalApprovalChannel,
  type RunMetadata,
  runTask,
} from "./run.js";

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

function outputBuffer(): {
  readonly output: { write(chunk: string): void };
  read(): string;
} {
  let value = "";
  return {
    output: { write: (chunk) => (value += chunk) },
    read: () => value,
  };
}

class ReadThenAnswerModel implements ModelAdapter {
  readonly requests: ModelRequest[] = [];

  async *stream(request: ModelRequest): AsyncIterable<ModelStreamEvent> {
    this.requests.push(request);
    if (this.requests.length === 1) {
      yield {
        type: "tool.call",
        call: {
          id: "read-1",
          name: "read_file",
          input: { path: "README.md" },
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

    yield { type: "text.delta", text: "The repository says Forge." };
    yield { type: "finish", finishReason: "stop", usage };
  }
}

class CreateThenAnswerModel implements ModelAdapter {
  #step = 0;

  async *stream(_request: ModelRequest): AsyncIterable<ModelStreamEvent> {
    this.#step += 1;
    if (this.#step === 1) {
      yield {
        type: "tool.call",
        call: {
          id: "create-1",
          name: "create_file",
          input: { path: "hello.md", content: "hello, world\n" },
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
    yield { type: "text.delta", text: "Created hello.md." };
    yield { type: "finish", finishReason: "stop", usage };
  }
}

describe("forge run", () => {
  it("executes an allowed workspace read and continues to an answer", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "forge-run-"));
    temporaryDirectories.push(root);
    await writeFile(path.join(root, "README.md"), "Forge repository\n");
    await writeFile(path.join(root, "AGENTS.md"), "Keep answers concise.\n");
    const stdout = outputBuffer();
    const stderr = outputBuffer();
    const model = new ReadThenAnswerModel();
    let metadata: RunMetadata | undefined;

    const exitCode = await runTask(
      "What does README say? test-secret",
      {},
      {
        env: { DEEPSEEK_API_KEY: "test-secret", FORGE_HOME: root },
        cwd: root,
        stdout: stdout.output,
        stderr: stderr.output,
        signal: new AbortController().signal,
        createAdapter: () => model,
        onResult: (_result, nextMetadata) => {
          metadata = nextMetadata;
        },
      },
    );

    expect(exitCode).toBe(0);
    expect(stdout.read()).toBe("[answer]\nThe repository says Forge.\n");
    expect(stderr.read()).toContain("[tool] proposed read_file");
    expect(stderr.read()).toContain("[policy] allow read_file");
    expect(stderr.read()).toContain("[tool] completed read_file");
    expect(model.requests[0]?.instructions).toContain("Keep answers concise.");
    expect(model.requests[0]?.instructions).toContain(
      path.join(root, "AGENTS.md"),
    );
    if (!metadata) throw new Error("Expected run metadata.");
    const trace = await readFile(
      path.join(root, "runs", `${metadata.runId}.jsonl`),
      "utf8",
    );
    expect(trace).toContain('"schemaVersion":1');
    expect(trace).not.toContain("test-secret");
    const firstEvent = JSON.parse(trace.split("\n")[0] ?? "null") as {
      readonly event?: {
        readonly context?: { readonly instructionPaths?: readonly string[] };
      };
    };
    expect(firstEvent.event?.context?.instructionPaths).toContain(
      path.join(root, "AGENTS.md"),
    );
    expect(model.requests[1]?.toolResults?.[0]).toMatchObject({
      callId: "read-1",
      result: {
        ok: true,
        output: { content: "Forge repository\n" },
      },
    });
  });

  it("delivers structured events without duplicating terminal labels", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "forge-run-"));
    temporaryDirectories.push(root);
    await writeFile(path.join(root, "README.md"), "Forge repository\n");
    const stdout = outputBuffer();
    const stderr = outputBuffer();
    const events: RunEvent[] = [];

    const exitCode = await runTask(
      "What does README say?",
      {},
      {
        env: { DEEPSEEK_API_KEY: "test-secret", FORGE_HOME: root },
        cwd: root,
        stdout: stdout.output,
        stderr: stderr.output,
        signal: new AbortController().signal,
        createAdapter: () => new ReadThenAnswerModel(),
        renderEventsToOutput: false,
        onEvent: (event) => {
          events.push(event);
        },
      },
    );

    expect(exitCode).toBe(0);
    expect(events.some((event) => event.type === "model.text")).toBe(true);
    expect(events.some((event) => event.type === "tool.proposed")).toBe(true);
    expect(stdout.read()).toBe("");
    expect(stderr.read()).toBe("");
  });

  it("returns configuration exit code 2 when the API key is missing", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "forge-run-"));
    temporaryDirectories.push(root);
    const stdout = outputBuffer();
    const stderr = outputBuffer();

    const exitCode = await runTask(
      "Inspect this repository",
      {},
      {
        env: {},
        cwd: root,
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

  it("creates a new file after explicit approval", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "forge-run-"));
    temporaryDirectories.push(root);
    const stdout = outputBuffer();
    const stderr = outputBuffer();
    let approvals = 0;

    const exitCode = await runTask(
      "Create hello.md",
      {},
      {
        env: { DEEPSEEK_API_KEY: "test-secret", FORGE_HOME: root },
        cwd: root,
        stdout: stdout.output,
        stderr: stderr.output,
        signal: new AbortController().signal,
        createAdapter: () => new CreateThenAnswerModel(),
        approvalChannel: {
          request: async () => {
            approvals += 1;
            return true;
          },
        },
      },
    );

    expect(exitCode).toBe(0);
    expect(approvals).toBe(1);
    await expect(readFile(path.join(root, "hello.md"), "utf8")).resolves.toBe(
      "hello, world\n",
    );
    expect(stdout.read()).toContain("Created hello.md.");
  });

  it("allows workspace writes without approval in workspace-write profile", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "forge-run-"));
    temporaryDirectories.push(root);
    const model = new CreateThenAnswerModel();

    const exitCode = await runTask(
      "Create hello.md",
      { permissionProfile: "workspace-write" },
      {
        env: { DEEPSEEK_API_KEY: "test-secret", FORGE_HOME: root },
        cwd: root,
        stdout: outputBuffer().output,
        stderr: outputBuffer().output,
        signal: new AbortController().signal,
        createAdapter: () => model,
      },
    );

    expect(exitCode).toBe(0);
    await expect(readFile(path.join(root, "hello.md"), "utf8")).resolves.toBe(
      "hello, world\n",
    );
  });

  it("shows the exact patch diff before terminal approval", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "forge-run-"));
    temporaryDirectories.push(root);
    await writeFile(
      path.join(root, "answer.ts"),
      "export const answer = 42;\n",
    );
    const input = new PassThrough();
    const output = new PassThrough();
    let rendered = "";
    output.on("data", (chunk: Buffer) => {
      rendered += chunk.toString("utf8");
    });
    input.end("y\n");
    const controller = new AbortController();
    const action = {
      call: {
        id: "patch-1",
        name: "apply_patch",
        input: {
          path: "answer.ts",
          edits: [{ oldText: "answer = 42", newText: "answer = 43" }],
        },
      },
      tool: applyPatchTool,
      input: {
        path: "answer.ts",
        edits: [{ oldText: "answer = 42", newText: "answer = 43" }],
      },
    };

    const approved = await createTerminalApprovalChannel(input, output).request(
      action,
      controller.signal,
      {
        workspace: await resolveWorkspace(root),
        signal: controller.signal,
        limits: { maxOutputBytes: 65_536, maxEntries: 200 },
      },
    );

    expect(approved).toBe(true);
    expect(rendered).toContain("--- a/answer.ts");
    expect(rendered).toContain("-export const answer = 42;");
    expect(rendered).toContain("+export const answer = 43;");
    expect(rendered).toContain("Approve? [y/N]");
  });

  it("shows new file content before terminal approval", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "forge-run-"));
    temporaryDirectories.push(root);
    const input = new PassThrough();
    const output = new PassThrough();
    let rendered = "";
    output.on("data", (chunk: Buffer) => {
      rendered += chunk.toString("utf8");
    });
    input.end("y\n");
    const controller = new AbortController();
    const toolInput = { path: "hello.md", content: "hello, world\n" };

    const approved = await createTerminalApprovalChannel(input, output).request(
      {
        call: {
          id: "create-1",
          name: "create_file",
          input: toolInput,
        },
        tool: createFileTool,
        input: toolInput,
      },
      controller.signal,
      {
        workspace: await resolveWorkspace(root),
        signal: controller.signal,
        limits: { maxOutputBytes: 65_536, maxEntries: 200 },
      },
    );

    expect(approved).toBe(true);
    expect(rendered).toContain("--- /dev/null");
    expect(rendered).toContain("+++ b/hello.md");
    expect(rendered).toContain("+hello, world");
    expect(rendered).toContain("Approve? [y/N]");
  });
});
