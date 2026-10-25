import type {
  ProductActionUpdate,
  ProductRunCompletion,
} from "@forge/application";
import { z } from "zod";

export const RUN_PROTOCOL_VERSION = 2;

export interface ApprovalView {
  readonly actionId: string;
  readonly effect: "read" | "write" | "process" | "network" | "model";
  readonly resource: string;
  readonly preview: string;
  readonly input: string;
  readonly riskFlags: readonly string[];
}

/** Transport DTOs: credentials and process-local objects never cross this boundary. */
export interface RunIdentity {
  readonly sessionId: string;
  readonly runId: string;
}
export type RunCommand = RunIdentity & { readonly requestId: string } & (
    | {
        readonly type: "start";
        readonly prompt: string;
        readonly engine: "native" | "codex";
        readonly model?: string;
        readonly provider?: string;
        readonly reasoningEffort?: string;
        readonly permissionProfile?: "safe" | "workspace-write";
      }
    | { readonly type: "cancel" }
    | {
        readonly type: "approve";
        readonly approvalId: string;
        readonly allow: boolean;
        readonly actionId?: string;
      }
  );
export type RunPayload =
  | {
      readonly type: "detail";
      readonly kind: "reasoning" | "tool" | "context" | "error" | "system";
      readonly text: string;
      readonly step?: number;
    }
  | { readonly type: "action"; readonly action: ProductActionUpdate }
  | {
      readonly type: "phase";
      readonly phase: "responding" | "executing" | "finalizing";
    }
  | {
      readonly type: "approval-resolved";
      readonly approvalId: string;
      readonly allow: boolean;
    }
  | { readonly type: "text"; readonly text: string }
  | {
      readonly type: "approval";
      readonly approvalId: string;
      readonly description: string;
      readonly descriptor?: ApprovalView;
    }
  | (ProductRunCompletion & {
      readonly type: "complete";
    });
export type RunEvent = RunIdentity & {
  readonly schemaVersion: 2;
  readonly occurredAt: string;
  readonly type: "run-event";
  readonly requestId: string;
  readonly sequence: number;
  readonly payload: RunPayload;
};
export interface RunReply {
  readonly type: "run-reply";
  readonly requestId: string;
  readonly ok: boolean;
}
type WireRecord = Record<string, unknown> &
  Partial<
    Record<
      | "type"
      | "requestId"
      | "sessionId"
      | "runId"
      | "prompt"
      | "engine"
      | "approvalId"
      | "allow"
      | "sequence"
      | "payload"
      | "text"
      | "description"
      | "outcome"
      | "ok"
      | "provider"
      | "reasoningEffort"
      | "actionId"
      | "model"
      | "permissionProfile",
      unknown
    >
  >;
function record(value: unknown): value is WireRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function id(value: unknown): value is string {
  return typeof value === "string" && /^[a-zA-Z0-9_-]{1,128}$/.test(value);
}
function exact(value: Record<string, unknown>, keys: string[]): boolean {
  return (
    Object.keys(value).length === keys.length &&
    keys.every((key) => key in value)
  );
}
export function parseRunCommand(value: unknown): RunCommand | undefined {
  if (
    !record(value) ||
    !id(value.requestId) ||
    !id(value.sessionId) ||
    !id(value.runId)
  )
    return;
  const keys = ["type", "requestId", "sessionId", "runId"];
  if (
    value.type === "start" &&
    exact(value, [
      ...keys,
      "prompt",
      "engine",
      ...(value.model === undefined ? [] : ["model"]),
      ...(value.provider === undefined ? [] : ["provider"]),
      ...(value.reasoningEffort === undefined ? [] : ["reasoningEffort"]),
      ...(value.permissionProfile === undefined ? [] : ["permissionProfile"]),
    ]) &&
    (value.model === undefined ||
      (typeof value.model === "string" &&
        value.model.length > 0 &&
        value.model.length <= 256)) &&
    (value.provider === undefined ||
      (typeof value.provider === "string" &&
        value.provider.length > 0 &&
        value.provider.length <= 256)) &&
    (value.reasoningEffort === undefined ||
      (typeof value.reasoningEffort === "string" &&
        [
          "none",
          "minimal",
          "low",
          "medium",
          "high",
          "xhigh",
          "max",
          "ultra",
        ].includes(value.reasoningEffort))) &&
    (value.permissionProfile === undefined ||
      value.permissionProfile === "safe" ||
      value.permissionProfile === "workspace-write") &&
    typeof value.prompt === "string" &&
    value.prompt.trim().length > 0 &&
    value.prompt.length <= 100_000 &&
    (value.engine === "native" || value.engine === "codex")
  )
    return value as unknown as RunCommand;
  if (value.type === "cancel" && exact(value, keys))
    return value as unknown as RunCommand;
  if (
    value.type === "approve" &&
    exact(value, [
      ...keys,
      "approvalId",
      "allow",
      ...(value.actionId === undefined ? [] : ["actionId"]),
    ]) &&
    id(value.approvalId) &&
    (value.actionId === undefined ||
      (typeof value.actionId === "string" &&
        value.actionId.length > 0 &&
        value.actionId.length <= 1000)) &&
    typeof value.allow === "boolean"
  )
    return value as unknown as RunCommand;
  return;
}
export function parseRunEvent(value: unknown): RunEvent | undefined {
  if (
    !record(value) ||
    !exact(value, [
      "type",
      "requestId",
      "sessionId",
      "runId",
      "sequence",
      "payload",
      "schemaVersion",
      "occurredAt",
    ]) ||
    value["schemaVersion"] !== RUN_PROTOCOL_VERSION ||
    !z.iso.datetime().safeParse(value["occurredAt"]).success ||
    value.type !== "run-event" ||
    !id(value.requestId) ||
    !id(value.sessionId) ||
    !id(value.runId) ||
    !Number.isSafeInteger(value.sequence) ||
    (value.sequence as number) < 1 ||
    !record(value.payload)
  )
    return;
  return runPayloadSchema.safeParse(value.payload).success
    ? (value as unknown as RunEvent)
    : undefined;
}
export function parseRunReply(value: unknown): RunReply | undefined {
  if (
    record(value) &&
    exact(value, ["type", "requestId", "ok"]) &&
    value.type === "run-reply" &&
    id(value.requestId) &&
    typeof value.ok === "boolean"
  )
    return value as unknown as RunReply;
  return;
}

const detailSchema = z
  .object({
    type: z.literal("detail"),
    kind: z.enum(["reasoning", "tool", "context", "error", "system"]),
    text: z.string().max(100_000),
    step: z.number().int().positive().optional(),
  })
  .strict();

export const approvalViewSchema = z
  .object({
    actionId: z.string().min(1).max(1000),
    effect: z.enum(["read", "write", "process", "network", "model"]),
    resource: z.string().max(16_384),
    preview: z.string().max(64_000),
    input: z.string().max(64_000),
    riskFlags: z
      .array(
        z.enum([
          "broad-external-effect",
          "credential-sensitive",
          "destructive",
          "install",
          "policy-designated",
          "publish",
        ]),
      )
      .max(16),
  })
  .strict();

export const runPayloadSchema = z.discriminatedUnion("type", [
  detailSchema,
  z.object({ type: z.literal("text"), text: z.string().max(100_000) }).strict(),
  z
    .object({
      type: z.literal("phase"),
      phase: z.enum(["responding", "executing", "finalizing"]),
    })
    .strict(),
  z
    .object({
      type: z.literal("action"),
      action: z
        .object({
          actionId: z.string().min(1).max(1000),
          step: z.number().int().positive(),
          tool: z.string().min(1).max(1000),
          status: z.enum([
            "proposed",
            "awaiting_approval",
            "running",
            "succeeded",
            "failed",
            "denied",
          ]),
          input: z.string().max(16_384),
          output: z.string().max(16_384).optional(),
          truncated: z.boolean().optional(),
        })
        .strict(),
    })
    .strict(),
  z
    .object({
      type: z.literal("approval"),
      approvalId: z.string().regex(/^[a-zA-Z0-9_-]{1,128}$/),
      description: z.string().max(100_000),
      descriptor: approvalViewSchema.optional(),
    })
    .strict(),
  z
    .object({
      type: z.literal("approval-resolved"),
      approvalId: z.string().regex(/^[a-zA-Z0-9_-]{1,128}$/),
      allow: z.boolean(),
    })
    .strict(),
  z
    .object({
      type: z.literal("complete"),
      outcome: z.enum([
        "completed",
        "cancelled",
        "failed",
        "interrupted",
        "limit_reached",
        "denied",
      ]),
      reason: z
        .enum([
          "model_step_limit",
          "tool_call_limit",
          "no_progress",
          "context_limit",
          "configuration_error",
          "workspace_conflict",
          "storage_error",
          "execution_error",
          "permission_denied",
          "cancelled",
          "disconnected",
        ])
        .optional(),
      message: z.string().max(100_000).optional(),
      modelSteps: z.number().int().nonnegative().optional(),
      toolCalls: z.number().int().nonnegative().optional(),
      durationMs: z.number().nonnegative().optional(),
      partial: z.boolean().optional(),
    })
    .strict(),
]);
