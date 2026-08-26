import type { ForgeTool, ToolContext, ToolResult } from "@forge/core";
import { z } from "zod";

import type { RegisteredPluginSubagent } from "./types.js";

const subagentInputSchema = z
  .object({
    task: z.string().trim().min(1).max(32_768),
  })
  .strict();

export interface PluginSubagentRunRequest {
  readonly subagent: RegisteredPluginSubagent;
  readonly task: string;
}

export type PluginSubagentRunner = (
  request: PluginSubagentRunRequest,
  context: ToolContext,
) => Promise<ToolResult>;

export function createSubagentTools(
  subagents: readonly RegisteredPluginSubagent[],
  runner: PluginSubagentRunner,
): readonly ForgeTool[] {
  return subagents.map((subagent) =>
    Object.freeze({
      name: subagent.toolName,
      description: subagent.description,
      risk: "model" as const,
      inputSchema: subagentInputSchema,
      execute: async (
        input: unknown,
        context: ToolContext,
      ): Promise<ToolResult> => {
        const parsed = subagentInputSchema.safeParse(input);
        if (!parsed.success) {
          return {
            ok: false,
            error: {
              code: "invalid_input",
              message: `Invalid input for ${subagent.toolName}.`,
              retryable: false,
            },
          };
        }
        return runner({ subagent, task: parsed.data.task }, context);
      },
    }),
  );
}
