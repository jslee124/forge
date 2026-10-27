import type { ModelStreamEvent } from "@forge/core";
import { expect, it } from "vitest";
import { z } from "zod";
import { AiSdkCompatTransport } from "../../../../packages/model-compat/src/ai-sdk-transport.js";
import { controlStressEvents } from "./product-control-stream.js";
import { CANCEL_COMMAND } from "./product-live-scenarios.js";

it("delivers all 10000 reasoning deltas and one command through the real Responses parser without network", async () => {
  const chunks =
    Array.from(controlStressEvents())
      .map((event) => `data: ${JSON.stringify(event)}\n\n`)
      .join("") + "data: [DONE]\n\n";
  const transport = new AiSdkCompatTransport({
    fetch: async () =>
      new Response(chunks, {
        headers: { "content-type": "text/event-stream" },
      }),
  });
  const events: ModelStreamEvent[] = [];
  for await (const event of transport.stream(
    {
      route: "control-fixture",
      api: "openai-responses",
      baseUrl: "http://127.0.0.1:1/v1",
      model: "scripted",
      prompt: "local stress",
      tools: [
        {
          name: "run_command",
          description: "fixture command",
          inputSchema: z.object({
            program: z.string(),
            args: z.array(z.string()),
            cwd: z.string(),
          }),
        },
      ],
    },
    new AbortController().signal,
  ))
    events.push(event);
  expect(
    events.filter((event) => event.type === "reasoning.delta"),
  ).toHaveLength(10000);
  const text = events
    .filter((event) => event.type === "text.delta")
    .map((event) => event.text)
    .join("");
  expect(text.length).toBeGreaterThan(100000);
  expect(events.filter((event) => event.type === "tool.call")).toMatchObject([
    {
      call: {
        name: "run_command",
        input: { program: "node", args: ["-e", CANCEL_COMMAND], cwd: "." },
      },
    },
  ]);
  expect(events.at(-1)).toMatchObject({
    type: "finish",
    finishReason: "tool-calls",
  });
});
