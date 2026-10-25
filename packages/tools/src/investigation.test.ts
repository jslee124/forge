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
  it("accounts for binary read attempts and stops at the aggregate scan budget", async () => {
    const { root, context } = await fixture();
    for (let i = 0; i < 18; i++)
      await writeFile(
        join(root, `binary-${String(i).padStart(2, "0")}`),
        Buffer.from([0]),
      );
    const result = await search({ query: "absent" }, context);
    expect(result).toMatchObject({
      ok: true,
      truncated: true,
      output: { limits: ["scan"] },
    });
    if (!result.ok) throw new Error("fixture search failed");
    expect(result.output.scanBudgetBytes).toBeLessThanOrEqual(16 * 1024 * 1024);
    expect(result.output.skippedFiles.binary).toBeGreaterThan(0);
    expect(result.output.skippedFiles.binary).toBeLessThan(18);
  });
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
