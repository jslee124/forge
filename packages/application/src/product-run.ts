import type { RunEvent, RunResult, RunStatus } from "@forge/core";
import {
  type ProductActionFacts,
  productActionFactsSchema,
  type RecordedAction,
} from "@forge/persistence";

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
  readonly answerSource?: "system-fallback" | undefined;
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
    | "denied"
    | "unknown";
  readonly input: string;
  readonly output?: string;
  readonly facts?: ProductActionFacts;
  readonly truncated?: boolean;
}

/** Legacy cancellation is a structured result code, never a prose classifier. */
export function recordedActionStatus(
  action: RecordedAction,
): RecordedAction["status"] {
  if (action.status !== "failed" || !action.output) return action.status;
  try {
    const result = JSON.parse(action.output) as {
      ok?: unknown;
      error?: { code?: unknown };
    };
    if (result?.ok === false && result.error?.code === "cancelled")
      return "unknown";
  } catch {
    /* Clipped/legacy text cannot establish a cancellation result. */
  }
  return action.status;
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
            : event.result.error.code === "cancelled"
              ? "unknown"
              : "failed",
        output: output.slice(0, MAX_ACTIVITY_TEXT),
        ...(event.result.ok
          ? projectActionFacts(
              event.call.name,
              event.result.output,
              event.result.truncated,
            )
          : {}),
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
  const failure =
    result.status === "failed" ? result.providerFailure : undefined;
  const providerMessage =
    failure?.statusCode === 401 || failure?.statusCode === 403
      ? "provider-authentication-failed"
      : failure?.statusCode === 429
        ? "provider-rate-limited"
        : failure?.statusCode !== undefined && failure.statusCode >= 500
          ? "provider-unavailable"
          : failure?.statusCode === undefined && failure?.retryable
            ? "provider-connection-failed"
            : undefined;
  if (providerMessage === "provider-authentication-failed")
    reason = "configuration_error";
  if (providerMessage === "provider-connection-failed") reason = "disconnected";
  return {
    outcome: result.status,
    ...(result.canonicalDelta?.some(
      (entry) =>
        entry.role === "assistant" &&
        entry.step === Math.max(1, result.modelSteps) &&
        entry.id === `${entry.runId}:fallback:${result.modelSteps}`,
    )
      ? { answerSource: "system-fallback" as const }
      : {}),
    ...(result.partial !== undefined ? { partial: result.partial } : {}),
    ...(reason ? { reason } : {}),
    ...(providerMessage || result.message
      ? { message: providerMessage ?? result.message }
      : {}),
    modelSteps: result.modelSteps,
    toolCalls: result.toolCalls,
  };
}

/** Extract from the execution result before raw JSON output is clipped. No prose parsing. */
function projectActionFacts(
  tool: string,
  value: unknown,
  truncated: boolean,
): { facts?: ProductActionFacts } {
  if (!value || typeof value !== "object") return {};
  const output = value as {
    diff?: unknown;
    path?: unknown;
    operation?: unknown;
    bytes?: unknown;
    program?: unknown;
    args?: unknown;
    cwd?: unknown;
    exitCode?: unknown;
    signal?: unknown;
    timedOut?: unknown;
    stdout?: unknown;
    stderr?: unknown;
  };
  let candidate: unknown;
  if (
    tool === "edit_file" &&
    typeof output.diff === "string" &&
    typeof output.path === "string"
  ) {
    // A recorded path remains untrusted; file services recheck workspace boundaries.
    const path = output.path;
    if (
      path.startsWith("/") ||
      path.includes("\\") ||
      path.split("/").includes("..") ||
      /^[A-Za-z]:/.test(path) ||
      /[\0\r\n]/.test(path)
    )
      return {};
    candidate = {
      kind: "file",
      path,
      operation: output.operation,
      bytes: output.bytes,
      patch: output.diff.slice(0, 8192),
      truncated: truncated || output.diff.length > 8192,
    };
  } else if (
    tool === "run_command" &&
    typeof output.program === "string" &&
    Array.isArray(output.args) &&
    output.args.every((arg) => typeof arg === "string")
  ) {
    const command = [
      output.program,
      ...output.args.map((arg: string) => JSON.stringify(arg)),
    ].join(" ");
    candidate = {
      kind: "command",
      command: command.slice(0, 2048),
      cwd: output.cwd,
      exitCode: output.exitCode,
      signal: output.signal,
      timedOut: output.timedOut,
      ...(typeof output.stdout === "string"
        ? { stdout: output.stdout.slice(0, 2048) }
        : {}),
      ...(typeof output.stderr === "string"
        ? { stderr: output.stderr.slice(0, 2048) }
        : {}),
      truncated:
        truncated ||
        command.length > 2048 ||
        (typeof output.stdout === "string" && output.stdout.length > 2048) ||
        (typeof output.stderr === "string" && output.stderr.length > 2048),
    };
  }
  const parsed = productActionFactsSchema.safeParse(candidate);
  return parsed.success ? { facts: parsed.data } : {};
}
