import { cp, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resolveWorkspace, search } from "@forge/tools";
import { expect, it } from "vitest";

it("collects frontend and backend call-site evidence in one bounded multi-symbol search", async () => {
  const root = await mkdtemp(join(tmpdir(), "forge-discovery-"));
  try {
    await cp(
      new URL("../fixtures/desktop-product/seed/", import.meta.url),
      root,
      { recursive: true },
    );
    const result = await search(
      {
        query: "receive",
        scope: "source",
        additionalQueries: ["onSubmit", "handle", "dispatch"],
        contextBefore: 1,
        contextAfter: 2,
        include: ["**/*.mjs", "**/*.tsx"],
      },
      {
        workspace: await resolveWorkspace(root),
        signal: new AbortController().signal,
        limits: { maxOutputBytes: 20000, maxEntries: 100 },
      },
    );
    expect(result).toMatchObject({ ok: true, truncated: false });
    if (!result.ok) throw new Error("Search failed");
    expect([...new Set(result.output.matches.map((m) => m.path))]).toEqual([
      "main.mjs",
      "renderer.tsx",
      "workflow.mjs",
    ]);
    const renderer = result.output.ranges?.find(
      (range) => range.path === "renderer.tsx",
    );
    expect(renderer?.lines).toEqual(
      expect.arrayContaining([
        {
          line: 8,
          text: "        send(draft);",
          startColumn: 1,
          matched: false,
          truncated: false,
        },
      ]),
    );
    const workflow = result.output.ranges
      ?.filter((range) => range.path === "workflow.mjs")
      .flatMap((range) => range.lines);
    expect(workflow).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ line: 25, text: "  return { requestId };" }),
        expect.objectContaining({
          line: 28,
          text: "  return tool(dispatch(requestId));",
        }),
      ]),
    );
    expect(result.output.matches.some((m) => m.path.startsWith("tools/"))).toBe(
      false,
    );
    expect(result.output.scanBudgetBytes).toBeLessThanOrEqual(16 * 1024 * 1024);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
