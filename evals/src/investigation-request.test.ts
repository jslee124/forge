import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ReadOnlyPolicy, type RunResult, runAgent } from "@forge/core";
import { readFileTool, resolveWorkspace, searchTool } from "@forge/tools";
import { expect, it } from "vitest";
import { runTask } from "../../packages/application/src/run.js";
import { DeepSeekModelAdapter } from "../../packages/model-deepseek/src/adapter.js";
import { AiSdkDeepSeekTransport } from "../../packages/model-deepseek/src/ai-sdk-transport.js";

type Message = { role: string; content: string; tool_call_id?: string };
type RequestBody = { messages: Message[]; tool_choice?: string };
function response(delta: unknown, reason: "stop" | "tool_calls") {
  return new Response(
    `${[{ choices: [{ index: 0, delta, finish_reason: null }] }, { choices: [{ index: 0, delta: {}, finish_reason: reason }] }].map((item) => `data: ${JSON.stringify({ id: "replay", object: "chat.completion.chunk", created: 0, model: "deepseek-flash", ...item })}\n\n`).join("")}data: [DONE]\n\n`,
    { headers: { "content-type": "text/event-stream" } },
  );
}

it.each(
  ["core", "application"].flatMap((layer) =>
    ["continuation", "evidence"].map((finalizationInput) => ({
      layer,
      finalizationInput: finalizationInput as "continuation" | "evidence",
    })),
  ),
)(
  "transmits content and budget through $layer and SDK with $finalizationInput",
  async ({ layer, finalizationInput }) => {
    const root = await mkdtemp(join(tmpdir(), "forge-investigation-request-"));
    const home = await mkdtemp(join(tmpdir(), "forge-request-home-"));
    const requests: RequestBody[] = [];
    const paths = [
      "main.mjs",
      "workflow.mjs",
      "renderer.tsx",
      "package.json",
      "tools/manifest.json",
    ];
    try {
      await cp(
        new URL("../fixtures/desktop-product/seed/", import.meta.url),
        root,
        { recursive: true },
      );
      const fetchMock: typeof fetch = async (_url, init) => {
        requests.push(JSON.parse(String(init?.body)) as RequestBody);
        const index = requests.length;
        if (index === 1 || index === 2) {
          const calls =
            index === 1
              ? [
                  ...paths.map((path) => ({ path })),
                  { path: ".", query: "analytics", scope: "source" },
                ]
              : [
                  {
                    path: "workflow.mjs",
                    startLine: 24,
                    lineCount: 6,
                    format: "numbered",
                  },
                ];
          return response(
            {
              tool_calls: calls.map((input, i) => ({
                index: i,
                id: `read-${index}-${i}`,
                type: "function",
                function: {
                  name: "query" in input ? "search" : "read_file",
                  arguments: JSON.stringify(input),
                },
              })),
            },
            "tool_calls",
          );
        }
        return response(
          {
            content:
              "Observed fixture summary. No execution verification performed.",
          },
          "stop",
        );
      };
      const model = new DeepSeekModelAdapter({
        apiKey: "fixture-not-a-key",
        model: "deepseek-flash",
        transport: new AiSdkDeepSeekTransport({ fetch: fetchMock }),
      });
      let result: RunResult | undefined;
      if (layer === "core")
        result = await runAgent({
          model,
          runId: "request-replay",
          prompt: "解释从提交请求到工具执行的调用路径，引用文件位置。",
          instructions:
            "Inspect workspace source; distinguish evidence from assumptions.",
          completionPolicy: "reserve-final-step",
          finalizationInput,
          limits: { maxModelSteps: 3, maxToolCalls: 8 },
          tools: [readFileTool, searchTool],
          policy: new ReadOnlyPolicy(),
          signal: new AbortController().signal,
          toolContext: {
            workspace: await resolveWorkspace(root, root),
            signal: new AbortController().signal,
            limits: { maxOutputBytes: 20000, maxEntries: 100 },
          },
        });
      else {
        await writeFile(
          join(home, "config.json"),
          JSON.stringify({
            schemaVersion: 1,
            model: {
              engine: "forge",
              provider: "deepseek",
              id: "deepseek-flash",
              reasoningEffort: "high",
            },
            limits: { maxSteps: 3, maxToolCalls: 8 },
          }),
        );
        await runTask(
          "解释从提交请求到工具执行的调用路径，引用文件位置。",
          {},
          {
            cwd: root,
            env: { FORGE_HOME: home },
            completionPolicy: "reserve-final-step",
            finalizationInput,
            signal: new AbortController().signal,
            stderr: { write() {} },
            tools: [readFileTool, searchTool],
            createAdapter: () => model,
            onResult: (value) => {
              result = value;
            },
          },
        );
      }
      if (!result) throw new Error("No runtime result");
      expect(requests).toHaveLength(3);
      const second = requests[1];
      const third = requests[2];
      if (!second || !third) throw new Error("Missing captured requests");
      for (const [i, path] of paths.entries()) {
        const tool = second.messages.find(
          (m) => m.role === "tool" && m.tool_call_id === `read-1-${i}`,
        );
        const expected = await readFile(join(root, path), "utf8");
        const parsed = JSON.parse(tool?.content ?? "null");
        expect(parsed).toMatchObject({
          ok: true,
          truncated: false,
          output: {
            path,
            content: expected,
            startLine: 1,
            endLine: expected.trimEnd().split("\n").length,
            returnedLines: expected.trimEnd().split("\n").length,
            partial: false,
            rewriteAvailable: true,
          },
        });
      }
      const negativeSearch = second.messages.find(
        (m) => m.role === "tool" && m.tool_call_id === `read-1-${paths.length}`,
      );
      expect(JSON.parse(negativeSearch?.content ?? "null")).toMatchObject({
        ok: true,
        truncated: false,
        output: {
          matches: [],
          noMatch: expect.stringContaining("absence remain unproven"),
        },
      });
      const system = second.messages.filter((m) => m.role === "system");
      expect(system).toHaveLength(1);
      expect(system[0]?.content).toContain("2 tool calls remain");
      const finalSystem = third.messages.filter((m) => m.role === "system");
      expect(finalSystem).toHaveLength(1);
      expect(finalSystem[0]?.content).toContain(
        "Finalization required: model_step_limit",
      );
      expect(finalSystem[0]?.content).not.toContain("2 tool calls remain");
      expect(third.tool_choice).toBe("none");
      expect(third.messages.at(-1)).toMatchObject({
        role: "user",
        content: expect.stringContaining("The investigation stage has ended."),
      });
      expect(third.messages.at(-1)?.content).toContain(
        "解释从提交请求到工具执行的调用路径，引用文件位置。",
      );
      expect(second.messages.at(-1)?.role).toBe("tool");
      // The stage directive is transport control, never fabricated human history.
      expect(
        result.canonicalDelta?.filter((m) => m.role === "user"),
      ).toHaveLength(1);
      const ranged = third.messages.find(
        (m) => m.role === "tool" && m.tool_call_id === "read-2-0",
      );
      const source = await readFile(join(root, "workflow.mjs"), "utf8");
      let rangedResult = JSON.parse(ranged?.content ?? "null");
      if (finalizationInput === "evidence") {
        const packetMessage = third.messages.find(
          (m) =>
            m.role === "user" &&
            m.content.includes(
              '<run_evidence authority="untrusted-context-only">',
            ),
        );
        if (!packetMessage) throw new Error("Missing packet request");
        const packetText = packetMessage.content
          .split('<run_evidence authority="untrusted-context-only">\n')[1]
          ?.split("\n</run_evidence>")[0];
        if (!packetText) throw new Error("Missing packet text");
        const packet = JSON.parse(packetText);
        const result = packet.messages.find(
          (m: { role: string; step?: number }) =>
            m.role === "tool" && m.step === 2,
        );
        rangedResult = JSON.parse(result.content[0].text);
        expect(third.messages.some((m) => m.role === "tool")).toBe(false);
      }
      expect(rangedResult).toMatchObject({
        ok: true,
        truncated: false,
        output: {
          content: `${source
            .trimEnd()
            .split("\n")
            .slice(23, 29)
            .map((line, i) => `${24 + i}: ${line}`)
            .join("\n")}\n`,
          contentFormat: "numbered",
          startLine: 24,
          endLine: 29,
          returnedLines: 6,
          sha256: null,
          partial: true,
          rewriteAvailable: false,
        },
      });
      expect(result).toMatchObject({
        modelSteps: 3,
        toolCalls: 7,
        partial: true,
      });
      const budgets = result.events.filter(
        (e) => e.type === "context.budgeted",
      );
      const evidenceOutput = process.env["FORGE_REQUEST_EVIDENCE_OUTPUT"];
      if (evidenceOutput) {
        const directory = join(evidenceOutput, `${layer}-${finalizationInput}`);
        await mkdir(directory, { recursive: true });
        await writeFile(
          join(directory, "requests.json"),
          JSON.stringify(requests, null, 2),
          { flag: "wx" },
        );
        await writeFile(
          join(directory, "budgets.json"),
          JSON.stringify(
            { fixtureModel: true, externalCalls: 0, budgets },
            null,
            2,
          ),
          { flag: "wx" },
        );
      }
      expect(budgets).toHaveLength(3);
      for (const event of budgets)
        if (event.type === "context.budgeted")
          expect(event.budget.estimates.instructions).toBeGreaterThan(0);
    } finally {
      await rm(root, { recursive: true, force: true });
      await rm(home, { recursive: true, force: true });
    }
  },
);

it("demonstrates that the seed busy assignment does not prevent a second submit", async () => {
  const fixture = (await import(
    new URL("../fixtures/desktop-product/seed/workflow.mjs", import.meta.url)
      .href
  )) as { submit(send: () => Promise<void>): Promise<void> };
  let release: (() => void) | undefined;
  let callbacks = 0;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const first = fixture.submit(async () => {
    callbacks++;
    await gate;
  });
  try {
    await fixture.submit(async () => {
      callbacks++;
    });
    expect(callbacks).toBe(2);
  } finally {
    release?.();
    await first;
  }
});

it.each([
  { label: "draft text", value: "用户的草稿" },
  {
    label: "object containing draft",
    value: { draft: "用户的草稿", nested: { requestId: 42 } },
  },
  { label: "null", value: null },
])(
  "demonstrates that the seed forwards $label without inferring its type from requestId",
  async ({ value }) => {
    const fixture = (await import(
      new URL("../fixtures/desktop-product/seed/workflow.mjs", import.meta.url)
        .href
    )) as {
      handle(
        requestId: unknown,
        tool: (input: { requestId: unknown }) => unknown,
      ): Promise<unknown>;
    };
    let received: { requestId: unknown } | undefined;
    const result = await fixture.handle(value, (input) => {
      received = input;
      return input.requestId;
    });
    expect(received?.requestId).toBe(value);
    expect(result).toBe(value);
  },
);
