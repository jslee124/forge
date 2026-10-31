import { opendir, stat } from "node:fs/promises";
import path from "node:path";
import type { ForgeTool, ToolContext, ToolResult } from "@forge/core";
import { z } from "zod";
import { matchesFileGlob, supportedFileGlob } from "./file-filter.js";
import {
  cancelled,
  failure,
  relativeWorkspacePath,
  resolveToolPath,
} from "./path.js";
import { readFile } from "./read-file.js";

const MAX_SEARCH_FILE_BYTES = 1_048_576;
const MAX_SEARCH_SCAN_BYTES = 16 * 1024 * 1024;
const SOURCE_EXCLUDED_DIRECTORIES = new Set([
  ".git",
  "node_modules",
  ".next",
  "dist",
  "build",
  "coverage",
  ".venv",
  "__pycache__",
]);
const glob = z
  .string()
  .min(1)
  .max(256)
  .refine(
    supportedFileGlob,
    "Use relative globs with *, ?, or whole-segment **; no regex, traversal, or extglob.",
  );
export const searchInputSchema = z
  .object({
    query: z.string().min(1).max(1024),
    additionalQueries: z
      .array(z.string().min(1).max(1024))
      .max(3)
      .default([])
      .describe(
        "Up to three additional related literal symbols in the same bounded scan. All queries share maxMatches, scan and output budgets. Prefer a few relevant entry/call-site names over repeated broad searches.",
      ),
    path: z.string().min(1).default("."),
    scope: z
      .enum(["all", "source"])
      .default("all")
      .describe(
        "Source scope skips nested .git, node_modules, .next, dist, build, coverage, .venv and __pycache__ directories and reports their count. An explicitly targeted root directory is still searched; use all for generated/dependency code. Workspace permissions still apply.",
      ),
    caseSensitive: z.boolean().default(false),
    maxMatches: z.number().int().min(1).max(500).default(100),
    contextBefore: z.number().int().min(0).max(20).default(0),
    contextAfter: z.number().int().min(0).max(20).default(0),
    include: z
      .array(glob)
      .max(20)
      .default([])
      .describe(
        "Workspace-root-relative file globs; empty means all text files. Supports *, ?, and ** segments.",
      ),
    exclude: z
      .array(glob)
      .max(20)
      .default([])
      .describe(
        "Workspace-root-relative globs to omit, including directory subtrees such as node_modules/**.",
      ),
    mode: z
      .literal("literal")
      .default("literal")
      .describe(
        "Literal-only capability. Arbitrary regular expressions are not supported.",
      ),
  })
  .strict();
export type SearchInput = z.input<typeof searchInputSchema>;
type Match = {
  readonly path: string;
  readonly line: number;
  readonly column: number;
  readonly preview: string;
  readonly previewStartColumn: number;
  readonly previewTruncated: boolean;
  readonly matchedQueries?: readonly string[];
};
type ContextLine = {
  readonly line: number;
  readonly text: string;
  readonly startColumn: number;
  readonly matched: boolean;
  readonly truncated: boolean;
};
type ContextRange = {
  readonly path: string;
  readonly startLine: number;
  readonly endLine: number;
  readonly lines: readonly ContextLine[];
};
export interface SearchOutput {
  readonly query: string;
  readonly queries?: readonly string[];
  readonly scope?: "source";
  readonly skippedDirectories?: number;
  readonly mode: "literal";
  readonly matches: readonly Match[];
  /** Zero returned matches is bounded textual evidence, never a semantic absence claim. */
  readonly noMatch?: "No literal matches returned in the scanned scope; capability and runtime-state absence remain unproven.";
  readonly ranges?: readonly ContextRange[];
  readonly scannedFiles: number;
  readonly scanBudgetBytes: number;
  readonly skippedFiles: {
    readonly large: number;
    readonly binary: number;
    readonly unreadable: number;
  };
  readonly limits: readonly ("entries" | "matches" | "output" | "scan")[];
}
export const searchTool: ForgeTool = {
  name: "search",
  description:
    "Locate related source entrypoints and call sites in one bounded pass: query plus up to three additionalQueries, all literal. Use scope=source to avoid nested dependency/cache/build directories, small contextBefore/contextAfter (0–20), and relative include/exclude globs; overlapping context merges. A name match is evidence to inspect, not proof of a call or wiring. Zero returned literal matches do not prove a feature, telemetry, deployment or users absent. Regex is unsupported. Files over 1 MiB are skipped; all terms share scan, entry, match and output limits.",
  inputSchema: searchInputSchema,
  risk: "read",
  execute: (input, context) => {
    const parsed = searchInputSchema.safeParse(input);
    return parsed.success
      ? search(parsed.data, context)
      : Promise.resolve(
          failure(
            "invalid_input",
            "Invalid input for search; only literal mode and simple relative globs are supported.",
          ),
        );
  },
};
export async function search(
  input: SearchInput,
  context: ToolContext,
): Promise<ToolResult<SearchOutput>> {
  const parsed = searchInputSchema.safeParse(input);
  if (!parsed.success)
    return failure(
      "invalid_input",
      "Invalid input for search; only literal mode and simple relative globs are supported.",
    );
  const options = parsed.data;
  if (context.signal.aborted) return cancelled();
  const resolved = await resolveToolPath(options.path, context.workspace);
  if (!resolved.ok) return resolved;
  try {
    const excluded = (file: string) =>
      options.exclude.some((pattern) =>
        matchesFileGlob(
          relativeWorkspacePath(context.workspace, file),
          pattern,
        ),
      );
    const target = await stat(resolved.path);
    const collection = target.isFile()
      ? {
          files: excluded(resolved.path) ? [] : [resolved.path],
          truncated: false,
          skippedDirectories: 0,
        }
      : target.isDirectory()
        ? await collectFiles(
            resolved.path,
            context,
            excluded,
            options.scope === "source",
          )
        : undefined;
    if (!collection)
      return failure("not_file", "The requested path cannot be searched.");
    const matches: Match[] = [];
    let ranges: ContextRange[] = [];
    const limits = new Set<SearchOutput["limits"][number]>(
      collection.truncated ? ["entries"] : [],
    );
    const skippedFiles = { large: 0, binary: 0, unreadable: 0 };
    let scannedFiles = 0;
    let scannedBytes = 0;
    // Every metacharacter is escaped: this is a fixed literal pattern, not arbitrary regex execution.
    const queries = [...new Set([options.query, ...options.additionalQueries])];
    const needles = queries.map(
      (query) =>
        new RegExp(
          query.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&"),
          options.caseSensitive ? "u" : "iu",
        ),
    );
    const output = (
      candidateMatches: readonly Match[] = matches,
      candidateRanges: readonly ContextRange[] = ranges,
    ): SearchOutput => ({
      query: options.query,
      ...(queries.length > 1 ? { queries } : {}),
      ...(options.scope === "source"
        ? {
            scope: "source" as const,
            skippedDirectories: collection.skippedDirectories,
          }
        : {}),
      mode: "literal",
      matches: candidateMatches,
      ...(candidateMatches.length === 0
        ? {
            noMatch:
              "No literal matches returned in the scanned scope; capability and runtime-state absence remain unproven." as const,
          }
        : {}),
      ...(options.contextBefore || options.contextAfter
        ? { ranges: candidateRanges }
        : {}),
      scannedFiles,
      scanBudgetBytes: scannedBytes,
      skippedFiles,
      limits: [...limits],
    });
    for (const file of collection.files) {
      if (context.signal.aborted) return cancelled();
      const relative = relativeWorkspacePath(context.workspace, file);
      if (
        options.include.length &&
        !options.include.some((pattern) => matchesFileGlob(relative, pattern))
      )
        continue;
      if (scannedBytes >= MAX_SEARCH_SCAN_BYTES) {
        limits.add("scan");
        break;
      }
      let reservedBytes = 0;
      const remainingBytes = MAX_SEARCH_SCAN_BYTES - scannedBytes;
      try {
        const size = (await stat(file)).size;
        if (size > MAX_SEARCH_FILE_BYTES) {
          skippedFiles.large++;
          continue;
        }
        if (size + 1 > remainingBytes) {
          limits.add("scan");
          break;
        }
        reservedBytes = size;
        scannedBytes += size;
      } catch {
        skippedFiles.unreadable++;
        continue;
      }
      const read = await readFile(
        { path: file },
        {
          ...context,
          limits: {
            ...context.limits,
            maxOutputBytes: Math.min(MAX_SEARCH_FILE_BYTES, remainingBytes - 1),
          },
        },
      );
      if (!read.ok) {
        if (read.error.code === "cancelled") return read;
        // An error has no trustworthy byte count. Charge the full attempted
        // allowance so binary files and failures cannot bypass the scan budget.
        scannedBytes += Math.max(
          0,
          Math.min(MAX_SEARCH_FILE_BYTES + 1, remainingBytes) - reservedBytes,
        );
        if (read.error.code === "not_text") skippedFiles.binary++;
        else skippedFiles.unreadable++;
        continue;
      }
      scannedBytes += Math.max(0, read.output.scannedBytes - reservedBytes);
      scannedFiles++;
      if (read.truncated) {
        skippedFiles.large++;
        continue;
      }
      const lines = read.output.content.split(/\r?\n/u);
      if (lines.at(-1) === "") lines.pop();
      const fileMatches: Match[] = [];
      const previousRanges = ranges;
      for (const [index, line] of lines.entries()) {
        const hits = needles.flatMap((needle, queryIndex) => {
          const hit = needle.exec(line);
          return hit
            ? [
                {
                  index: hit.index,
                  query: queries[queryIndex] ?? options.query,
                },
              ]
            : [];
        });
        if (!hits.length) continue;
        const firstColumn = Math.min(...hits.map((hit) => hit.index));
        if (
          matches.length >= options.maxMatches ||
          matches.length >= context.limits.maxEntries
        ) {
          limits.add("matches");
          break;
        }
        const preview = previewLine(line, firstColumn);
        const match: Match = {
          path: relative,
          line: index + 1,
          column: firstColumn + 1,
          preview: preview.text,
          previewStartColumn: preview.startColumn,
          previewTruncated: preview.truncated,
          ...(queries.length > 1
            ? { matchedQueries: hits.map((hit) => hit.query) }
            : {}),
        };
        const nextFileMatches = [...fileMatches, match];
        const nextRanges =
          options.contextBefore || options.contextAfter
            ? [
                ...previousRanges,
                ...contextRanges(
                  relative,
                  lines,
                  nextFileMatches,
                  options.contextBefore,
                  options.contextAfter,
                ),
              ]
            : ranges;
        // Leave a small reserve for counters/limit labels which may change after this match.
        if (
          Buffer.byteLength(
            JSON.stringify(output([...matches, match], nextRanges)),
          ) +
            128 >
          context.limits.maxOutputBytes
        ) {
          limits.add("output");
          break;
        }
        matches.push(match);
        fileMatches.push(match);
        ranges = nextRanges;
      }
      if (limits.has("matches") || limits.has("output")) break;
    }
    if (context.signal.aborted) return cancelled();
    if (
      Buffer.byteLength(JSON.stringify(output())) >
      context.limits.maxOutputBytes
    )
      return failure(
        "output_limit",
        "The output budget cannot hold search metadata. Increase the output limit.",
      );
    return {
      ok: true,
      output: output(),
      truncated:
        limits.size > 0 ||
        skippedFiles.large > 0 ||
        skippedFiles.unreadable > 0,
    };
  } catch {
    return failure("io_error", "The workspace could not be searched.", true);
  }
}
function previewLine(text: string, matchIndex = 0) {
  let start = Math.max(0, matchIndex - 256);
  if (
    start > 0 &&
    text.charCodeAt(start) >= 0xdc00 &&
    text.charCodeAt(start) <= 0xdfff
  )
    start--;
  let end = Math.min(text.length, start + 2048);
  if (
    end < text.length &&
    text.charCodeAt(end - 1) >= 0xd800 &&
    text.charCodeAt(end - 1) <= 0xdbff
  )
    end--;
  return {
    text: text.slice(start, end),
    startColumn: start + 1,
    truncated: start > 0 || end < text.length,
  };
}
function contextRanges(
  file: string,
  lines: readonly string[],
  matches: readonly Match[],
  before: number,
  after: number,
): ContextRange[] {
  const intervals: { start: number; end: number }[] = [];
  for (const match of matches) {
    const start = Math.max(1, match.line - before);
    const end = Math.min(lines.length, match.line + after);
    const last = intervals.at(-1);
    if (last && start <= last.end + 1) last.end = Math.max(last.end, end);
    else intervals.push({ start, end });
  }
  const hitLines = new Map(
    matches.map((match) => [match.line, match.column - 1]),
  );
  return intervals.map(({ start, end }) => ({
    path: file,
    startLine: start,
    endLine: end,
    lines: Array.from({ length: end - start + 1 }, (_, i) => {
      const line = start + i;
      const preview = previewLine(
        lines[line - 1] ?? "",
        hitLines.get(line) ?? 0,
      );
      return {
        line,
        text: preview.text,
        startColumn: preview.startColumn,
        matched: hitLines.has(line),
        truncated: preview.truncated,
      };
    }),
  }));
}
async function collectFiles(
  root: string,
  context: ToolContext,
  excluded: (file: string) => boolean,
  sourceOnly: boolean,
): Promise<{
  files: string[];
  truncated: boolean;
  skippedDirectories: number;
}> {
  const files: string[] = [];
  let visited = 0;
  let truncated = false;
  let skippedDirectories = 0;
  const visit = async (directory: string) => {
    if (excluded(directory)) return;
    const children: import("node:fs").Dirent[] = [];
    const handle = await opendir(directory);
    for await (const child of handle) {
      if (context.signal.aborted) return;
      if (
        sourceOnly &&
        child.isDirectory() &&
        SOURCE_EXCLUDED_DIRECTORIES.has(child.name)
      ) {
        skippedDirectories++;
        continue;
      }
      if (children.length >= context.limits.maxEntries - visited) {
        truncated = true;
        break;
      }
      children.push(child);
    }
    children.sort((a, b) => a.name.localeCompare(b.name));
    for (const child of children) {
      if (context.signal.aborted) return;
      if (visited >= context.limits.maxEntries) {
        truncated = true;
        return;
      }
      visited++;
      const file = path.join(directory, child.name);
      if (child.isSymbolicLink() || excluded(file)) continue;
      if (child.isDirectory()) await visit(file);
      else if (child.isFile()) files.push(file);
    }
  };
  await visit(root);
  return { files, truncated, skippedDirectories };
}
