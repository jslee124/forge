import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { PassThrough } from "node:stream";

import {
  describeApproval,
  type ForgeTool,
  type ModelAdapter,
  type ModelRequest,
  type ModelStreamEvent,
  type RunEvent,
} from "@forge/core";
import { applyPatchTool, createFileTool, resolveWorkspace } from "@forge/tools";
import { afterEach, describe, expect, it } from "vitest";

import {
  createApprovalChannel,
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

class LoadSkillThenAnswerModel implements ModelAdapter {
  readonly requests: ModelRequest[] = [];

  async *stream(request: ModelRequest): AsyncIterable<ModelStreamEvent> {
    this.requests.push(request);
    if (this.requests.length === 1) {
      const match = /"id":"(skill:[^"]+)","name":"forge-plugin-creator"/u.exec(
        request.instructions ?? "",
      );
      if (!match?.[1]) throw new Error("Missing built-in Skill catalog id.");
      yield {
        type: "tool.call",
        call: {
          id: "skill-1",
          name: "load_skill",
          input: { id: match[1] },
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
    yield { type: "text.delta", text: "Plugin plan is ready." };
    yield { type: "finish", finishReason: "stop", usage };
  }
}

describe("forge run", () => {
  it("automatically selects and lazily loads the built-in plugin authoring Skill", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "forge-run-skill-"));
    temporaryDirectories.push(root);
    const model = new LoadSkillThenAnswerModel();
    const events: RunEvent[] = [];

    const exitCode = await runTask(
      "Create a Forge plugin that counts text",
      {},
      {
        env: { DEEPSEEK_API_KEY: "test-secret", FORGE_HOME: root },
        cwd: root,
        stdout: outputBuffer().output,
        stderr: outputBuffer().output,
        signal: new AbortController().signal,
        createAdapter: () => model,
        onEvent: (event) => {
          events.push(event);
        },
      },
    );

    expect(exitCode).toBe(0);
    expect(model.requests).toHaveLength(2);
    expect(model.requests[0]?.instructions).toContain("<skill_catalog");
    expect(model.requests[0]?.instructions).toContain(
      '"name":"forge-plugin-creator"',
    );
    expect(model.requests[0]?.instructions).not.toContain(
      "# Forge plugin creator",
    );
    expect(model.requests[0]?.tools?.map(({ name }) => name)).toContain(
      "load_skill",
    );
    expect(model.requests[1]?.toolResults?.[0]).toMatchObject({
      toolName: "load_skill",
      result: {
        ok: true,
        output: {
          name: "forge-plugin-creator",
          source: "builtin",
          content: expect.stringContaining("# Forge plugin creator"),
        },
      },
    });
    expect(events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "skill.selected",
          name: "forge-plugin-creator",
          reason: "automatic",
        }),
        expect.objectContaining({
          type: "skill.loaded",
          name: "forge-plugin-creator",
          truncated: false,
        }),
      ]),
    );
    expect(
      events.filter(({ type }) => type === "context.budgeted"),
    ).toHaveLength(2);
  });

  it("reports provider-hidden reasoning tokens without inventing reasoning text", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "forge-run-reasoning-"));
    temporaryDirectories.push(root);
    const stdout = outputBuffer();
    const stderr = outputBuffer();
    const model: ModelAdapter = {
      async *stream(): AsyncIterable<ModelStreamEvent> {
        yield { type: "text.delta", text: "Final answer." };
        yield {
          type: "finish",
          finishReason: "stop",
          usage: {
            ...usage,
            outputTokens: 13,
            reasoningTokens: 12,
            totalTokens: 14,
          },
        };
      },
    };

    const exitCode = await runTask(
      "Think",
      {},
      {
        env: { DEEPSEEK_API_KEY: "test-secret", FORGE_HOME: root },
        cwd: root,
        stdout: stdout.output,
        stderr: stderr.output,
        signal: new AbortController().signal,
        createAdapter: () => model,
      },
    );

    expect(exitCode).toBe(0);
    expect(stdout.read()).toBe("[answer]\nFinal answer.\n");
    expect(stderr.read()).toContain(
      "[reasoning] Provider used 12 reasoning tokens but did not return reasoning text.",
    );
  });

  it("resolves a workspace image and forwards it only to the model request", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "forge-run-vision-"));
    temporaryDirectories.push(root);
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    await writeFile(path.join(root, "screen.png"), png);
    const model = new ReadThenAnswerModel();
    const stdout = outputBuffer();
    const stderr = outputBuffer();

    const exitCode = await runTask(
      "Inspect the screenshot",
      {
        provider: "deepseek",
        model: "deepseek-v4-flash-vision-exp",
        image: ["screen.png"],
      },
      {
        env: { DEEPSEEK_API_KEY: "test-secret", FORGE_HOME: root },
        cwd: root,
        stdout: stdout.output,
        stderr: stderr.output,
        signal: new AbortController().signal,
        createAdapter: () => model,
      },
    );

    expect(exitCode).toBe(0);
    expect(model.requests[0]?.images).toEqual([
      {
        type: "base64",
        mediaType: "image/png",
        data: png.toString("base64"),
        filename: "screen.png",
      },
    ]);
    expect(model.requests[1]?.continuation).toBeDefined();
    expect(model.requests[1]?.images).toEqual(model.requests[0]?.images);
  });

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
    const runStarted = trace
      .split("\n")
      .filter(Boolean)
      .map(
        (line) =>
          JSON.parse(line) as {
            readonly event?: {
              readonly type?: string;
              readonly context?: {
                readonly instructionPaths?: readonly string[];
              };
            };
          },
      )
      .find(({ event }) => event?.type === "run.started");
    expect(runStarted?.event?.context?.instructionPaths).toContain(
      path.join(root, "AGENTS.md"),
    );
    const traceEvents = trace
      .split("\n")
      .filter(Boolean)
      .map((line) => (JSON.parse(line) as { readonly event: RunEvent }).event);
    const prefixes = traceEvents.filter(
      (event): event is Extract<RunEvent, { readonly type: "cache.prefix" }> =>
        event.type === "cache.prefix",
    );
    expect(prefixes).toHaveLength(2);
    expect(prefixes[1]?.observation.stablePrefixHash).toBe(
      prefixes[0]?.observation.stablePrefixHash,
    );
    expect(prefixes[1]?.observation.invalidatedBy).toEqual([]);
    expect(
      traceEvents.filter(({ type }) => type === "cache.observed"),
    ).toHaveLength(2);
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
        env: { FORGE_HOME: root },
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
    expect(rendered).toContain("1  Allow once");
    expect(rendered).toContain("2  Allow this session");
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
    expect(rendered).toContain("2  Allow this session");
  });

  it("returns an existing-file preview failure instead of reporting user denial", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "forge-run-"));
    temporaryDirectories.push(root);
    await writeFile(path.join(root, "hello.md"), "existing\n");
    const output = outputBuffer();
    let questions = 0;
    const channel = createApprovalChannel(async () => {
      questions += 1;
      return "1";
    }, output.output);
    const toolInput = { path: "hello.md", content: "replacement\n" };
    const action = {
      call: {
        id: "create-existing",
        name: "create_file",
        input: toolInput,
      },
      tool: createFileTool,
      input: toolInput,
    };
    const context = {
      workspace: await resolveWorkspace(root),
      signal: new AbortController().signal,
      limits: { maxOutputBytes: 65_536, maxEntries: 200 },
    };
    const descriptor = await describeApproval(action, context);

    await expect(
      channel.requestStructured?.(action, context.signal, context, descriptor),
    ).resolves.toMatchObject({
      kind: "preflight-failed",
      result: { ok: false, error: { code: "already_exists" } },
    });
    expect(questions).toBe(0);
    expect(output.read()).toContain("Cannot preview file creation");
  });

  it("shows the external destination before network approval", async () => {
    const input = new PassThrough();
    const output = new PassThrough();
    let rendered = "";
    output.on("data", (chunk: Buffer) => {
      rendered += chunk.toString("utf8");
    });
    input.end("y\n");
    const controller = new AbortController();
    const networkTool = {
      name: "web_fetch",
      risk: "network",
    } as ForgeTool;

    const approved = await createTerminalApprovalChannel(input, output).request(
      {
        call: {
          id: "network-1",
          name: "web_fetch",
          input: { url: "https://example.com/docs" },
        },
        tool: networkTool,
        input: { url: "https://example.com/docs" },
      },
      controller.signal,
      {
        workspace: { root: "/workspace", cwd: "/workspace" },
        signal: controller.signal,
        limits: { maxOutputBytes: 65_536, maxEntries: 200 },
      },
    );

    expect(approved).toBe(true);
    expect(rendered).toContain("Network request");
    expect(rendered).toContain("Tool         web_fetch");
    expect(rendered).toContain("Destination  https://example.com/docs");
    expect(rendered).toContain("web_fetch to example.com");
  });

  it("shows the delegated task before model-run approval", async () => {
    const input = new PassThrough();
    const output = new PassThrough();
    let rendered = "";
    output.on("data", (chunk: Buffer) => {
      rendered += chunk.toString("utf8");
    });
    input.end("y\n");
    const controller = new AbortController();
    const subagentTool = {
      name: "delegate_code_review",
      risk: "model",
    } as ForgeTool;

    const approved = await createTerminalApprovalChannel(input, output).request(
      {
        call: {
          id: "subagent-1",
          name: "delegate_code_review",
          input: { task: "Review src/server.ts for race conditions." },
        },
        tool: subagentTool,
        input: { task: "Review src/server.ts for race conditions." },
      },
      controller.signal,
      {
        workspace: { root: "/workspace", cwd: "/workspace" },
        signal: controller.signal,
        limits: { maxOutputBytes: 65_536, maxEntries: 200 },
      },
    );

    expect(approved).toBe(true);
    expect(rendered).toContain("Delegated model run");
    expect(rendered).toContain("Tool         delegate_code_review");
    expect(rendered).toContain(
      "Task         Review src/server.ts for race conditions.",
    );
    expect(rendered).toContain("delegated model tool delegate_code_review");
  });
});
