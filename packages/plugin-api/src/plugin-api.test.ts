import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import {
  type ApprovalPolicy,
  type ModelAdapter,
  type ModelRequest,
  type ModelStreamEvent,
  runAgent,
} from "@forge/core";
import { afterEach, describe, expect, it } from "vitest";

import { createSubagentTools, loadPluginHost, trustProject } from "./index.js";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe("trusted plugin host", () => {
  it("does not execute project plugin code before an explicit trust decision", async () => {
    const fixture = await createFixture();
    const marker = path.join(fixture.root, "loaded.txt");
    await createPlugin(fixture.root, "project", "marker-plugin", {
      capabilities: [],
      source: `import { writeFileSync } from "node:fs";\nwriteFileSync(${JSON.stringify(marker)}, "loaded");\nexport default () => {};\n`,
    });

    const untrusted = await loadPluginHost({
      forgeHome: fixture.forgeHome,
      workspaceRoot: fixture.root,
      enabledUserPlugins: [],
    });

    await expect(readFile(marker, "utf8")).rejects.toMatchObject({
      code: "ENOENT",
    });
    expect(untrusted.loadedPlugins).toHaveLength(0);
    expect(untrusted.warnings[0]).toContain("Skipped 1 project plugin");

    await trustProject(fixture.forgeHome, fixture.root);
    const trusted = await loadPluginHost({
      forgeHome: fixture.forgeHome,
      workspaceRoot: fixture.root,
      enabledUserPlugins: [],
    });
    expect(trusted.loadedPlugins.map(({ manifest }) => manifest.name)).toEqual([
      "marker-plugin",
    ]);
    expect(await readFile(marker, "utf8")).toBe("loaded");
  });

  it("routes plugin tools through the standard policy and event pipeline", async () => {
    const fixture = await createFixture();
    await createPlugin(fixture.forgeHome, "user", "answer-tool", {
      capabilities: [
        "tools:register",
        "commands:register",
        "events:observe",
        "prompt:contribute",
      ],
      source: `
export default (api) => {
  api.registerTool({
    name: "plugin_answer",
    description: "Return a plugin answer",
    risk: "read",
    inputSchema: api.z.object({ value: api.z.string() }).strict(),
    execute: async ({ value }) => ({ ok: true, output: { value }, truncated: false })
  });

  api.observeRunEvents((event) => {
    if (!Object.isFrozen(event)) throw new Error("event was mutable");
  });

  api.registerCommand({
    name: "hello",
    description: "Say hello",
    execute: ({ write }) => write("hello\\n")
  });
  api.contributePrompt(() => "Prefer the plugin tool.");
};
`,
    });
    const host = await loadPluginHost({
      forgeHome: fixture.forgeHome,
      workspaceRoot: fixture.root,
      enabledUserPlugins: ["answer-tool"],
    });
    const decisions: string[] = [];
    expect(host.commands.map(({ name }) => name)).toEqual(["hello"]);
    expect(
      await host.promptContributions({
        prompt: "use plugin",
        workspaceRoot: fixture.root,
        workingDirectory: fixture.root,
      }),
    ).toMatchObject({
      prompt: expect.stringContaining("Prefer the plugin tool."),
    });
    const corePolicy: ApprovalPolicy = {
      evaluate: async (action) => {
        decisions.push(action.tool.name);
        return { kind: "allow", reason: "test policy" };
      },
    };
    const model = new PluginToolModel();
    const result = await runAgent({
      prompt: "use plugin",
      model,
      tools: host.tools,
      policy: host.extendPolicy(corePolicy),
      toolContext: {
        workspace: { root: fixture.root, cwd: fixture.root },
        signal: new AbortController().signal,
        limits: { maxEntries: 10, maxOutputBytes: 1024 },
      },
      signal: new AbortController().signal,
      onEvent: async (event) => {
        expect(await host.observe(event)).toEqual([]);
      },
    });

    expect(result.status).toBe("completed");
    expect(decisions).toEqual(["plugin_answer"]);
    expect(result.events.map(({ type }) => type)).toEqual(
      expect.arrayContaining([
        "tool.proposed",
        "tool.decision",
        "tool.started",
        "tool.completed",
      ]),
    );
    expect(model.requests[1]?.toolResults?.[0]?.result).toMatchObject({
      ok: true,
      output: { value: "from-plugin" },
    });
  });

  it("registers bounded host-run subagents behind a model-risk tool", async () => {
    const fixture = await createFixture();
    await createPlugin(fixture.forgeHome, "user", "review-agent", {
      capabilities: ["subagents:register"],
      source: `
export default (api) => api.registerSubagent({
  name: "reviewer",
  toolName: "delegate_review",
  description: "Delegate a focused code review.",
  instructions: "Review correctness and safety.",
  tools: ["read_file", "search"],
  limits: { maxModelSteps: 3, maxToolCalls: 4 }
});
`,
    });
    const host = await loadPluginHost({
      forgeHome: fixture.forgeHome,
      workspaceRoot: fixture.root,
      enabledUserPlugins: ["review-agent"],
      reservedToolNames: ["read_file", "search"],
    });

    expect(host.subagents).toEqual([
      expect.objectContaining({
        name: "reviewer",
        toolName: "delegate_review",
        pluginName: "review-agent",
        tools: ["read_file", "search"],
      }),
    ]);
    const calls: unknown[] = [];
    const tools = createSubagentTools(host.subagents, async (request) => {
      calls.push(request);
      return { ok: true, output: { answer: "reviewed" }, truncated: false };
    });
    expect(tools.map(({ name, risk }) => ({ name, risk }))).toEqual([
      { name: "delegate_review", risk: "model" },
    ]);
    const result = await tools[0]?.execute(
      { task: "Review src/server.ts" },
      {
        workspace: { root: fixture.root, cwd: fixture.root },
        signal: new AbortController().signal,
        limits: { maxEntries: 10, maxOutputBytes: 1024 },
      },
    );
    expect(result).toMatchObject({ ok: true, output: { answer: "reviewed" } });
    expect(calls).toEqual([
      expect.objectContaining({
        task: "Review src/server.ts",
        subagent: expect.objectContaining({ name: "reviewer" }),
      }),
    ]);
  });

  it("rejects subagent registration without its declared capability", async () => {
    const fixture = await createFixture();
    await createPlugin(fixture.forgeHome, "user", "undeclared-subagent", {
      capabilities: [],
      source: `export default (api) => api.registerSubagent({
  name: "reviewer",
  toolName: "delegate_review",
  description: "Review",
  instructions: "Review carefully.",
  tools: []
});`,
    });

    await expect(
      loadPluginHost({
        forgeHome: fixture.forgeHome,
        workspaceRoot: fixture.root,
        enabledUserPlugins: ["undeclared-subagent"],
      }),
    ).rejects.toThrow('capability "subagents:register"');
  });

  it("combines policy contributions using the strictest decision", async () => {
    const fixture = await createFixture();
    await createPlugin(fixture.forgeHome, "user", "strict-policy", {
      capabilities: ["policy:restrict"],
      source: `export default (api) => api.restrictPolicy(({ tool }) =>
  tool.name === "sensitive" ? { kind: "deny", reason: "blocked by example" } : undefined
);\n`,
    });
    const host = await loadPluginHost({
      forgeHome: fixture.forgeHome,
      workspaceRoot: fixture.root,
      enabledUserPlugins: ["strict-policy"],
    });
    const policy = host.extendPolicy({
      evaluate: async () => ({ kind: "allow", reason: "core allows" }),
    });
    const decision = await policy.evaluate(
      {
        call: { id: "1", name: "sensitive", input: {} },
        tool: {
          name: "sensitive",
          description: "test",
          risk: "read",
          inputSchema: {
            safeParse: () => ({ success: true, data: {} }),
          } as never,
          execute: async () => ({ ok: true, output: null, truncated: false }),
        },
        input: {},
      },
      new AbortController().signal,
    );

    expect(decision).toEqual({
      kind: "deny",
      reason: "strict-policy: blocked by example",
    });
  });

  it("requires a declared network capability for network-risk tools", async () => {
    const fixture = await createFixture();
    await createPlugin(fixture.forgeHome, "user", "undeclared-network", {
      capabilities: ["tools:register"],
      source: `export default (api) => api.registerTool({
  name: "network_probe",
  description: "Test network tool",
  risk: "network",
  inputSchema: api.z.object({}).strict(),
  execute: async () => ({ ok: true, output: {}, truncated: false })
});\n`,
    });

    await expect(
      loadPluginHost({
        forgeHome: fixture.forgeHome,
        workspaceRoot: fixture.root,
        enabledUserPlugins: ["undeclared-network"],
      }),
    ).rejects.toThrow('capability "network:access"');
  });
});

class PluginToolModel implements ModelAdapter {
  readonly requests: ModelRequest[] = [];

  async *stream(request: ModelRequest): AsyncIterable<ModelStreamEvent> {
    this.requests.push(request);
    if (this.requests.length === 1) {
      yield {
        type: "tool.call",
        call: {
          id: "plugin-call",
          name: "plugin_answer",
          input: { value: "from-plugin" },
        },
      };
      yield {
        type: "finish",
        finishReason: "tool-calls",
        usage: usage,
        continuation: { provider: "fake", data: {} },
      };
      return;
    }
    yield { type: "text.delta", text: "done" };
    yield { type: "finish", finishReason: "stop", usage };
  }
}

const usage = {
  inputTokens: 1,
  outputTokens: 1,
  reasoningTokens: 0,
  cachedInputTokens: 0,
  cacheWriteTokens: 0,
  totalTokens: 2,
};

async function createFixture(): Promise<{
  readonly root: string;
  readonly forgeHome: string;
}> {
  const root = await mkdtemp(path.join(tmpdir(), "forge-plugins-"));
  temporaryDirectories.push(root);
  const forgeHome = path.join(root, "forge-home");
  await mkdir(path.join(root, ".git"), { recursive: true });
  return { root, forgeHome };
}

async function createPlugin(
  base: string,
  scope: "user" | "project",
  name: string,
  options: {
    readonly capabilities: readonly string[];
    readonly source: string;
  },
): Promise<void> {
  const directory =
    scope === "user"
      ? path.join(base, "plugins", name)
      : path.join(base, ".forge", "plugins", name);
  await mkdir(directory, { recursive: true });
  await writeFile(
    path.join(directory, "plugin.json"),
    JSON.stringify({
      schemaVersion: 1,
      apiVersion: "1",
      name,
      version: "1.0.0",
      entry: "./index.mjs",
      capabilities: options.capabilities,
    }),
  );
  await writeFile(path.join(directory, "index.mjs"), options.source);
}
