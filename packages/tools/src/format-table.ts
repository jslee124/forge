import type { ForgeTool, ToolContext, ToolResult } from "@forge/core";
import Papa from "papaparse";
import { z } from "zod";

import { cancelled, failure } from "./path.js";

export const formatTableInputSchema = z
  .object({
    format: z.enum(["csv", "tsv"]),
    rows: z.array(z.array(z.string().max(100_000)).max(1_000)).max(5_000),
    newline: z.enum(["\n", "\r\n"]).optional(),
  })
  .strict();

export type FormatTableInput = z.infer<typeof formatTableInputSchema>;
export interface FormatTableOutput {
  readonly format: "csv" | "tsv";
  readonly rows: number;
  readonly content: string;
}

export const formatTableTool: ForgeTool = {
  name: "format_table",
  description:
    "Serialize string rows as CSV or TSV with correct quoting. Use edit_file separately to save the returned content under the normal write policy.",
  inputSchema: formatTableInputSchema,
  risk: "read",
  execute: async (input, context) => {
    const parsed = formatTableInputSchema.safeParse(input);
    return parsed.success
      ? formatTable(parsed.data, context)
      : failure("invalid_input", "Invalid input for format_table.");
  },
};

export async function formatTable(
  input: FormatTableInput,
  context: ToolContext,
): Promise<ToolResult<FormatTableOutput>> {
  if (context.signal.aborted) return cancelled();
  const parsed = formatTableInputSchema.safeParse(input);
  if (!parsed.success)
    return failure("invalid_input", "Invalid input for format_table.");
  const content = Papa.unparse(parsed.data.rows, {
    delimiter: parsed.data.format === "tsv" ? "\t" : ",",
    newline: parsed.data.newline ?? "\n",
  });
  if (Buffer.byteLength(content) > context.limits.maxOutputBytes)
    return failure(
      "output_limit",
      "The serialized table exceeds the configured output limit.",
    );
  return {
    ok: true,
    output: {
      format: parsed.data.format,
      rows: parsed.data.rows.length,
      content,
    },
    truncated: false,
  };
}
