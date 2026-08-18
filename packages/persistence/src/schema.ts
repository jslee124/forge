import type {
  ModelConversationMessage,
  RunEvent,
  RunStatus,
} from "@forge/core";
import { z } from "zod";

const conversationMessageSchema = z
  .object({
    role: z.enum(["user", "assistant"]),
    content: z.string(),
  })
  .strict();

export const sessionSnapshotSchema = z
  .object({
    schemaVersion: z.literal(1),
    id: z.uuid(),
    createdAt: z.iso.datetime(),
    updatedAt: z.iso.datetime(),
    workspaceRoot: z.string().min(1),
    workingDirectory: z.string().min(1),
    messages: z.array(conversationMessageSchema).max(10_000),
    runIds: z.array(z.uuid()).max(10_000),
    lastRunStatus: z
      .enum(["completed", "failed", "cancelled", "denied", "limit_reached"])
      .optional(),
  })
  .strict();

export interface SessionSnapshot {
  readonly schemaVersion: 1;
  readonly id: string;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly workspaceRoot: string;
  readonly workingDirectory: string;
  readonly messages: readonly ModelConversationMessage[];
  readonly runIds: readonly string[];
  readonly lastRunStatus?: RunStatus;
}

export interface SessionSummary {
  readonly id: string;
  readonly updatedAt: string;
  readonly workspaceRoot: string;
  readonly workingDirectory: string;
  readonly title: string;
  readonly messageCount: number;
  readonly runCount: number;
  readonly lastRunStatus?: RunStatus;
}

const toolCallSchema = z
  .object({
    id: z.string(),
    name: z.string(),
    input: z.unknown(),
    providerMetadata: z.record(z.string(), z.unknown()).optional(),
  })
  .strict();

const toolResultSchema = z.discriminatedUnion("ok", [
  z
    .object({
      ok: z.literal(true),
      output: z.unknown(),
      truncated: z.boolean(),
    })
    .strict(),
  z
    .object({
      ok: z.literal(false),
      error: z
        .object({
          code: z.string(),
          message: z.string(),
          retryable: z.boolean(),
        })
        .strict(),
    })
    .strict(),
]);

const usageSchema = z
  .object({
    inputTokens: z.number().nonnegative().optional(),
    outputTokens: z.number().nonnegative().optional(),
    reasoningTokens: z.number().nonnegative().optional(),
    cachedInputTokens: z.number().nonnegative().optional(),
    cacheWriteTokens: z.number().nonnegative().optional(),
    totalTokens: z.number().nonnegative().optional(),
  })
  .strict();

const terminalEvent = (
  type:
    | "run.completed"
    | "run.failed"
    | "run.cancelled"
    | "run.denied"
    | "run.limit_reached",
) =>
  z.object({ type: z.literal(type), message: z.string().optional() }).strict();

export const runEventSchema = z.discriminatedUnion("type", [
  z
    .object({
      type: z.literal("run.started"),
      prompt: z.string(),
      context: z
        .object({
          workspaceRoot: z.string(),
          workingDirectory: z.string(),
          modelId: z.string(),
          permissionProfile: z.string(),
          instructionPaths: z.array(z.string()),
        })
        .strict()
        .optional(),
    })
    .strict(),
  z
    .object({
      type: z.literal("model.started"),
      step: z.number().int().positive(),
    })
    .strict(),
  z
    .object({
      type: z.enum(["model.reasoning", "model.text"]),
      step: z.number().int().positive(),
      text: z.string(),
    })
    .strict(),
  z
    .object({
      type: z.literal("model.warning"),
      step: z.number().int().positive(),
      message: z.string(),
    })
    .strict(),
  z
    .object({
      type: z.literal("model.completed"),
      step: z.number().int().positive(),
      finishReason: z.enum([
        "stop",
        "length",
        "content-filter",
        "tool-calls",
        "error",
        "other",
      ]),
      usage: usageSchema,
    })
    .strict(),
  z
    .object({
      type: z.literal("tool.proposed"),
      step: z.number().int().positive(),
      call: toolCallSchema,
    })
    .strict(),
  z
    .object({
      type: z.literal("tool.decision"),
      step: z.number().int().positive(),
      call: toolCallSchema,
      decision: z
        .object({
          kind: z.enum(["allow", "confirm", "deny"]),
          reason: z.string(),
        })
        .strict(),
    })
    .strict(),
  z
    .object({
      type: z.literal("tool.started"),
      step: z.number().int().positive(),
      call: toolCallSchema,
    })
    .strict(),
  z
    .object({
      type: z.enum(["tool.completed", "tool.failed"]),
      step: z.number().int().positive(),
      call: toolCallSchema,
      result: toolResultSchema,
    })
    .strict(),
  terminalEvent("run.completed"),
  terminalEvent("run.failed"),
  terminalEvent("run.cancelled"),
  terminalEvent("run.denied"),
  terminalEvent("run.limit_reached"),
]);

export const traceEnvelopeSchema = z
  .object({
    schemaVersion: z.literal(1),
    runId: z.uuid(),
    sessionId: z.uuid().optional(),
    sequence: z.number().int().nonnegative(),
    timestamp: z.iso.datetime(),
    event: runEventSchema,
  })
  .strict();

export interface TraceEnvelope {
  readonly schemaVersion: 1;
  readonly runId: string;
  readonly sessionId?: string;
  readonly sequence: number;
  readonly timestamp: string;
  readonly event: RunEvent;
}
