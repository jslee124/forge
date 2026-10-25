import type { RunEvent, RunResult, RunStatus } from "@forge/core";

export type ProductRunOutcome = RunStatus | "interrupted";
export type ProductRunReason =
  | "model_step_limit"
  | "tool_call_limit"
  | "no_progress"
  | "context_limit"
  | "configuration_error"
  | "workspace_conflict"
  | "storage_error"
  | "execution_error"
  | "permission_denied"
  | "cancelled"
  | "disconnected";

/** Presentation facts only. None of these fields authorize execution. */
export interface ProductRunCompletion {
  readonly outcome: ProductRunOutcome;
  readonly recovery?:
    | {
        readonly sourceRunId: string;
        readonly kind: "summarize" | "continue" | "retry";
      }
    | undefined;
  readonly partial?: boolean | undefined;
  readonly reason?: ProductRunReason | undefined;
  readonly message?: string | undefined;
  readonly modelSteps?: number | undefined;
  readonly toolCalls?: number | undefined;
  readonly durationMs?: number | undefined;
}

export interface ProductActionUpdate {
  readonly actionId: string;
  readonly step: number;
  readonly tool: string;
  readonly status:
    | "proposed"
    | "awaiting_approval"
    | "running"
    | "succeeded"
    | "failed"
    | "denied";
  readonly input: string;
  readonly output?: string;
  readonly truncated?: boolean;
}

const MAX_ACTIVITY_TEXT = 16_384;
export function projectActionEvent(
  event: RunEvent,
): ProductActionUpdate | undefined {
  if (
    event.type !== "tool.proposed" &&
    event.type !== "tool.decision" &&
    event.type !== "tool.started" &&
    event.type !== "tool.completed" &&
    event.type !== "tool.failed"
  )
    return;
  const input = JSON.stringify(event.call.input, null, 2) ?? "null";
  const base = {
    actionId: event.call.id,
    step: event.step,
    tool: event.call.name,
    input: input.slice(0, MAX_ACTIVITY_TEXT),
    truncated: input.length > MAX_ACTIVITY_TEXT,
  };
  switch (event.type) {
    case "tool.proposed":
      return { ...base, status: "proposed" };
    case "tool.started":
      return { ...base, status: "running" };
    case "tool.decision":
      return {
        ...base,
        status:
          event.decision.kind === "deny"
            ? "denied"
            : event.decision.kind === "confirm"
              ? "awaiting_approval"
              : "proposed",
      };
    default: {
      const output = JSON.stringify(event.result, null, 2);
      return {
        ...base,
        status: event.result.ok
          ? "succeeded"
          : event.result.error.code === "approval_denied"
            ? "denied"
            : "failed",
        output: output.slice(0, MAX_ACTIVITY_TEXT),
        truncated:
          base.truncated ||
          output.length > MAX_ACTIVITY_TEXT ||
          (event.result.ok && event.result.truncated),
      };
    }
  }
}

export function projectRunCompletion(result: RunResult): ProductRunCompletion {
  let reason: ProductRunReason | undefined;
  if (result.status === "limit_reached") {
    reason =
      result.limitReason ??
      (result.events.some((event) => event.type === "context.limit_reached")
        ? "context_limit"
        : result.message === "The tool-call limit was reached."
          ? "tool_call_limit"
          : result.message === "The model-step limit was reached."
            ? "model_step_limit"
            : undefined);
  } else if (result.status === "cancelled") reason = "cancelled";
  else if (result.status === "denied") reason = "permission_denied";
  else if (result.status === "failed") reason = "execution_error";
  return {
    outcome: result.status,
    ...(result.partial !== undefined ? { partial: result.partial } : {}),
    ...(reason ? { reason } : {}),
    ...(result.message ? { message: result.message } : {}),
    modelSteps: result.modelSteps,
    toolCalls: result.toolCalls,
  };
}
