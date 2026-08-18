export const FORGE_VERSION = "0.0.0";

export { ModelConfigurationError, ModelProviderError } from "./errors.js";
export type {
  ModelAdapter,
  ModelFinishReason,
  ModelRequest,
  ModelStreamEvent,
  ModelUsage,
} from "./model.js";
export type {
  ForgeTool,
  ModelToolDefinition,
  ToolCall,
  ToolContext,
  ToolError,
  ToolErrorCode,
  ToolLimits,
  ToolProposal,
  ToolProposalResult,
  ToolResult,
  ToolRisk,
  WorkspaceContext,
} from "./tools.js";
