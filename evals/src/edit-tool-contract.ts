import type { ForgeTool } from "@forge/core";
import {
  applyPatchTool,
  createFileTool,
  editFileTool,
  listFilesTool,
  readFileTool,
  runCommandTool,
  searchTool,
} from "@forge/tools";
import { z } from "zod";

export type EditToolContract = "legacy" | "union" | "flat";

const unionEditFileSchema = z.discriminatedUnion("operation", [
  z.object({
    operation: z.literal("create"),
    path: z.string().min(1),
    content: z.string().max(65_536),
  }),
  z.object({
    operation: z.literal("replace"),
    path: z.string().min(1),
    edits: z
      .array(
        z.object({
          oldText: z.string().min(1).max(65_536),
          newText: z.string().max(65_536),
        }),
      )
      .min(1)
      .max(50),
  }),
  z.object({
    operation: z.literal("rewrite"),
    path: z.string().min(1),
    content: z.string().max(65_536),
    expectedSha256: z.string().regex(/^[a-f0-9]{64}$/),
  }),
]);

const unionEditFileTool: ForgeTool = {
  name: "edit_file",
  description:
    "Create a new text file, replace exact text in an existing file, or rewrite an existing file that was read at the supplied version.",
  inputSchema: unionEditFileSchema,
  risk: "write",
  execute: async (input, context) => {
    const parsed = unionEditFileSchema.safeParse(input);
    if (!parsed.success) {
      return {
        ok: false,
        error: {
          code: "invalid_input",
          message: "Invalid input for edit_file.",
          retryable: false,
        },
      };
    }
    return editFileTool.execute(parsed.data, context);
  },
};

export function toolsForEditContract(
  contract: EditToolContract,
): readonly ForgeTool[] {
  const editor =
    contract === "legacy"
      ? [createFileTool, applyPatchTool]
      : contract === "union"
        ? [unionEditFileTool]
        : [editFileTool];
  return [listFilesTool, readFileTool, searchTool, ...editor, runCommandTool];
}
