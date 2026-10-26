import type { ModelStreamEvent } from "@forge/core";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { AiSdkCompatTransport } from "../../packages/model-compat/src/ai-sdk-transport.js";
import { AiSdkDeepSeekTransport } from "../../packages/model-deepseek/src/ai-sdk-transport.js";
import { AiSdkOpenAITransport } from "../../packages/model-openai/src/ai-sdk-transport.js";

const tools = [
  {
    name: "read_file",
    description: "Historical tool schema",
    inputSchema: z.object({ path: z.string() }),
  },
];
const signal = new AbortController().signal;
async function consume(stream: AsyncIterable<ModelStreamEvent>) {
  for await (const _event of stream) {
    /* consume */
  }
}
const cases = [
  {
    name: "OpenAI Responses",
    run: (fetchMock: typeof fetch) =>
      consume(
        new AiSdkOpenAITransport({ fetch: fetchMock }).stream(
          {
            apiKey: "fixture",
            model: "gpt-test",
            reasoningEffort: "low",
            prompt: "summarize",
            tools,
            toolChoice: "none",
            responseDirective: "Answer now using observed evidence.",
          },
          signal,
        ),
      ),
  },
  {
    name: "DeepSeek chat",
    run: (fetchMock: typeof fetch) =>
      consume(
        new AiSdkDeepSeekTransport({ fetch: fetchMock }).stream(
          {
            apiKey: "fixture",
            model: "deepseek-flash",
            thinking: "enabled",
            prompt: "summarize",
            tools,
            toolChoice: "none",
            responseDirective: "Answer now using observed evidence.",
          },
          signal,
        ),
      ),
  },
  ...(["openai-completions", "openai-responses"] as const).map((api) => ({
    name: `Compatible ${api}`,
    run: (fetchMock: typeof fetch) =>
      consume(
        new AiSdkCompatTransport({ fetch: fetchMock }).stream(
          {
            route: "fixture",
            api,
            baseUrl: "https://fixture.example/v1",
            model: "fixture",
            prompt: "summarize",
            tools,
            toolChoice: "none",
            responseDirective: "Answer now using observed evidence.",
          },
          signal,
        ),
      ),
  })),
];
describe("finalization transport projection", () => {
  it.each(cases)(
    "$name serializes none and retains tool schemas",
    async ({ run }) => {
      let body: Record<string, unknown> & {
        messages?: unknown;
        input?: unknown;
      } = {};
      const fetchMock: typeof fetch = async (_input, init) => {
        body = JSON.parse(String(init?.body)) as Record<string, unknown>;
        return new Response(
          JSON.stringify({ error: { message: "fixture stop" } }),
          { status: 400, headers: { "content-type": "application/json" } },
        );
      };
      await expect(run(fetchMock)).rejects.toThrow();
      const messages = (body.messages ?? body.input) as Array<{
        role: string;
      }>;
      expect(messages.at(-1)?.role).toBe("user");
      expect(JSON.stringify(messages.at(-1))).toContain(
        "Answer now using observed evidence.",
      );
      expect(body).toMatchObject({
        tool_choice: "none",
        tools: [expect.any(Object)],
      });
    },
  );
});
