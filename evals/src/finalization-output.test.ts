import { readFileSync } from "node:fs";
import {
  ReadOnlyPolicy,
  runAgent,
  validateCanonicalConversation,
} from "@forge/core";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { DeepSeekModelAdapter } from "../../packages/model-deepseek/src/adapter.js";
import { AiSdkDeepSeekTransport } from "../../packages/model-deepseek/src/ai-sdk-transport.js";

// Exact answer from the authorized T13 round 1 F03 trial. Synthetic workspace
// paths only; no credentials, private repository contents or live API required.
const rawSummary = readFileSync(
  new URL(
    "../../packages/model-deepseek/src/fixtures/raw-dsml-summary.txt",
    import.meta.url,
  ),
  "utf8",
).trimEnd();

function fixture(answer: string, chunkSize = 7) {
  const requests: Record<string, unknown>[] = [];
  let effects = 0;
  const fetchMock: typeof fetch = async (_url, init) => {
    requests.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
    const deltas: Record<string, unknown>[] =
      requests.length === 1
        ? [
            {
              tool_calls: [
                {
                  index: 0,
                  id: "read-1",
                  type: "function",
                  function: {
                    name: "read_file",
                    arguments: '{"path":"package.json"}',
                  },
                },
              ],
            },
          ]
        : Array.from(
            { length: Math.ceil(answer.length / chunkSize) },
            (_, i) => ({
              content: answer.slice(i * chunkSize, (i + 1) * chunkSize),
            }),
          );
    const chunks = deltas.map((delta) => ({
      id: "fixture",
      object: "chat.completion.chunk",
      created: 0,
      model: "deepseek-flash",
      choices: [{ index: 0, delta, finish_reason: null }],
    }));
    const end = {
      id: "fixture",
      object: "chat.completion.chunk",
      created: 0,
      model: "deepseek-flash",
      choices: [
        {
          index: 0,
          delta: {},
          finish_reason: requests.length === 1 ? "tool_calls" : "stop",
        },
      ],
    };
    return new Response(
      `${[...chunks, end]
        .map((chunk) => `data: ${JSON.stringify(chunk)}\n\n`)
        .join("")}data: [DONE]\n\n`,
      { headers: { "content-type": "text/event-stream" } },
    );
  };
  const model = new DeepSeekModelAdapter({
    apiKey: "fixture-not-a-key",
    model: "deepseek-flash",
    transport: new AiSdkDeepSeekTransport({ fetch: fetchMock }),
  });
  return {
    requests,
    effects: () => effects,
    run: () =>
      runAgent({
        runId: "summary-replay",
        prompt: "Summarize observed evidence",
        completionPolicy: "reserve-final-step",
        limits: { maxModelSteps: 2 },
        model,
        policy: new ReadOnlyPolicy(),
        signal: new AbortController().signal,
        tools: [
          {
            name: "read_file",
            description: "Read fixture",
            risk: "read",
            inputSchema: z.object({ path: z.string() }),
            execute: async () => {
              effects++;
              return {
                ok: true,
                output: { content: '{"name":"fixture"}' },
                truncated: false,
              };
            },
          },
        ],
        toolContext: {
          workspace: { root: "/fixture", cwd: "/fixture" },
          signal: new AbortController().signal,
          limits: { maxOutputBytes: 1000, maxEntries: 10 },
        },
      }),
  };
}

describe("DeepSeek tool-free output validity", () => {
  it.each([1, 7, 4096])(
    "falls back on the recorded raw DSML answer, chunk size %i",
    async (chunkSize) => {
      const f = fixture(`\n  ${rawSummary}`, chunkSize);
      const result = await f.run();
      expect(result).toMatchObject({
        status: "limit_reached",
        partial: true,
        limitReason: "model_step_limit",
        modelSteps: 2,
        toolCalls: 1,
      });
      expect(f.requests).toHaveLength(2);
      expect(f.requests[1]?.["tool_choice"]).toBe("none");
      expect(f.effects()).toBe(1);
      expect(result.finalText).toContain("Observed tool success");
      expect(result.finalText).toContain("unconfirmed");
      expect(result.finalText).not.toContain("DSML");
      expect(
        result.events.some(
          (event) =>
            event.type === "model.warning" &&
            event.message.includes("raw DSML"),
        ),
      ).toBe(true);
      expect(
        result.events.every(
          (event) =>
            event.type !== "model.text" || !event.text.includes("DSML"),
        ),
      ).toBe(true);
      expect(JSON.stringify(result.canonicalDelta)).not.toContain("DSML");
      validateCanonicalConversation(result.canonicalDelta ?? []);
    },
  );

  it.each([
    "Read package.json. Its name is fixture; no tests were run.",
    `Protocol example:\n${rawSummary}`,
    `\`\`\`xml\n${rawSummary}\n\`\`\``,
  ])(
    "preserves normal prose and explicitly quoted protocol examples",
    async (answer) => {
      const f = fixture(answer, 1);
      const result = await f.run();
      expect(result.finalText).toBe(answer);
      expect(
        result.events.some(
          (event) =>
            event.type === "model.warning" &&
            event.message.includes("raw DSML"),
        ),
      ).toBe(false);
      expect(f.effects()).toBe(1);
      expect(f.requests).toHaveLength(2);
    },
  );
});
