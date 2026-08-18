import type { ForgeTool, ToolCall } from "./tools.js";

export type ApprovalDecisionKind = "allow" | "confirm" | "deny";

export interface ApprovalDecision {
  readonly kind: ApprovalDecisionKind;
  readonly reason: string;
}

export interface ProposedAction {
  readonly call: ToolCall;
  readonly tool: ForgeTool;
  readonly input: unknown;
}

export interface ApprovalPolicy {
  evaluate(
    action: ProposedAction,
    signal: AbortSignal,
  ): Promise<ApprovalDecision>;
}

export interface ApprovalChannel {
  request(action: ProposedAction, signal: AbortSignal): Promise<boolean>;
}

export class ReadOnlyPolicy implements ApprovalPolicy {
  async evaluate(
    action: ProposedAction,
    _signal: AbortSignal,
  ): Promise<ApprovalDecision> {
    if (action.tool.risk === "read") {
      return {
        kind: "allow",
        reason: "Read-only workspace tools are allowed.",
      };
    }

    return {
      kind: "deny",
      reason: "This tool risk is not supported by the active policy.",
    };
  }
}
