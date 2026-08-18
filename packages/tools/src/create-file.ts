import { lstat, open, unlink } from "node:fs/promises";

import type { ForgeTool, ToolContext, ToolResult } from "@forge/core";
import { z } from "zod";

import {
  cancelled,
  failure,
  isNodeError,
  relativeWorkspacePath,
  resolveNewToolPath,
} from "./path.js";

export const createFileInputSchema = z.object({
  path: z.string().min(1),
  content: z.string().max(65_536),
});

export type CreateFileInput = z.infer<typeof createFileInputSchema>;

export interface CreateFileOutput {
  readonly path: string;
  readonly bytes: number;
}

export interface CreateFilePreviewOutput extends CreateFileOutput {
  readonly diff: string;
}

export const createFileTool: ForgeTool = {
  name: "create_file",
  description:
    "Create one new UTF-8 text file inside the workspace. The call fails rather than replacing an existing path.",
  inputSchema: createFileInputSchema,
  risk: "write",
  execute: async (input, context) => {
    const parsed = createFileInputSchema.safeParse(input);
    if (!parsed.success) {
      return failure("invalid_input", "Invalid input for create_file.");
    }
    return createFile(parsed.data, context);
  },
};

export async function previewCreateFile(
  input: CreateFileInput,
  context: ToolContext,
): Promise<ToolResult<CreateFilePreviewOutput>> {
  const resolved = await resolveCreateTarget(input.path, context);
  if (!resolved.ok) {
    return resolved;
  }
  const relativePath = relativeWorkspacePath(context.workspace, resolved.path);
  const diff = formatCreateDiff(relativePath, input.content);
  const bounded = truncateUtf8(diff, context.limits.maxOutputBytes);
  return {
    ok: true,
    output: {
      path: relativePath,
      bytes: Buffer.byteLength(input.content, "utf8"),
      diff: bounded.value,
    },
    truncated: bounded.truncated,
  };
}

export async function createFile(
  input: CreateFileInput,
  context: ToolContext,
): Promise<ToolResult<CreateFileOutput>> {
  if (context.signal.aborted) {
    return cancelled();
  }
  const resolved = await resolveCreateTarget(input.path, context);
  if (!resolved.ok) {
    return resolved;
  }

  let handle: Awaited<ReturnType<typeof open>> | undefined;
  let created = false;
  let completed = false;
  try {
    handle = await open(resolved.path, "wx");
    created = true;
    await handle.writeFile(input.content, "utf8");
    if (context.signal.aborted) {
      return cancelled();
    }
    completed = true;
    return {
      ok: true,
      output: {
        path: relativeWorkspacePath(context.workspace, resolved.path),
        bytes: Buffer.byteLength(input.content, "utf8"),
      },
      truncated: false,
    };
  } catch (error) {
    if (isNodeError(error) && error.code === "EEXIST") {
      return failure(
        "already_exists",
        "The requested path already exists; use apply_patch to modify it.",
      );
    }
    return failure("io_error", "The file could not be created.", true);
  } finally {
    await handle?.close().catch(() => undefined);
    if (created && !completed) {
      await unlink(resolved.path).catch(() => undefined);
    }
  }
}

async function resolveCreateTarget(
  requestedPath: string,
  context: ToolContext,
): Promise<
  | { readonly ok: true; readonly path: string }
  | Extract<ToolResult, { readonly ok: false }>
> {
  const resolved = await resolveNewToolPath(requestedPath, context.workspace);
  if (!resolved.ok) {
    return resolved;
  }
  try {
    await lstat(resolved.path);
    return failure(
      "already_exists",
      "The requested path already exists; use apply_patch to modify it.",
    );
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") {
      return resolved;
    }
    return failure("io_error", "The destination could not be inspected.");
  }
}

function formatCreateDiff(path: string, content: string): string {
  const addedLines = content.split("\n").map((line) => `+${line}`);
  return [
    "--- /dev/null",
    `+++ b/${path}`,
    "@@ -0,0 +1 @@",
    ...addedLines,
    "",
  ].join("\n");
}

function truncateUtf8(
  value: string,
  maxBytes: number,
): { readonly value: string; readonly truncated: boolean } {
  const buffer = Buffer.from(value, "utf8");
  if (buffer.length <= maxBytes) {
    return { value, truncated: false };
  }
  return {
    value: buffer.subarray(0, maxBytes).toString("utf8"),
    truncated: true,
  };
}
