import type {
  ForgeTool,
  ModelToolDefinition,
  ToolCall,
  ToolContext,
  ToolProposal,
  ToolProposalResult,
  ToolResult,
} from "@forge/core";

import { applyPatchTool } from "./apply-patch.js";
import { listFilesTool } from "./list-files.js";
import { failure } from "./path.js";
import { readFileTool } from "./read-file.js";
import { runCommandTool } from "./run-command.js";
import { searchTool } from "./search.js";

export const builtinTools: readonly ForgeTool[] = [
  listFilesTool,
  readFileTool,
  searchTool,
  applyPatchTool,
  runCommandTool,
];

export function toModelToolDefinitions(
  tools: readonly ForgeTool[] = builtinTools,
): readonly ModelToolDefinition[] {
  return tools.map(({ name, description, inputSchema }) => ({
    name,
    description,
    inputSchema,
  }));
}

export function proposeToolCall(
  call: ToolCall,
  tools: readonly ForgeTool[] = builtinTools,
): ToolProposalResult {
  const tool = tools.find((candidate) => candidate.name === call.name);
  if (!tool) {
    return failure("unknown_tool", `Unknown tool "${call.name}".`);
  }

  const parsed = tool.inputSchema.safeParse(call.input);
  if (!parsed.success) {
    return failure("invalid_input", `Invalid input for tool "${call.name}".`);
  }

  return {
    ok: true,
    proposal: { call, tool, input: parsed.data },
  };
}

export async function executeToolProposal(
  proposal: ToolProposal,
  context: ToolContext,
): Promise<ToolResult> {
  if (context.signal.aborted) {
    return failure("cancelled", "The tool call was cancelled.");
  }

  try {
    return await proposal.tool.execute(proposal.input, context);
  } catch {
    return failure("io_error", "The tool failed unexpectedly.", true);
  }
}

export async function executeToolCall(
  call: ToolCall,
  context: ToolContext,
  tools: readonly ForgeTool[] = builtinTools,
): Promise<ToolResult> {
  const proposed = proposeToolCall(call, tools);
  return proposed.ok
    ? executeToolProposal(proposed.proposal, context)
    : proposed;
}
