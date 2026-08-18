import { readFile, stat, writeFile } from "node:fs/promises";

import type { ForgeTool, ToolContext, ToolResult } from "@forge/core";
import { z } from "zod";

import {
  cancelled,
  failure,
  relativeWorkspacePath,
  resolveToolPath,
} from "./path.js";

const patchEditSchema = z.object({
  oldText: z.string().min(1).max(65_536),
  newText: z.string().max(65_536),
});

export const applyPatchInputSchema = z.object({
  path: z.string().min(1),
  edits: z.array(patchEditSchema).min(1).max(50),
});

export type ApplyPatchInput = z.infer<typeof applyPatchInputSchema>;

export interface ApplyPatchOutput {
  readonly path: string;
  readonly replacements: number;
  readonly diff: string;
}

interface PreparedPatch {
  readonly path: string;
  readonly relativePath: string;
  readonly content: string;
  readonly updatedContent: string;
  readonly diff: string;
}

export const applyPatchTool: ForgeTool = {
  name: "apply_patch",
  description:
    "Apply exact, structured text replacements to one existing workspace file. Each oldText must occur exactly once.",
  inputSchema: applyPatchInputSchema,
  risk: "write",
  execute: async (input, context) => {
    const parsed = applyPatchInputSchema.safeParse(input);
    if (!parsed.success) {
      return failure("invalid_input", "Invalid input for apply_patch.");
    }
    return applyPatch(parsed.data, context);
  },
};

export async function previewPatch(
  input: ApplyPatchInput,
  context: ToolContext,
): Promise<ToolResult<ApplyPatchOutput>> {
  const prepared = await preparePatch(input, context);
  if (!prepared.ok) {
    return prepared;
  }
  const diff = truncateUtf8(
    prepared.output.diff,
    context.limits.maxOutputBytes,
  );
  return {
    ok: true,
    output: {
      path: prepared.output.relativePath,
      replacements: input.edits.length,
      diff: diff.value,
    },
    truncated: diff.truncated,
  };
}

export async function applyPatch(
  input: ApplyPatchInput,
  context: ToolContext,
): Promise<ToolResult<ApplyPatchOutput>> {
  const prepared = await preparePatch(input, context);
  if (!prepared.ok) {
    return prepared;
  }
  if (context.signal.aborted) {
    return cancelled();
  }

  try {
    // Re-read immediately before writing so a concurrent user edit is not
    // silently replaced after the preview/validation step.
    const currentContent = await readFile(prepared.output.path, "utf8");
    if (currentContent !== prepared.output.content) {
      return failure(
        "stale_patch",
        "The file changed while the patch was being prepared; inspect it again before retrying.",
        true,
      );
    }
    await writeFile(
      prepared.output.path,
      prepared.output.updatedContent,
      "utf8",
    );
    const diff = truncateUtf8(
      prepared.output.diff,
      context.limits.maxOutputBytes,
    );
    return {
      ok: true,
      output: {
        path: prepared.output.relativePath,
        replacements: input.edits.length,
        diff: diff.value,
      },
      truncated: diff.truncated,
    };
  } catch {
    return failure("io_error", "The patch could not be written.", true);
  }
}

async function preparePatch(
  input: ApplyPatchInput,
  context: ToolContext,
): Promise<ToolResult<PreparedPatch>> {
  if (context.signal.aborted) {
    return cancelled();
  }
  const resolved = await resolveToolPath(input.path, context.workspace);
  if (!resolved.ok) {
    return resolved;
  }

  try {
    const targetStat = await stat(resolved.path);
    if (!targetStat.isFile()) {
      return failure("not_file", "The patch target is not a regular file.");
    }
    const content = await readFile(resolved.path, "utf8");
    let updatedContent = content;
    for (const edit of input.edits) {
      const first = updatedContent.indexOf(edit.oldText);
      const last = updatedContent.lastIndexOf(edit.oldText);
      if (first === -1) {
        return failure(
          "stale_patch",
          "Patch context was not found. Read the current file and retry with exact text.",
          true,
        );
      }
      if (first !== last) {
        return failure(
          "stale_patch",
          "Patch context is ambiguous because it occurs more than once.",
          true,
        );
      }
      updatedContent = `${updatedContent.slice(0, first)}${edit.newText}${updatedContent.slice(first + edit.oldText.length)}`;
    }
    const relativePath = relativeWorkspacePath(
      context.workspace,
      resolved.path,
    );
    return {
      ok: true,
      output: {
        path: resolved.path,
        relativePath,
        content,
        updatedContent,
        diff: formatDiff(relativePath, content, updatedContent),
      },
      truncated: false,
    };
  } catch {
    return failure("io_error", "The patch target could not be read.", true);
  }
}

function formatDiff(path: string, before: string, after: string): string {
  const beforeLines = before.split("\n");
  const afterLines = after.split("\n");
  let prefix = 0;
  while (
    prefix < beforeLines.length &&
    prefix < afterLines.length &&
    beforeLines[prefix] === afterLines[prefix]
  ) {
    prefix += 1;
  }
  let beforeSuffix = beforeLines.length - 1;
  let afterSuffix = afterLines.length - 1;
  while (
    beforeSuffix >= prefix &&
    afterSuffix >= prefix &&
    beforeLines[beforeSuffix] === afterLines[afterSuffix]
  ) {
    beforeSuffix -= 1;
    afterSuffix -= 1;
  }
  const contextStart = Math.max(0, prefix - 2);
  const beforeEnd = Math.min(beforeLines.length - 1, beforeSuffix + 2);
  const afterEnd = Math.min(afterLines.length - 1, afterSuffix + 2);
  const lines = [
    `--- a/${path}`,
    `+++ b/${path}`,
    `@@ -${contextStart + 1} +${contextStart + 1} @@`,
  ];
  for (let index = contextStart; index < prefix; index += 1) {
    lines.push(` ${beforeLines[index]}`);
  }
  for (let index = prefix; index <= beforeSuffix; index += 1) {
    lines.push(`-${beforeLines[index]}`);
  }
  for (let index = prefix; index <= afterSuffix; index += 1) {
    lines.push(`+${afterLines[index]}`);
  }
  const suffixCount = Math.min(
    beforeEnd - beforeSuffix,
    afterEnd - afterSuffix,
  );
  for (let offset = 1; offset <= suffixCount; offset += 1) {
    lines.push(` ${beforeLines[beforeSuffix + offset]}`);
  }
  return `${lines.join("\n")}\n`;
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
