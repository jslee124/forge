import { createHash } from "node:crypto";
import { readFile, stat, writeFile } from "node:fs/promises";

import type { ForgeTool, ToolContext, ToolResult } from "@forge/core";
import { z } from "zod";

import {
  type ApplyPatchInput,
  applyPatch,
  previewPatch,
} from "./apply-patch.js";
import {
  type CreateFileInput,
  createFile,
  previewCreateFile,
} from "./create-file.js";
import {
  cancelled,
  failure,
  relativeWorkspacePath,
  resolveToolPath,
} from "./path.js";

const pathSchema = z
  .string()
  .min(1)
  .describe("Workspace-relative path of the file to edit.");
const contentSchema = z
  .string()
  .max(65_536)
  .describe("Complete UTF-8 content for a create or guarded rewrite.");
const exactEditSchema = z.object({
  oldText: z
    .string()
    .min(1)
    .max(65_536)
    .describe("Exact text that must occur once in the current file."),
  newText: z
    .string()
    .max(65_536)
    .describe("Replacement text; use an empty string to remove oldText."),
});

export type EditFileInput =
  | {
      readonly operation: "create";
      readonly path: string;
      readonly content: string;
    }
  | {
      readonly operation: "replace";
      readonly path: string;
      readonly edits: z.infer<typeof exactEditSchema>[];
    }
  | {
      readonly operation: "rewrite";
      readonly path: string;
      readonly content: string;
      readonly expectedSha256: string;
    };

export const editFileInputSchema = z
  .object({
    operation: z
      .enum(["create", "replace", "rewrite"])
      .describe(
        "create makes an absent file; replace changes exact text; rewrite replaces a previously read file.",
      ),
    path: pathSchema,
    content: contentSchema
      .optional()
      .describe("Required for create/rewrite; omit for replace."),
    edits: z
      .array(exactEditSchema)
      .min(1)
      .max(50)
      .optional()
      .describe(
        "Required for replace; omit for create/rewrite. Ordered exact replacements; every oldText must match once.",
      ),
    expectedSha256: z
      .string()
      .regex(/^[a-f0-9]{64}$/)
      .optional()
      .describe(
        "Required for rewrite; omit otherwise. SHA-256 returned by a complete prior read_file result.",
      ),
  })
  .superRefine((input, context) => {
    const valid =
      (input.operation === "create" &&
        input.content !== undefined &&
        input.edits === undefined &&
        input.expectedSha256 === undefined) ||
      (input.operation === "replace" &&
        input.content === undefined &&
        input.edits !== undefined &&
        input.expectedSha256 === undefined) ||
      (input.operation === "rewrite" &&
        input.content !== undefined &&
        input.edits === undefined &&
        input.expectedSha256 !== undefined);
    if (!valid) {
      context.addIssue({
        code: "custom",
        message: "Fields do not match edit_file operation.",
      });
    }
  });

export interface EditFileOutput {
  readonly operation: EditFileInput["operation"];
  readonly path: string;
  readonly bytes: number;
  readonly replacements?: number;
  readonly sha256: string;
  readonly diff: string;
}

interface PreparedRewrite {
  readonly path: string;
  readonly relativePath: string;
  readonly content: string;
  readonly diff: string;
}

export const editFileTool: ForgeTool = {
  name: "edit_file",
  description:
    "Create a new text file, replace exact text in an existing file, or rewrite an existing file that was read at the supplied version. Never use create for an existing path.",
  inputSchema: editFileInputSchema,
  risk: "write",
  execute: async (input, context) => {
    const parsed = editFileInputSchema.safeParse(input);
    if (!parsed.success) {
      return failure("invalid_input", "Invalid input for edit_file.");
    }
    return editFile(parsed.data as EditFileInput, context);
  },
};

export async function previewEditFile(
  input: EditFileInput,
  context: ToolContext,
): Promise<ToolResult<EditFileOutput>> {
  if (input.operation === "create") {
    const preview = await previewCreateFile(input as CreateFileInput, context);
    if (!preview.ok) return preview;
    return success(
      input,
      preview.output.path,
      input.content,
      preview.output.diff,
      undefined,
      preview.truncated,
    );
  }
  if (input.operation === "replace") {
    const preview = await previewPatch(input as ApplyPatchInput, context);
    if (!preview.ok) return preview;
    const resolved = await resolveToolPath(input.path, context.workspace);
    if (!resolved.ok) return resolved;
    try {
      const current = await readFile(resolved.path, "utf8");
      let updated = current;
      for (const edit of input.edits) {
        updated = updated.replace(edit.oldText, edit.newText);
      }
      return success(
        input,
        preview.output.path,
        updated,
        preview.output.diff,
        preview.output.replacements,
        preview.truncated,
      );
    } catch {
      return failure("io_error", "The edit target could not be read.", true);
    }
  }
  const prepared = await prepareRewrite(input, context);
  if (!prepared.ok) return prepared;
  const bounded = truncateUtf8(
    prepared.output.diff,
    context.limits.maxOutputBytes,
  );
  return success(
    input,
    prepared.output.relativePath,
    input.content,
    bounded.value,
    undefined,
    bounded.truncated,
  );
}

export async function editFile(
  input: EditFileInput,
  context: ToolContext,
): Promise<ToolResult<EditFileOutput>> {
  if (input.operation === "create") {
    const result = await createFile(input as CreateFileInput, context);
    if (!result.ok) return result;
    const bounded = truncateUtf8(
      formatCreateDiff(result.output.path, input.content),
      context.limits.maxOutputBytes,
    );
    return success(
      input,
      result.output.path,
      input.content,
      bounded.value,
      undefined,
      bounded.truncated,
    );
  }
  if (input.operation === "replace") {
    const result = await applyPatch(input as ApplyPatchInput, context);
    if (!result.ok) return result;
    const resolved = await resolveToolPath(input.path, context.workspace);
    if (!resolved.ok) return resolved;
    try {
      const content = await readFile(resolved.path, "utf8");
      return success(
        input,
        result.output.path,
        content,
        result.output.diff,
        result.output.replacements,
        result.truncated,
      );
    } catch {
      return failure(
        "io_error",
        "The edited file could not be verified.",
        true,
      );
    }
  }

  const prepared = await prepareRewrite(input, context);
  if (!prepared.ok) return prepared;
  if (context.signal.aborted) return cancelled();
  try {
    const current = await readFile(prepared.output.path, "utf8");
    if (sha256(current) !== input.expectedSha256) return staleFile();
    await writeFile(prepared.output.path, input.content, "utf8");
    const bounded = truncateUtf8(
      prepared.output.diff,
      context.limits.maxOutputBytes,
    );
    return success(
      input,
      prepared.output.relativePath,
      input.content,
      bounded.value,
      undefined,
      bounded.truncated,
    );
  } catch {
    return failure("io_error", "The file could not be rewritten.", true);
  }
}

async function prepareRewrite(
  input: Extract<EditFileInput, { operation: "rewrite" }>,
  context: ToolContext,
): Promise<ToolResult<PreparedRewrite>> {
  if (context.signal.aborted) return cancelled();
  const resolved = await resolveToolPath(input.path, context.workspace);
  if (!resolved.ok) return resolved;
  try {
    const targetStat = await stat(resolved.path);
    if (!targetStat.isFile()) {
      return failure("not_file", "The rewrite target is not a regular file.");
    }
    const content = await readFile(resolved.path, "utf8");
    if (sha256(content) !== input.expectedSha256) return staleFile();
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
        diff: formatRewriteDiff(relativePath, content, input.content),
      },
      truncated: false,
    };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return failure("not_found", "The rewrite target does not exist.");
    }
    return failure("io_error", "The rewrite target could not be read.", true);
  }
}

function success(
  input: EditFileInput,
  path: string,
  content: string,
  diff: string,
  replacements?: number,
  truncated = false,
): ToolResult<EditFileOutput> {
  return {
    ok: true,
    output: {
      operation: input.operation,
      path,
      bytes: Buffer.byteLength(content, "utf8"),
      ...(replacements === undefined ? {} : { replacements }),
      sha256: sha256(content),
      diff,
    },
    truncated,
  };
}

function staleFile(): ToolResult<never> {
  return failure(
    "stale_file",
    "The file changed or was not read at this version. Read it again and retry with the new SHA-256.",
    true,
  );
}

function sha256(content: string): string {
  return createHash("sha256").update(content, "utf8").digest("hex");
}

function formatCreateDiff(path: string, content: string): string {
  const lines = content
    .replace(/\n$/, "")
    .split("\n")
    .filter(
      (line, index, all) => !(all.length === 1 && index === 0 && line === ""),
    );
  return [
    `--- /dev/null`,
    `+++ b/${path}`,
    `@@ -0,0 +1,${lines.length} @@`,
    ...lines.map((line) => `+${line}`),
    "",
  ].join("\n");
}

function formatRewriteDiff(
  path: string,
  before: string,
  after: string,
): string {
  const beforeLines = before.replace(/\n$/, "").split("\n");
  const afterLines = after.replace(/\n$/, "").split("\n");
  return [
    `--- a/${path}`,
    `+++ b/${path}`,
    `@@ -1,${beforeLines.length} +1,${afterLines.length} @@`,
    ...beforeLines.map((line) => `-${line}`),
    ...afterLines.map((line) => `+${line}`),
    "",
  ].join("\n");
}

function truncateUtf8(
  value: string,
  maxBytes: number,
): { value: string; truncated: boolean } {
  const buffer = Buffer.from(value, "utf8");
  return buffer.length <= maxBytes
    ? { value, truncated: false }
    : { value: buffer.subarray(0, maxBytes).toString("utf8"), truncated: true };
}
