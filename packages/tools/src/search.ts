import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";

import type { ForgeTool, ToolContext, ToolResult } from "@forge/core";
import { z } from "zod";

import {
  cancelled,
  failure,
  relativeWorkspacePath,
  resolveToolPath,
} from "./path.js";

const MAX_SEARCH_FILE_BYTES = 1_048_576;

export const searchInputSchema = z.object({
  query: z.string().min(1).max(1024),
  path: z.string().min(1).default("."),
  caseSensitive: z.boolean().default(false),
  maxMatches: z.number().int().min(1).max(500).default(100),
});

export type SearchInput = z.infer<typeof searchInputSchema>;

export interface SearchOutput {
  readonly query: string;
  readonly matches: readonly {
    readonly path: string;
    readonly line: number;
    readonly column: number;
    readonly preview: string;
  }[];
}

export const searchTool: ForgeTool = {
  name: "search",
  description:
    "Search for literal text in UTF-8 files inside the selected workspace.",
  inputSchema: searchInputSchema,
  risk: "read",
  execute: async (input, context) => {
    const parsed = searchInputSchema.safeParse(input);
    if (!parsed.success) {
      return failure("invalid_input", "Invalid input for search.");
    }
    return search(parsed.data, context);
  },
};

export async function search(
  input: SearchInput,
  context: ToolContext,
): Promise<ToolResult<SearchOutput>> {
  if (context.signal.aborted) {
    return cancelled();
  }

  const resolved = await resolveToolPath(input.path, context.workspace);
  if (!resolved.ok) {
    return resolved;
  }

  try {
    const targetStat = await stat(resolved.path);
    const collection = targetStat.isFile()
      ? { files: [resolved.path], truncated: false }
      : targetStat.isDirectory()
        ? await collectFiles(resolved.path, context)
        : undefined;
    if (!collection) {
      return failure("not_file", "The requested path cannot be searched.");
    }
    const matches: Array<SearchOutput["matches"][number]> = [];
    let truncated = false;
    const needle = input.caseSensitive
      ? input.query
      : input.query.toLowerCase();

    for (const file of collection.files) {
      if (context.signal.aborted) {
        return cancelled();
      }

      const fileStat = await stat(file);
      if (fileStat.size > MAX_SEARCH_FILE_BYTES) {
        continue;
      }

      const content = await readFile(file, "utf8");
      if (content.includes("\0")) {
        continue;
      }

      const lines = content.split(/\r?\n/u);
      for (const [lineIndex, line] of lines.entries()) {
        const haystack = input.caseSensitive ? line : line.toLowerCase();
        const column = haystack.indexOf(needle);
        if (column === -1) {
          continue;
        }

        const match = {
          path: relativeWorkspacePath(context.workspace, file),
          line: lineIndex + 1,
          column: column + 1,
          preview: line,
        };
        if (
          matches.length >= input.maxMatches ||
          matches.length >= context.limits.maxEntries ||
          !fitsOutputLimit(
            { query: input.query, matches: [...matches, match] },
            context.limits.maxOutputBytes,
          )
        ) {
          truncated = true;
          break;
        }
        matches.push(match);
      }

      if (truncated) {
        break;
      }
    }

    return {
      ok: true,
      output: { query: input.query, matches },
      truncated: truncated || collection.truncated,
    };
  } catch {
    return failure("io_error", "The workspace could not be searched.", true);
  }
}

async function collectFiles(
  root: string,
  context: ToolContext,
): Promise<{ readonly files: string[]; readonly truncated: boolean }> {
  const files: string[] = [];
  let visited = 0;
  let truncated = false;

  const visit = async (directory: string) => {
    const children = await readdir(directory, { withFileTypes: true });
    children.sort((left, right) => left.name.localeCompare(right.name));

    for (const child of children) {
      if (context.signal.aborted) {
        return;
      }
      if (visited >= context.limits.maxEntries) {
        truncated = true;
        return;
      }
      visited += 1;

      if (child.isSymbolicLink()) {
        continue;
      }

      const childPath = path.join(directory, child.name);
      if (child.isDirectory()) {
        await visit(childPath);
      } else if (child.isFile()) {
        files.push(childPath);
      }
    }
  };

  await visit(root);
  return { files, truncated };
}

function fitsOutputLimit(output: unknown, maxBytes: number): boolean {
  return Buffer.byteLength(JSON.stringify(output), "utf8") <= maxBytes;
}
