import {
  mkdir,
  mkdtemp,
  open,
  readFile as readText,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import type { ToolContext } from "@forge/core";
import { afterEach, describe, expect, it } from "vitest";
import {
  editFile,
  readFile,
  readFileTool,
  resolveWorkspace,
  search,
  searchTool,
} from "./index.js";

const roots: string[] = [];
afterEach(async () => {
  for (const root of roots.splice(0))
    await rm(root, { recursive: true, force: true });
});
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "forge-investigation-"));
  roots.push(root);
  const context: ToolContext = {
    workspace: await resolveWorkspace(root),
    signal: new AbortController().signal,
    limits: { maxOutputBytes: 65_536, maxEntries: 200 },
  };
  return { root, context };
}
describe("bounded line investigation", () => {
  it.each(["", "\n", "a", "a\n", "a\nb", "你好\r\n\r\n结束"])(
    "numbers source lines without inventing a trailing line: %j",
    async (content) => {
      const { root, context } = await fixture();
      await writeFile(join(root, "note"), content);
      const expectedLines = content === "" ? [] : content.split(/(?<=\n)/);
      if (expectedLines.at(-1) === "") expectedLines.pop();
      const numbered = await readFile(
        { path: "note", format: "numbered" },
        context,
      );
      expect(numbered).toMatchObject({
        ok: true,
        truncated: false,
        output: {
          content: expectedLines.map((line, i) => `${i + 1}: ${line}`).join(""),
          contentFormat: "numbered",
          returnedLines: expectedLines.length,
          totalLines: expectedLines.length,
          totalLinesKnown: true,
          sha256: null,
          rewriteAvailable: false,
          partial: false,
        },
      });
      const raw = await readFile({ path: "note", format: "raw" }, context);
      expect(raw).toMatchObject({
        ok: true,
        output: { content, rewriteAvailable: true },
      });
      if (raw.ok) expect(raw.output).not.toHaveProperty("contentFormat");
      expect(await readText(join(root, "note"), "utf8")).toBe(content);
    },
  );
  it("never turns display labels into a guarded rewrite baseline", async () => {
    const { root, context } = await fixture();
    await writeFile(join(root, "note"), "original\n");
    const numbered = await readFile(
      { path: "note", format: "numbered" },
      context,
    );
    if (!numbered.ok) throw new Error("Numbered read failed");
    expect(
      await editFile(
        {
          operation: "rewrite",
          path: "note",
          content: "replacement",
          expectedSha256: numbered.output.resourceVersion,
        },
        context,
      ),
    ).toMatchObject({ ok: false, error: { code: "stale_file" } });
    expect(
      await readFileTool.execute({ path: "note", format: "unknown" }, context),
    ).toMatchObject({ ok: false, error: { code: "invalid_input" } });
    expect(await readText(join(root, "note"), "utf8")).toBe("original\n");
  });
  it("labels ranged reads with absolute source positions", async () => {
    const { root, context } = await fixture();
    await writeFile(join(root, "note"), "a\nb\nc\n");
    expect(
      await readFile(
        { path: "note", startLine: 2, lineCount: 2, format: "numbered" },
        context,
      ),
    ).toMatchObject({
      ok: true,
      truncated: false,
      output: {
        content: "2: b\n3: c\n",
        startLine: 2,
        endLine: 3,
        returnedLines: 2,
        bytes: 10,
        partial: true,
        rewriteAvailable: false,
        sha256: null,
      },
    });
    expect(
      await readFile(
        { path: "note", startLine: 8, format: "numbered" },
        context,
      ),
    ).toMatchObject({
      ok: true,
      truncated: false,
      output: { content: "", endLine: null, returnedLines: 0 },
    });
  });
  it("counts labels against the byte cap without splitting UTF-8 or emitting empty labels", async () => {
    const { root, context } = await fixture();
    await writeFile(join(root, "note"), "你好\r\n第二行\n");
    for (let maxOutputBytes = 0; maxOutputBytes < 32; maxOutputBytes++) {
      const result = await readFile(
        { path: "note", format: "numbered" },
        { ...context, limits: { ...context.limits, maxOutputBytes } },
      );
      if (!result.ok) throw new Error("Numbered read failed");
      expect(Buffer.byteLength(result.output.content)).toBeLessThanOrEqual(
        maxOutputBytes,
      );
      expect(result.output.bytes).toBe(
        Buffer.byteLength(result.output.content),
      );
      expect(result.output.content).not.toContain("�");
      expect(result.output.content).not.toMatch(/\d+: $/);
      expect(result.output.rewriteAvailable).toBe(false);
      if (result.truncated)
        expect(result.output.limitReason).toBe("output_limit");
    }
  });

  it("finds the middle without returning the prefix or granting whole-file rewrite", async () => {
    const { root, context } = await fixture();
    await writeFile(
      join(root, "large.txt"),
      Array.from({ length: 1000 }, (_, i) => `line ${i + 1}\n`).join(""),
    );
    const result = await readFile(
      { path: "large.txt", startLine: 501, lineCount: 3 },
      context,
    );
    expect(result).toMatchObject({
      ok: true,
      truncated: false,
      output: {
        content: "line 501\nline 502\nline 503\n",
        startLine: 501,
        endLine: 503,
        returnedLines: 3,
        totalLines: null,
        totalLinesKnown: false,
        partial: true,
        sha256: null,
        rewriteAvailable: false,
      },
    });
  });
  it.each(["", "\n", "a", "a\n", "a\nb"])(
    "counts complete files correctly: %j",
    async (content) => {
      const { root, context } = await fixture();
      await writeFile(join(root, "note"), content);
      const result = await readFile({ path: "note" }, context);
      const expected =
        content === ""
          ? 0
          : content.split("\n").length - Number(content.endsWith("\n"));
      expect(result).toMatchObject({
        ok: true,
        truncated: false,
        output: {
          content,
          returnedLines: expected,
          totalLines: expected,
          totalLinesKnown: true,
          rewriteAvailable: true,
          partial: false,
        },
      });
    },
  );
  it("preserves CRLF and UTF-8 characters across output boundaries", async () => {
    const { root, context } = await fixture();
    await writeFile(join(root, "note"), "A你好\r\n第二行\r\n");
    expect(
      await readFile({ path: "note", startLine: 2, lineCount: 1 }, context),
    ).toMatchObject({
      ok: true,
      output: {
        content: "第二行\r\n",
        startLine: 2,
        endLine: 2,
        totalLines: 2,
      },
    });
    expect(
      await readFile(
        { path: "note" },
        { ...context, limits: { ...context.limits, maxOutputBytes: 3 } },
      ),
    ).toMatchObject({
      ok: true,
      truncated: true,
      output: {
        content: "A",
        bytes: 1,
        limitReason: "output_limit",
        sha256: null,
      },
    });
  });
  it("does not hash an explicit range even when it happens to cover the entire file", async () => {
    const { root, context } = await fixture();
    await writeFile(join(root, "note"), "original\n");
    const partial = await readFile({ path: "note", lineCount: 200 }, context);
    expect(partial).toMatchObject({
      ok: true,
      output: {
        totalLinesKnown: true,
        sha256: null,
        rewriteAvailable: false,
        partial: true,
      },
    });
    if (!partial.ok) throw new Error("fixture read failed");
    const rewrite = await editFile(
      {
        operation: "rewrite",
        path: "note",
        content: "replacement",
        expectedSha256: partial.output.resourceVersion,
      },
      context,
    );
    expect(rewrite).toMatchObject({ ok: false, error: { code: "stale_file" } });
    expect(await readText(join(root, "note"), "utf8")).toBe("original\n");
  });
  it("identifies changed resources without changing the full-read hash contract", async () => {
    const { root, context } = await fixture();
    await writeFile(join(root, "note"), "one");
    const first = await readFile({ path: "note" }, context);
    await writeFile(join(root, "note"), "changed length");
    const second = await readFile({ path: "note" }, context);
    if (!first.ok || !second.ok) throw new Error("fixture reads failed");
    expect(first.output.resourceVersion).not.toBe(
      second.output.resourceVersion,
    );
    expect(
      await editFile(
        {
          operation: "rewrite",
          path: "note",
          content: "wrong",
          expectedSha256: first.output.sha256 ?? "",
        },
        context,
      ),
    ).toMatchObject({ ok: false, error: { code: "stale_file" } });
  });
  it("reports EOF beyond the requested start without inventing returned lines", async () => {
    const { root, context } = await fixture();
    await writeFile(join(root, "note"), "one\ntwo");
    expect(
      await readFile({ path: "note", startLine: 20, lineCount: 2 }, context),
    ).toMatchObject({
      ok: true,
      truncated: false,
      output: {
        content: "",
        startLine: 20,
        endLine: null,
        returnedLines: 0,
        totalLines: 2,
        totalLinesKnown: true,
      },
    });
  });
  it("bounds scans before an unreachable line and remains cancellable during skipping", async () => {
    const { root, context } = await fixture();
    const file = await open(join(root, "sparse"), "w");
    await file.truncate(64 * 1024 * 1024 + 1);
    await file.close();
    const result = await readFile({ path: "sparse", startLine: 2 }, context);
    expect(result).toMatchObject({
      ok: true,
      truncated: true,
      output: {
        content: "",
        limitReason: "scan_limit",
        totalLinesKnown: false,
        sha256: null,
      },
    });
    if (result.ok)
      expect(result.output.scannedBytes).toBeLessThanOrEqual(64 * 1024 * 1024);
    const controller = new AbortController();
    const reading = readFile(
      { path: "sparse", startLine: 2 },
      { ...context, signal: controller.signal },
    );
    setImmediate(() => controller.abort());
    expect(await reading).toMatchObject({
      ok: false,
      error: { code: "cancelled" },
    });
  });
  it("rejects invalid ranges, binary content, and symlink escapes", async () => {
    const { root, context } = await fixture();
    for (const input of [
      { path: "note", startLine: 0 },
      { path: "note", lineCount: 2001 },
      { path: "note", startLine: 1.5 },
    ])
      expect(await readFileTool.execute(input, context)).toMatchObject({
        ok: false,
        error: { code: "invalid_input" },
      });
    await writeFile(join(root, "binary"), Buffer.from([0xff, 0xfe]));
    expect(await readFile({ path: "binary" }, context)).toMatchObject({
      ok: false,
      error: { code: "not_text" },
    });
    const outside = await mkdtemp(join(tmpdir(), "forge-outside-"));
    roots.push(outside);
    await writeFile(join(outside, "secret"), "outside");
    await symlink(join(outside, "secret"), join(root, "link"));
    expect(
      await readFile({ path: "link", startLine: 1 }, context),
    ).toMatchObject({ ok: false, error: { code: "outside_workspace" } });
  });
});

describe("literal search with bounded context", () => {
  it("lets source investigation reach code without spending the entry budget in dependency/build trees", async () => {
    const { root, context } = await fixture();
    await mkdir(join(root, "node_modules"));
    await mkdir(join(root, "dist"));
    await mkdir(join(root, "src"));
    for (let i = 0; i < 10; i++)
      await writeFile(
        join(root, "node_modules", `dep-${i}.js`),
        "dependency\n",
      );
    await writeFile(join(root, "dist", "bundle.js"), "handle generated\n");
    await writeFile(join(root, "src", "entry.ts"), "handle(request)\n");
    const bounded = {
      ...context,
      limits: { ...context.limits, maxEntries: 3 },
    };
    const all = await search({ query: "handle" }, bounded);
    expect(all).toMatchObject({ ok: true, truncated: true });
    if (all.ok)
      expect(
        all.output.matches.some((match) => match.path.startsWith("src/")),
      ).toBe(false);
    expect(
      await search({ query: "handle", scope: "source" }, bounded),
    ).toMatchObject({
      ok: true,
      truncated: false,
      output: {
        scope: "source",
        skippedDirectories: 2,
        scannedFiles: 1,
        matches: [{ path: "src/entry.ts" }],
      },
    });
    expect(
      await search(
        { query: "dependency", path: "node_modules", scope: "source" },
        context,
      ),
    ).toMatchObject({
      ok: true,
      truncated: false,
      output: { scope: "source", skippedDirectories: 0, scannedFiles: 10 },
    });
  });
  it("finds related symbols in one scan, merges context and counts a shared line once", async () => {
    const { root, context } = await fixture();
    const content = "header\nsend -> handle\ndispatch\nfooter\n";
    await writeFile(join(root, "code.ts"), content);
    const result = await search(
      {
        query: "handle",
        additionalQueries: ["send", "dispatch", "send"],
        contextBefore: 1,
        contextAfter: 1,
      },
      context,
    );
    expect(result).toMatchObject({
      ok: true,
      truncated: false,
      output: {
        query: "handle",
        queries: ["handle", "send", "dispatch"],
        scannedFiles: 1,
        scanBudgetBytes: Buffer.byteLength(content),
        matches: [
          { line: 2, column: 1, matchedQueries: ["handle", "send"] },
          { line: 3, column: 1, matchedQueries: ["dispatch"] },
        ],
        ranges: [{ startLine: 1, endLine: 4 }],
      },
    });
  });
  it("keeps omitted or duplicate additional queries equivalent to a single query", async () => {
    const { root, context } = await fixture();
    await writeFile(join(root, "code"), "needle\n");
    const single = await search({ query: "needle" }, context);
    expect(
      await search({ query: "needle", additionalQueries: [] }, context),
    ).toEqual(single);
    expect(
      await search({ query: "needle", additionalQueries: ["needle"] }, context),
    ).toEqual(single);
  });
  it("applies literal/case rules to every term and rejects excessive or invalid groups", async () => {
    const { root, context } = await fixture();
    await writeFile(join(root, "code"), "a.*b\naxb\nSEND\nsend\n");
    expect(
      await search(
        {
          query: "absent",
          additionalQueries: ["a.*b", "send"],
          caseSensitive: true,
        },
        context,
      ),
    ).toMatchObject({
      ok: true,
      output: {
        matches: [
          { line: 1, matchedQueries: ["a.*b"] },
          { line: 4, matchedQueries: ["send"] },
        ],
      },
    });
    for (const additionalQueries of [
      ["a", "b", "c", "d"],
      [""],
      ["x".repeat(1025)],
    ])
      expect(
        await searchTool.execute({ query: "x", additionalQueries }, context),
      ).toMatchObject({ ok: false, error: { code: "invalid_input" } });
  });
  it("shares match and output limits across all terms", async () => {
    const { root, context } = await fixture();
    await writeFile(join(root, "code"), "send\nhandle\ndispatch\n");
    expect(
      await search(
        {
          query: "send",
          additionalQueries: ["handle", "dispatch"],
          maxMatches: 1,
        },
        context,
      ),
    ).toMatchObject({
      ok: true,
      truncated: true,
      output: { matches: [{ line: 1 }], limits: ["matches"] },
    });
    const bounded = await search(
      {
        query: "send",
        additionalQueries: ["handle", "dispatch"],
        contextBefore: 20,
        contextAfter: 20,
      },
      { ...context, limits: { ...context.limits, maxOutputBytes: 450 } },
    );
    expect(bounded).toMatchObject({
      ok: true,
      truncated: true,
      output: { limits: ["output"] },
    });
    if (bounded.ok)
      expect(
        Buffer.byteLength(JSON.stringify(bounded.output)),
      ).toBeLessThanOrEqual(450);
  });
  it("keeps filters, cancellation and workspace boundaries for grouped searches", async () => {
    const { root, context } = await fixture();
    const outside = await mkdtemp(join(tmpdir(), "forge-search-outside-"));
    roots.push(outside);
    await writeFile(join(root, "yes.ts"), "send\n");
    await writeFile(join(root, "no.js"), "handle\n");
    await writeFile(join(outside, "secret"), "send\nhandle\n");
    await symlink(join(outside, "secret"), join(root, "link.ts"));
    expect(
      await search(
        { query: "send", additionalQueries: ["handle"], include: ["*.ts"] },
        context,
      ),
    ).toMatchObject({ ok: true, output: { matches: [{ path: "yes.ts" }] } });
    expect(
      await search(
        { query: "send", additionalQueries: ["handle"], path: outside },
        context,
      ),
    ).toMatchObject({ ok: false, error: { code: "outside_workspace" } });
    const controller = new AbortController();
    controller.abort();
    expect(
      await search(
        { query: "send", additionalQueries: ["handle"] },
        { ...context, signal: controller.signal },
      ),
    ).toMatchObject({ ok: false, error: { code: "cancelled" } });
  });
  it("merges overlapping contexts and keeps accurate locations", async () => {
    const { root, context } = await fixture();
    await writeFile(
      join(root, "code.ts"),
      "before\nneedle one\nbetween\nneedle two\nafter\n",
    );
    const result = await search(
      { query: "needle", contextBefore: 1, contextAfter: 1 },
      context,
    );
    expect(result).toMatchObject({
      ok: true,
      truncated: false,
      output: {
        mode: "literal",
        matches: [
          { line: 2, column: 1 },
          { line: 4, column: 1 },
        ],
        ranges: [
          {
            startLine: 1,
            endLine: 5,
            lines: [
              { line: 1, matched: false },
              { line: 2, matched: true },
              { line: 3, matched: false },
              { line: 4, matched: true },
              { line: 5, matched: false },
            ],
          },
        ],
      },
    });
  });
  it("filters paths relative to the workspace and excludes complete subtrees", async () => {
    const { root, context } = await fixture();
    await mkdir(join(root, "src"));
    await mkdir(join(root, "generated"));
    for (const file of [
      "root.ts",
      "src/yes.ts",
      "src/no.js",
      "generated/no.ts",
    ])
      await writeFile(join(root, file), "needle\n");
    const result = await search(
      { query: "needle", include: ["**/*.ts"], exclude: ["generated/**"] },
      context,
    );
    expect(result).toMatchObject({
      ok: true,
      truncated: false,
      output: { matches: [{ path: "root.ts" }, { path: "src/yes.ts" }] },
    });
    const nested = await search(
      { query: "needle", path: "src", include: ["src/*.ts"] },
      context,
    );
    expect(nested).toMatchObject({
      ok: true,
      output: { matches: [{ path: "src/yes.ts" }] },
    });
  });
  it("treats metacharacters literally and rejects arbitrary regex and complex globs", async () => {
    const { root, context } = await fixture();
    await writeFile(join(root, "code"), "literal (a+)+$\naaaaaaa\n");
    expect(await search({ query: "(a+)+$" }, context)).toMatchObject({
      ok: true,
      truncated: false,
      output: { matches: [{ line: 1, column: 9 }] },
    });
    for (const input of [
      { query: "(a+)+$", mode: "regex" },
      { query: "a", regex: true },
      { query: "a", include: ["../*"] },
      { query: "a", include: ["**/@(a|b)"] },
    ])
      expect(await searchTool.execute(input, context)).toMatchObject({
        ok: false,
        error: { code: "invalid_input" },
      });
  });
  it("returns the correct Unicode column and useful evidence for very long lines", async () => {
    const { root, context } = await fixture();
    await writeFile(
      join(root, "code"),
      `İx ANSWER\n${"x".repeat(100_000)}needle${"x".repeat(100_000)}\n`,
    );
    const unicode = await search({ query: "answer" }, context);
    expect(unicode).toMatchObject({
      ok: true,
      output: { matches: [{ line: 1, column: 4 }] },
    });
    const long = await search({ query: "needle" }, context);
    expect(long).toMatchObject({
      ok: true,
      output: {
        matches: [{ line: 2, column: 100_001, previewTruncated: true }],
      },
    });
    if (long.ok) expect(long.output.matches[0]?.preview).toContain("needle");
  });
  it("discloses entry, match, output and oversized-file omissions", async () => {
    const { root, context } = await fixture();
    await writeFile(join(root, "a"), "needle\nneedle\n");
    await writeFile(join(root, "huge"), "x".repeat(1_048_577));
    expect(
      await search({ query: "needle", maxMatches: 1 }, context),
    ).toMatchObject({
      ok: true,
      truncated: true,
      output: { limits: ["matches"] },
    });
    expect(await search({ query: "absent" }, context)).toMatchObject({
      ok: true,
      truncated: true,
      output: { skippedFiles: { large: 1 } },
    });
    const limited = await search(
      { query: "needle", contextBefore: 20, contextAfter: 20 },
      { ...context, limits: { ...context.limits, maxOutputBytes: 300 } },
    );
    expect(limited).toMatchObject({
      ok: true,
      truncated: true,
      output: { limits: ["output"] },
    });
    const entries = await search(
      { query: "needle" },
      { ...context, limits: { ...context.limits, maxEntries: 1 } },
    );
    expect(entries).toMatchObject({ ok: true, truncated: true });
  });
  it.each([
    { additionalQueries: [] },
    { additionalQueries: ["also-absent", "still-absent", "missing"] },
  ])(
    "accounts for binary attempts and a shared scan budget ($additionalQueries)",
    async ({ additionalQueries }) => {
      const { root, context } = await fixture();
      for (let i = 0; i < 18; i++)
        await writeFile(
          join(root, `binary-${String(i).padStart(2, "0")}`),
          Buffer.from([0]),
        );
      const result = await search(
        { query: "absent", additionalQueries },
        context,
      );
      expect(result).toMatchObject({
        ok: true,
        truncated: true,
        output: { limits: ["scan"] },
      });
      if (!result.ok) throw new Error("fixture search failed");
      expect(result.output.scanBudgetBytes).toBeLessThanOrEqual(
        16 * 1024 * 1024,
      );
      expect(result.output.skippedFiles.binary).toBeGreaterThan(0);
      expect(result.output.skippedFiles.binary).toBeLessThan(18);
    },
  );
  it("preserves complete surrogate pairs in clipped previews and rejects unusably small output budgets", async () => {
    const { root, context } = await fixture();
    await writeFile(
      join(root, "emoji"),
      `${"😀".repeat(2000)}needle${"😀".repeat(2000)}`,
    );
    const result = await search({ query: "needle", contextAfter: 1 }, context);
    expect(result).toMatchObject({
      ok: true,
      output: { matches: [{ previewTruncated: true }] },
    });
    if (!result.ok) throw new Error("fixture search failed");
    expect(result.output.matches[0]?.preview.isWellFormed()).toBe(true);
    expect(result.output.matches[0]?.preview).toContain("needle");
    expect(
      await search(
        { query: "needle" },
        { ...context, limits: { ...context.limits, maxOutputBytes: 16 } },
      ),
    ).toMatchObject({ ok: false, error: { code: "output_limit" } });
  });
  it("matches single-character globs against Unicode filenames", async () => {
    const { root, context } = await fixture();
    for (const file of ["文.ts", "😀.ts", "long.ts"])
      await writeFile(join(root, file), "needle");
    const result = await search(
      { query: "needle", include: ["?.ts"] },
      context,
    );
    if (!result.ok) throw new Error("fixture search failed");
    expect(result.output.matches.map((match) => match.path).sort()).toEqual(
      ["文.ts", "😀.ts"].sort(),
    );
  });
});

describe("negative literal evidence", () => {
  it("does not confuse a missing keyword with missing implemented metrics", async () => {
    const { root, context } = await fixture();
    const modulePath = join(root, "counts.mjs");
    await writeFile(
      modulePath,
      `export function dailyUsers(events, day) {
  return new Set(events.filter(e => e.day === day).map(e => e.actor)).size;
}
`,
    );
    const result = await search(
      { query: "analytics", scope: "source" },
      context,
    );
    expect(result).toMatchObject({
      ok: true,
      truncated: false,
      output: {
        matches: [],
        scannedFiles: 1,
        limits: [],
        noMatch: expect.stringContaining("absence remain unproven"),
      },
    });
    const module = (await import(pathToFileURL(modulePath).href)) as {
      dailyUsers(events: { day: string; actor: string }[], day: string): number;
    };
    expect(
      module.dailyUsers(
        [
          { day: "day-one", actor: "a" },
          { day: "day-one", actor: "a" },
          { day: "day-one", actor: "b" },
          { day: "day-two", actor: "c" },
        ],
        "day-one",
      ),
    ).toBe(2);
  });
  it("keeps zero-result meaning scoped when directories or filters exclude matching code", async () => {
    const { root, context } = await fixture();
    await mkdir(join(root, "dist"));
    await writeFile(join(root, "dist", "counter.js"), "analytics();\n");
    await writeFile(join(root, "note.txt"), "nothing to match\n");
    const source = await search(
      { query: "analytics", scope: "source" },
      context,
    );
    expect(source).toMatchObject({
      ok: true,
      truncated: false,
      output: {
        matches: [],
        skippedDirectories: 1,
        noMatch: expect.stringContaining("scanned scope"),
      },
    });
    const filtered = await search(
      { query: "analytics", include: ["*.txt"] },
      context,
    );
    expect(filtered).toMatchObject({
      ok: true,
      output: {
        matches: [],
        scannedFiles: 1,
        noMatch: expect.any(String),
      },
    });
    const all = await search({ query: "analytics" }, context);
    expect(all).toMatchObject({
      ok: true,
      output: { matches: [{ path: "dist/counter.js" }] },
    });
    if (all.ok) expect(all.output).not.toHaveProperty("noMatch");
  });
  it("counts zero-result explanation in the actual output limit, including omitted hits", async () => {
    const { root, context } = await fixture();
    await writeFile(join(root, "code"), "needle\n");
    const result = await search(
      { query: "needle", contextBefore: 20, contextAfter: 20 },
      { ...context, limits: { ...context.limits, maxOutputBytes: 350 } },
    );
    expect(result).toMatchObject({
      ok: true,
      truncated: true,
      output: {
        matches: [],
        limits: ["output"],
        noMatch: expect.stringContaining("returned"),
      },
    });
    if (result.ok)
      expect(
        Buffer.byteLength(JSON.stringify(result.output)),
      ).toBeLessThanOrEqual(350);
    expect(
      await search(
        { query: "missing" },
        { ...context, limits: { ...context.limits, maxOutputBytes: 32 } },
      ),
    ).toMatchObject({ ok: false, error: { code: "output_limit" } });
  });
});
