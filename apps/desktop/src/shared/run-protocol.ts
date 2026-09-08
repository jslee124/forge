import { z } from "zod";

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
      }
    | { readonly type: "cancel" }
    | {
        readonly type: "approve";
        readonly approvalId: string;
        readonly allow: boolean;
      }
  );
export type RunPayload =
  | {
      readonly type: "detail";
      readonly kind: "reasoning" | "tool" | "context" | "error" | "system";
      readonly text: string;
    }
  | { readonly type: "text"; readonly text: string }
  | {
      readonly type: "approval";
      readonly approvalId: string;
      readonly description: string;
    }
  | {
      readonly type: "complete";
      readonly outcome: "completed" | "cancelled" | "failed" | "interrupted";
    };
export type RunEvent = RunIdentity & {
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
      | "model",
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
    ]) &&
    (value.model === undefined ||
      (typeof value.model === "string" &&
        value.model.length > 0 &&
        value.model.length <= 256)) &&
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
    exact(value, [...keys, "approvalId", "allow"]) &&
    id(value.approvalId) &&
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
    ]) ||
    value.type !== "run-event" ||
    !id(value.requestId) ||
    !id(value.sessionId) ||
    !id(value.runId) ||
    !Number.isSafeInteger(value.sequence) ||
    (value.sequence as number) < 1 ||
    !record(value.payload)
  )
    return;
  const p = value.payload;
  if (detailSchema.safeParse(p).success) return value as unknown as RunEvent;
  const valid =
    (p.type === "text" &&
      exact(p, ["type", "text"]) &&
      typeof p.text === "string" &&
      p.text.length <= 100_000) ||
    (p.type === "approval" &&
      exact(p, ["type", "approvalId", "description"]) &&
      id(p.approvalId) &&
      typeof p.description === "string" &&
      p.description.length <= 100_000) ||
    (p.type === "complete" &&
      exact(p, ["type", "outcome"]) &&
      ["completed", "cancelled", "failed", "interrupted"].includes(
        String(p.outcome),
      ));
  return valid ? (value as unknown as RunEvent) : undefined;
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
  })
  .strict();
