import type { ApprovalDescriptor, ApprovalResponse } from "./approval.js";
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
  #workspaceWriteApproved = false;

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
        return this.#workspaceWriteApproved
          ? {
              kind: "allow",
              reason: "Workspace writes were approved for this run.",
            }
          : {
              kind: "confirm",
              reason: "The first workspace write requires approval.",
            };
      case "network":
        return {
          kind: "confirm",
          reason: "Every external network request requires approval.",
        };
      case "process":
        return {
          kind: "confirm",
          reason: "Every process command requires approval.",
        };
      case "model":
        return {
          kind: "confirm",
          reason: "Every delegated model run requires approval.",
        };
    }
  }

  recordApproval(action: ProposedAction): void {
    if (action.tool.risk === "write") {
      this.#workspaceWriteApproved = true;
    }
  }
}

export class AutomaticWorkspaceWritePolicy implements ApprovalPolicy {
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
        return {
          kind: "allow",
          reason:
            "Workspace writes are allowed by the workspace-write profile.",
        };
      case "network":
        return {
          kind: "confirm",
          reason: "Every external network request requires approval.",
        };
      case "process":
        return {
          kind: "confirm",
          reason: "Every process command requires approval.",
        };
      case "model":
        return {
          kind: "confirm",
          reason: "Every delegated model run requires approval.",
        };
    }
  }
}

export interface ApprovalChannel {
  request(
    action: ProposedAction,
    signal: AbortSignal,
    context: ToolContext,
  ): Promise<boolean>;
  requestStructured?(
    action: ProposedAction,
    signal: AbortSignal,
    context: ToolContext,
    descriptor: ApprovalDescriptor,
  ): Promise<ApprovalResponse>;
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
