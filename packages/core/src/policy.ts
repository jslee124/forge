import type { ForgeTool, ToolCall, ToolContext } from "./tools.js";

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
  recordApproval?(action: ProposedAction): void;
}

export class WorkspaceWritePolicy implements ApprovalPolicy {
  #workspacePatchApproved = false;

  async evaluate(
    action: ProposedAction,
    _signal: AbortSignal,
  ): Promise<ApprovalDecision> {
    switch (action.tool.risk) {
      case "read":
        return {
          kind: "allow",
          reason: "Read-only workspace tools are allowed.",
        };
      case "write":
        return this.#workspacePatchApproved
          ? {
              kind: "allow",
              reason: "A workspace patch was approved for this run.",
            }
          : {
              kind: "confirm",
              reason: "The first workspace patch requires approval.",
            };
      case "process":
        return {
          kind: "confirm",
          reason: "Every process command requires approval.",
        };
    }
  }

  recordApproval(action: ProposedAction): void {
    if (action.tool.risk === "write") {
      this.#workspacePatchApproved = true;
    }
  }
}

export interface ApprovalChannel {
  request(
    action: ProposedAction,
    signal: AbortSignal,
    context: ToolContext,
  ): Promise<boolean>;
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
