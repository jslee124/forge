import { copyFile, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import type { ForgeTool, ToolContext } from "@forge/core";
import { afterEach, describe, expect, it, vi } from "vitest";

import { loadPluginHost } from "./index.js";

const temporaryDirectories: string[] = [];
const examplesDirectory = fileURLToPath(
  new URL("../../../examples/plugins/", import.meta.url),
);

afterEach(async () => {
  vi.unstubAllEnvs();
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe("stateful plugin examples", () => {
  it("keeps a bounded in-process todo list and enforces one active item", async () => {
    const fixture = await loadExample("todos");
    const todo = requireTool(fixture.host.tools, "todo");
    const context = toolContext(fixture.root);

    expect(
      await todo.execute({ action: "add", text: "Inspect" }, context),
    ).toMatchObject({
      ok: true,
      output: { todos: [{ id: 1, text: "Inspect", status: "pending" }] },
    });
    await todo.execute({ action: "add", text: "Test" }, context);
    await todo.execute(
      { action: "update", id: 1, status: "in_progress" },
      context,
    );
    expect(
      await todo.execute(
        { action: "update", id: 2, status: "in_progress" },
        context,
      ),
    ).toMatchObject({ ok: false, error: { code: "invalid_input" } });

    const contribution = await fixture.host.promptContributions({
      prompt: "work",
      workspaceRoot: fixture.root,
      workingDirectory: fixture.root,
    });
    expect(contribution.prompt).toContain("todo tool is available");
  });

  it("bridges a session-based newline-delimited stdio MCP server", async () => {
    const fixture = await loadExample("mcp-stdio");
    const serverPath = path.join(fixture.root, "mcp-server.mjs");
    await writeFile(
      serverPath,
      `import { createInterface } from "node:readline";
const lines = createInterface({ input: process.stdin });
lines.on("line", (line) => {
  const message = JSON.parse(line);
  if (!("id" in message)) return;
  const result = message.method === "initialize"
    ? { protocolVersion: "2025-11-25", capabilities: { tools: {} }, serverInfo: { name: "fixture", version: "1" } }
    : message.method === "tools/list"
      ? { tools: [{ name: "echo", description: "Echo", inputSchema: { type: "object" } }] }
      : { content: [{ type: "text", text: message.params.arguments.text }] };
  process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id: message.id, result }) + "\\n");
});
`,
    );
    vi.stubEnv(
      "FORGE_MCP_COMMAND",
      JSON.stringify([process.execPath, serverPath]),
    );
    const context = toolContext(fixture.root);

    const listed = await requireTool(
      fixture.host.tools,
      "mcp_list_tools",
    ).execute({}, context);
    expect(listed).toMatchObject({
      ok: true,
      output: { tools: [{ name: "echo" }] },
    });
    const called = await requireTool(
      fixture.host.tools,
      "mcp_call_tool",
    ).execute({ name: "echo", arguments: { text: "hello" } }, context);
    expect(called).toMatchObject({
      ok: true,
      output: { content: [{ type: "text", text: "hello" }] },
    });
  });
});

async function loadExample(name: string): Promise<{
  readonly root: string;
  readonly host: Awaited<ReturnType<typeof loadPluginHost>>;
}> {
  const root = await mkdtemp(path.join(tmpdir(), `forge-${name}-`));
  temporaryDirectories.push(root);
  const forgeHome = path.join(root, "forge-home");
  const target = path.join(forgeHome, "plugins", name);
  await mkdir(target, { recursive: true });
  await Promise.all(
    ["plugin.json", "index.mjs"].map((file) =>
      copyFile(
        path.join(examplesDirectory, name, file),
        path.join(target, file),
      ),
    ),
  );
  return {
    root,
    host: await loadPluginHost({
      forgeHome,
      workspaceRoot: root,
      enabledUserPlugins: [name],
    }),
  };
}

function requireTool(tools: readonly ForgeTool[], name: string): ForgeTool {
  const tool = tools.find((candidate) => candidate.name === name);
  if (!tool) throw new Error(`Missing ${name} tool.`);
  return tool;
}

function toolContext(root: string): ToolContext {
  return {
    workspace: { root, cwd: root },
    signal: new AbortController().signal,
    limits: {
      maxOutputBytes: 32_768,
      maxEntries: 100,
      commandTimeoutMs: 5_000,
    },
  };
}
