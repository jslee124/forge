import { readdir, stat } from "node:fs/promises";
import path from "node:path";

import type { ForgeTool, ToolContext, ToolResult } from "@forge/core";
import { z } from "zod";

import {
  cancelled,
  failure,
  relativeWorkspacePath,
  resolveToolPath,
} from "./path.js";

export const listFilesInputSchema = z.object({
  path: z.string().min(1).default("."),
  depth: z.number().int().min(0).max(8).default(2),
});

export type ListFilesInput = z.infer<typeof listFilesInputSchema>;

export interface ListFilesOutput {
  readonly path: string;
  readonly entries: readonly {
    readonly path: string;
    readonly type: "directory" | "file" | "other" | "symlink";
  }[];
}

export const listFilesTool: ForgeTool = {
  name: "list_files",
  description:
    "List files and directories inside the selected workspace without following symlinks.",
  inputSchema: listFilesInputSchema,
  risk: "read",
  execute: async (input, context) => {
    const parsed = listFilesInputSchema.safeParse(input);
    if (!parsed.success) {
      return failure("invalid_input", "Invalid input for list_files.");
    }
    return listFiles(parsed.data, context);
  },
};

export async function listFiles(
  input: ListFilesInput,
  context: ToolContext,
): Promise<ToolResult<ListFilesOutput>> {
  if (context.signal.aborted) {
    return cancelled();
  }

  const resolved = await resolveToolPath(input.path, context.workspace);
  if (!resolved.ok) {
    return resolved;
  }

  try {
    const targetStat = await stat(resolved.path);
    if (!targetStat.isDirectory()) {
      return failure("not_directory", "The requested path is not a directory.");
    }

    const entries: Array<ListFilesOutput["entries"][number]> = [];
    let truncated = false;

    const visit = async (directory: string, remainingDepth: number) => {
      if (context.signal.aborted || truncated) {
        return;
      }

      const children = await readdir(directory, { withFileTypes: true });
      children.sort((left, right) => left.name.localeCompare(right.name));

      for (const child of children) {
        if (context.signal.aborted) {
          return;
        }

        const childPath = path.join(directory, child.name);
        const entry = {
          path: relativeWorkspacePath(context.workspace, childPath),
          type: child.isSymbolicLink()
            ? ("symlink" as const)
            : child.isDirectory()
              ? ("directory" as const)
              : child.isFile()
                ? ("file" as const)
                : ("other" as const),
        };

        if (
          entries.length >= context.limits.maxEntries ||
          !fitsOutputLimit(
            { path: input.path, entries: [...entries, entry] },
            context.limits.maxOutputBytes,
          )
        ) {
          truncated = true;
          return;
        }

        entries.push(entry);

        if (child.isDirectory() && remainingDepth > 0) {
          await visit(childPath, remainingDepth - 1);
        }
      }
    };

    await visit(resolved.path, input.depth);

    if (context.signal.aborted) {
      return cancelled();
    }

    return {
      ok: true,
      output: {
        path: relativeWorkspacePath(context.workspace, resolved.path),
        entries,
      },
      truncated,
    };
  } catch {
    return failure("io_error", "The directory could not be listed.", true);
  }
}

function fitsOutputLimit(output: unknown, maxBytes: number): boolean {
  return Buffer.byteLength(JSON.stringify(output), "utf8") <= maxBytes;
}
