import { open, stat } from "node:fs/promises";

import type { ForgeTool, ToolContext, ToolResult } from "@forge/core";
import { z } from "zod";

import {
  cancelled,
  failure,
  relativeWorkspacePath,
  resolveToolPath,
} from "./path.js";

export const readFileInputSchema = z.object({
  path: z.string().min(1),
});

export type ReadFileInput = z.infer<typeof readFileInputSchema>;

export interface ReadFileOutput {
  readonly path: string;
  readonly content: string;
  readonly bytes: number;
}

export const readFileTool: ForgeTool = {
  name: "read_file",
  description:
    "Read a UTF-8 text file inside the selected workspace with a bounded result size.",
  inputSchema: readFileInputSchema,
  risk: "read",
  execute: async (input, context) => {
    const parsed = readFileInputSchema.safeParse(input);
    if (!parsed.success) {
      return failure("invalid_input", "Invalid input for read_file.");
    }
    return readFile(parsed.data, context);
  },
};

export async function readFile(
  input: ReadFileInput,
  context: ToolContext,
): Promise<ToolResult<ReadFileOutput>> {
  if (context.signal.aborted) {
    return cancelled();
  }

  const resolved = await resolveToolPath(input.path, context.workspace);
  if (!resolved.ok) {
    return resolved;
  }

  let handle: Awaited<ReturnType<typeof open>> | undefined;
  try {
    const targetStat = await stat(resolved.path);
    if (!targetStat.isFile()) {
      return failure("not_file", "The requested path is not a regular file.");
    }

    handle = await open(resolved.path, "r");
    const buffer = Buffer.alloc(context.limits.maxOutputBytes + 1);
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);

    if (context.signal.aborted) {
      return cancelled();
    }

    const outputBytes = Math.min(bytesRead, context.limits.maxOutputBytes);
    return {
      ok: true,
      output: {
        path: relativeWorkspacePath(context.workspace, resolved.path),
        content: buffer.subarray(0, outputBytes).toString("utf8"),
        bytes: outputBytes,
      },
      truncated: bytesRead > context.limits.maxOutputBytes,
    };
  } catch {
    return failure("io_error", "The file could not be read.", true);
  } finally {
    await handle?.close().catch(() => undefined);
  }
}
