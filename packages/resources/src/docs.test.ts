import {
  type ModelAdapter,
  type ModelStreamEvent,
  ReadOnlyPolicy,
  runAgent,
  type ToolContext,
} from "@forge/core";
import { describe, expect, it } from "vitest";

import { createForgeDocsTools, preferredForgeDocsLocale } from "./index.js";

const context: ToolContext = {
  workspace: { root: process.cwd(), cwd: process.cwd() },
  signal: new AbortController().signal,
  limits: { maxOutputBytes: 65_536, maxEntries: 200, commandTimeoutMs: 1_000 },
};

describe("Forge product documentation", () => {
  it("searches the preferred Chinese mirror and reads only stable references", async () => {
    const [search, read] = await createForgeDocsTools({ locale: "zh-CN" });
    const searched = await search.execute({ query: "插件 信任 安全" }, context);
    expect(searched).toMatchObject({
      ok: true,
      output: { preferredLocale: "zh-CN", unknown: false },
    });
    if (!searched.ok) throw new Error("Expected search results.");
    const result = (searched.output as { results: { reference: string }[] })
      .results[0];
    expect(result?.reference).toMatch(/^forge-doc:0\.3\.3:zh-CN:/u);
    const loaded = await read.execute(
      { reference: result?.reference },
      context,
    );
    expect(loaded).toMatchObject({ ok: true, output: { locale: "zh-CN" } });
  });

  it("rejects arbitrary package and workspace paths", async () => {
    const [, read] = await createForgeDocsTools({ locale: "en" });
    for (const reference of [
      "../../package.json",
      "/etc/passwd",
      "docs/SECURITY.md",
    ]) {
      await expect(read.execute({ reference }, context)).resolves.toMatchObject(
        {
          ok: false,
          error: { code: "not_found" },
        },
      );
    }
  });

  it("uses explicit locale detection and reports unknown product questions", async () => {
    expect(preferredForgeDocsLocale({ LANG: "zh_CN.UTF-8" })).toBe("zh-CN");
    expect(preferredForgeDocsLocale({ LANG: "en_US.UTF-8" })).toBe("en");
    const [search] = await createForgeDocsTools({ locale: "en" });
    await expect(
      search.execute({ query: "qzxv blorf zibble" }, context),
    ).resolves.toMatchObject({
      ok: true,
      output: { unknown: true, results: [] },
    });
    const [chineseSearch] = await createForgeDocsTools({ locale: "zh-CN" });
    await expect(
      chineseSearch.execute({ query: "accidental" }, context),
    ).resolves.toMatchObject({
      ok: true,
      output: {
        fallback: "zh-CN -> en",
        results: [
          expect.objectContaining({ locale: "en", fallbackFrom: "zh-CN" }),
        ],
      },
    });
  });

  it("completes a deterministic product-question slice with traceable doc events", async () => {
    const tools = await createForgeDocsTools({ locale: "en" });
    const searched = await tools[0].execute(
      { query: "project configuration provider" },
      context,
    );
    if (!searched.ok) throw new Error("Expected a reference fixture.");
    const reference = (searched.output as { results: { reference: string }[] })
      .results[0]?.reference;
    if (!reference) throw new Error("Expected a reference fixture.");
    const steps: readonly (readonly ModelStreamEvent[])[] = [
      [
        {
          type: "tool.call",
          call: {
            id: "search",
            name: "search_forge_docs",
            input: { query: "project configuration provider" },
          },
        },
        finish("tool-calls"),
      ],
      [
        {
          type: "tool.call",
          call: {
            id: "read",
            name: "read_forge_doc",
            input: { reference },
          },
        },
        finish("tool-calls"),
      ],
      [
        { type: "text.delta", text: `Documented answer: ${reference}` },
        finish("stop"),
      ],
    ];
    let index = 0;
    const model: ModelAdapter = {
      async *stream() {
        yield* steps[index++] ?? [];
      },
    };
    const result = await runAgent({
      prompt: "May project configuration select a provider?",
      instructions: "Search and cite packaged Forge documentation.",
      model,
      tools,
      policy: new ReadOnlyPolicy(),
      toolContext: context,
      signal: context.signal,
    });
    expect(result.status).toBe("completed");
    expect(result.finalText).toContain(reference);
    expect(result.events.map(({ type }) => type)).toEqual(
      expect.arrayContaining(["docs.search", "docs.read"]),
    );
  });
});

function finish(finishReason: "stop" | "tool-calls"): ModelStreamEvent {
  return {
    type: "finish",
    finishReason,
    usage: {
      inputTokens: 1,
      outputTokens: 1,
      reasoningTokens: 0,
      cachedInputTokens: 0,
      cacheWriteTokens: 0,
      totalTokens: 2,
    },
    ...(finishReason === "tool-calls"
      ? { continuation: { provider: "fake", data: {} } }
      : {}),
  };
}
