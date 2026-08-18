export const FORGE_VERSION = "0.0.0";

export { ModelConfigurationError, ModelProviderError } from "./errors.js";
export type {
  ModelAdapter,
  ModelContinuation,
  ModelConversationMessage,
  ModelFinishReason,
  ModelRequest,
  ModelStreamEvent,
  ModelToolResult,
  ModelUsage,
} from "./model.js";
export {
  type ApprovalChannel,
  type ApprovalDecision,
  type ApprovalDecisionKind,
  type ApprovalPolicy,
  type ProposedAction,
  ReadOnlyPolicy,
  WorkspaceWritePolicy,
} from "./policy.js";
export {
  DEFAULT_MAX_MODEL_STEPS,
  DEFAULT_MAX_TOOL_CALLS,
  exitCodeForRunStatus,
  type RunAgentOptions,
  type RunEvent,
  type RunLimits,
  type RunResult,
  type RunStatus,
  runAgent,
} from "./runtime.js";
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
