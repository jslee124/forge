export const FORGE_VERSION = "0.3.0-bootstrap.0";

export {
  type ActiveConversationView,
  budgetModelRequest,
  type ContextBudgetReport,
  type ContextConfiguration,
  type ContextMode,
  type ContextTokenBreakdown,
  conservativeRequestEstimate,
  conservativeTextTokens,
  conservativeValueTokens,
  DEFAULT_CONTEXT_CONFIGURATION,
  type ModelContextCapabilities,
  modelContextCapabilities,
  selectRecentConversation,
  sha256,
  type TokenEstimate,
  type TokenEstimateMethod,
} from "./context.js";

export { ModelConfigurationError, ModelProviderError } from "./errors.js";
export type {
  ModelAdapter,
  ModelContinuation,
  ModelConversationMessage,
  ModelFinishReason,
  ModelImageInput,
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
  AutomaticWorkspaceWritePolicy,
  type ProposedAction,
  ReadOnlyPolicy,
  WorkspaceWritePolicy,
} from "./policy.js";
export {
  DEFAULT_MAX_MODEL_STEPS,
  DEFAULT_MAX_TOOL_CALLS,
  exitCodeForRunStatus,
  type RunAgentOptions,
  type RunContextSnapshot,
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
