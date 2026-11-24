import type { SessionApprovalStore } from "./approval.js";
import type { PromptPrefixInputs, PromptPrefixObservation } from "./cache.js";
import type {
  ContextBudgetReport,
  ContextConfiguration,
  ContextPressureMode,
  ContextPressureSnapshot,
} from "./context.js";
import type {
  CanonicalConversationMessage,
  ModelAdapter,
  ModelContinuation,
  ModelConversationMessage,
  ModelFinishReason,
  ModelImageInput,
  ModelUsage,
} from "./model.js";
import type {
  ApprovalChannel,
  ApprovalDecision,
  ApprovalPolicy,
} from "./policy.js";
import type { ForgeTool, ToolCall, ToolContext, ToolResult } from "./tools.js";

export const DEFAULT_MAX_MODEL_STEPS = null;
export const DEFAULT_MAX_TOOL_CALLS = null;

export type FinalizationReason =
  | "model_step_limit"
  | "tool_call_limit"
  | "no_progress";

export type RunStatus =
  | "completed"
  | "failed"
  | "cancelled"
  | "denied"
  | "limit_reached";

export type RunEvent =
  | {
      readonly type: "skill.discovery";
      readonly catalogCount: number;
      readonly diagnosticCount: number;
      readonly diagnostics: readonly {
        readonly code: string;
        readonly source: "builtin" | "user" | "project";
        readonly sourcePath: string;
        readonly message: string;
      }[];
    }
  | {
      readonly type: "skill.selected";
      readonly id: string;
      readonly name: string;
      readonly source: "builtin" | "user" | "project";
      readonly reason: "automatic" | "explicit";
      readonly invocation: "model" | "explicit-only";
    }
  | {
      readonly type: "skill.loaded";
      readonly id: string;
      readonly name: string;
      readonly source: "builtin" | "user" | "project";
      readonly relativePath: string;
      readonly truncated: boolean;
    }
  | {
      readonly type: "skill.rejected";
      readonly id?: string;
      readonly code: string;
      readonly message: string;
    }
  | {
      readonly type: "docs.search";
      readonly query: string;
      readonly resultCount: number;
      readonly locale: "en" | "zh-CN";
      readonly fallback: boolean;
    }
  | {
      readonly type: "docs.read";
      readonly reference: string;
      readonly truncated: boolean;
    }
  | {
      readonly type: "docs.rejected";
      readonly tool: "search_forge_docs" | "read_forge_doc";
      readonly code: string;
      readonly message: string;
    }
  | {
      readonly type: "run.started";
      readonly prompt: string;
      readonly imageCount?: number;
      readonly context?: RunContextSnapshot;
    }
  | {
      readonly type: "run.finalizing";
      readonly step: number;
      readonly reason: FinalizationReason;
      readonly inputMode?: "evidence";
    }
  | { readonly type: "model.started"; readonly step: number }
  | {
      readonly type: "context.budgeted";
      readonly step: number;
      readonly budget: ContextBudgetReport;
    }
  | {
      readonly type: "context.pressure";
      readonly step: number;
      readonly snapshot: ContextPressureSnapshot;
    }
  | {
      readonly type: "cache.prefix";
      readonly step: number;
      readonly observation: PromptPrefixObservation;
    }
  | {
      readonly type: "cache.observed";
      readonly schemaVersion: 1;
      readonly step: number;
      readonly inputTokens?: number;
      readonly cacheReadTokens?: number;
      readonly cacheWriteTokens?: number;
      readonly uncachedInputTokens?: number;
      readonly hitRatio?: number;
    }
  | {
      readonly type: "approval.scope-decision";
      readonly schemaVersion: 1;
      readonly actionId: string;
      readonly decision: "allow-once" | "allow-session" | "deny";
      readonly scopeId?: string;
      readonly provenance: "user" | "policy";
      readonly persisted: false;
    }
  | {
      readonly type: "update.availability";
      readonly schemaVersion: 1;
      readonly state:
        | "cached"
        | "refreshing"
        | "available"
        | "current"
        | "failed"
        | "disabled";
      readonly currentVersion: string;
      readonly latestVersion?: string;
      readonly source: "npm-registry";
    }
  | {
      readonly type: "context.auto-paused";
      readonly step: number;
      readonly reason:
        | "cancelled"
        | "invalid-output"
        | "repeated-failure"
        | "low-reclamation";
      readonly message: string;
    }
  | {
      readonly type: "context.warning" | "context.limit_reached";
      readonly step: number;
      readonly message: string;
      readonly budget: ContextBudgetReport;
    }
  | {
      readonly type: "context.usage";
      readonly step: number;
      readonly estimatedInputTokens: number;
      readonly providerInputTokens: number;
      readonly absoluteErrorTokens: number;
      readonly relativeError: number;
    }
  | {
      readonly type: "context.compaction.started";
      readonly step: number;
      readonly strategy: "adapter-continuation";
      readonly estimatedBeforeTokens: number;
    }
  | {
      readonly type: "context.compaction.completed";
      readonly step: number;
      readonly strategy: "adapter-continuation";
      readonly estimatedBeforeTokens: number;
      readonly estimatedAfterTokens: number;
      readonly reclaimedTokens: number;
    }
  | {
      readonly type: "context.compaction.failed";
      readonly step: number;
      readonly strategy: "adapter-continuation";
      readonly message: string;
    }
  | {
      readonly type: "model.reasoning" | "model.text";
      readonly step: number;
      readonly text: string;
    }
  | {
      readonly type: "model.reasoning-unavailable";
      readonly step: number;
      readonly reasoningTokens: number;
    }
  | {
      readonly type: "model.warning";
      readonly step: number;
      readonly message: string;
    }
  | {
      readonly type: "model.completed";
      readonly step: number;
      readonly finishReason: ModelFinishReason;
      readonly usage: ModelUsage;
    }
  | {
      readonly type: "tool.proposed";
      readonly step: number;
      readonly call: ToolCall;
    }
  | {
      readonly type: "tool.decision";
      readonly step: number;
      readonly call: ToolCall;
      readonly decision: ApprovalDecision;
    }
  | {
      readonly type: "tool.started";
      readonly step: number;
      readonly call: ToolCall;
    }
  | {
      readonly type: "tool.completed" | "tool.failed";
      readonly step: number;
      readonly call: ToolCall;
      readonly result: ToolResult;
    }
  | {
      readonly type:
        | "run.completed"
        | "run.failed"
        | "run.cancelled"
        | "run.denied"
        | "run.limit_reached";
      readonly message?: string;
    };

export interface RunLimits {
  readonly maxModelSteps: number | null;
  readonly maxToolCalls: number | null;
}

export interface RunContextSnapshot {
  readonly workspaceRoot: string;
  readonly workingDirectory: string;
  readonly modelId: string;
  readonly permissionProfile: string;
  readonly instructionPaths: readonly string[];
}

export interface RunAgentOptions {
  readonly runId?: string;
  readonly completionPolicy?: "direct" | "reserve-final-step";
  /** Host-only experimental request projection; defaults to provider continuation. */
  readonly finalizationInput?: "continuation" | "evidence";
  readonly prompt: string;
  readonly images?: readonly ModelImageInput[];
  readonly context?: RunContextSnapshot;
  readonly sessionId?: string;
  readonly instructions?: string;
  readonly conversation?: readonly ModelConversationMessage[];
  readonly omittedConversationMessages?: number;
  readonly contextConfiguration?: ContextConfiguration;
  readonly contextPressureMode?: ContextPressureMode;
  readonly promptPrefix?: PromptPrefixInputs;
  readonly model: ModelAdapter;
  readonly tools: readonly ForgeTool[];
  readonly policy: ApprovalPolicy;
  readonly approvalChannel?: ApprovalChannel;
  readonly approvalStore?: SessionApprovalStore;
  readonly toolContext: ToolContext;
  readonly signal: AbortSignal;
  readonly limits?: Partial<RunLimits>;
  readonly onEvent?: (event: RunEvent) => void | Promise<void>;
  readonly initialEvents?: readonly RunEvent[];
}

export interface RunResult {
  /** Structured transport facts, without credential, endpoint, response body or cause. */
  readonly providerFailure?: {
    readonly statusCode?: number;
    readonly retryable: boolean;
  };
  readonly partial?: boolean;
  readonly limitReason?: FinalizationReason;
  readonly status: RunStatus;
  readonly exitCode: number;
  readonly finalText: string;
  readonly modelSteps: number;
  readonly toolCalls: number;
  readonly events: readonly RunEvent[];
  readonly canonicalDelta?: readonly CanonicalConversationMessage[];
  readonly message?: string;
}

export interface StepOutcome {
  readonly text: string;
  readonly calls: readonly ToolCall[];
  readonly finishReason: ModelFinishReason;
  readonly usage: ModelUsage;
  readonly continuation?: ModelContinuation;
}

export function exitCodeForRunStatus(status: RunStatus): number {
  switch (status) {
    case "completed":
      return 0;
    case "failed":
      return 1;
    case "limit_reached":
      return 3;
    case "denied":
      return 4;
    case "cancelled":
      return 130;
  }
}
