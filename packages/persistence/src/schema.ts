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

const checkpointSafetyLabels = z.tuple([
  z.literal("untrusted-conversation-memory"),
  z.literal("no-approval-state"),
  z.literal("no-policy-authority"),
]);

export const contextCheckpointSchema = z
  .object({
    schemaVersion: z.literal(1),
    strategy: z.enum(["forge-summary", "provider-native"]),
    summarizedThroughMessageIndex: z.number().int().nonnegative(),
    sourceHash: z.string().regex(/^[a-f0-9]{64}$/u),
    retainedTailStartIndex: z.number().int().nonnegative(),
    retainedTailHash: z.string().regex(/^[a-f0-9]{64}$/u),
    summary: z.string().min(1).optional(),
    opaqueProviderItem: z.unknown().optional(),
    provider: z.string().min(1),
    compactionModelId: z.string().min(1),
    estimatedCheckpointTokens: z.number().int().nonnegative(),
    sourceMessageCount: z.number().int().positive(),
    createdAt: z.iso.datetime(),
    safetyLabels: checkpointSafetyLabels,
  })
  .strict()
  .superRefine((checkpoint, context) => {
    const hasSummary = checkpoint.summary !== undefined;
    const hasOpaque = checkpoint.opaqueProviderItem !== undefined;
    if (hasSummary === hasOpaque) {
      context.addIssue({
        code: "custom",
        message: "Exactly one checkpoint payload is required.",
      });
    }
    if (
      (checkpoint.strategy === "forge-summary" && !hasSummary) ||
      (checkpoint.strategy === "provider-native" && !hasOpaque)
    ) {
      context.addIssue({
        code: "custom",
        message: "Checkpoint payload does not match its strategy.",
      });
    }
    if (
      checkpoint.summarizedThroughMessageIndex !==
        checkpoint.retainedTailStartIndex ||
      checkpoint.retainedTailStartIndex > checkpoint.sourceMessageCount
    ) {
      context.addIssue({
        code: "custom",
        message: "Checkpoint message ranges are inconsistent.",
      });
    }
  });

export interface ContextCheckpoint {
  readonly schemaVersion: 1;
  readonly strategy: "forge-summary" | "provider-native";
  readonly summarizedThroughMessageIndex: number;
  readonly sourceHash: string;
  readonly retainedTailStartIndex: number;
  readonly retainedTailHash: string;
  readonly summary?: string;
  readonly opaqueProviderItem?: unknown;
  readonly provider: string;
  readonly compactionModelId: string;
  readonly estimatedCheckpointTokens: number;
  readonly sourceMessageCount: number;
  readonly createdAt: string;
  readonly safetyLabels: readonly [
    "untrusted-conversation-memory",
    "no-approval-state",
    "no-policy-authority",
  ];
}

const sessionSnapshotV1Schema = z
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

export const sessionSnapshotSchema = z
  .object({
    schemaVersion: z.literal(2),
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
    contextCheckpoint: contextCheckpointSchema.optional(),
  })
  .strict()
  .superRefine((session, context) => {
    const checkpoint = session.contextCheckpoint;
    if (!checkpoint) return;
    if (
      checkpoint.sourceMessageCount > session.messages.length ||
      checkpoint.retainedTailStartIndex > session.messages.length
    ) {
      context.addIssue({
        code: "custom",
        message: "Checkpoint range exceeds the canonical transcript.",
      });
    }
  });

export const persistedSessionSnapshotSchema = z.union([
  sessionSnapshotSchema,
  sessionSnapshotV1Schema,
]);

export interface SessionSnapshot {
  readonly schemaVersion: 2;
  readonly id: string;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly workspaceRoot: string;
  readonly workingDirectory: string;
  readonly messages: readonly ModelConversationMessage[];
  readonly runIds: readonly string[];
  readonly lastRunStatus?: RunStatus;
  readonly contextCheckpoint?: ContextCheckpoint;
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

const contextBudgetSchema = z
  .object({
    schemaVersion: z.literal(1),
    provider: z.string(),
    modelId: z.string(),
    contextWindowTokens: z.number().int().positive(),
    contextWindowSource: z.enum(["adapter-table", "configured-fallback"]),
    estimationMethod: z.enum([
      "provider-tokenizer",
      "sdk",
      "conservative-fallback",
    ]),
    estimationConfidence: z.enum(["exact", "estimated"]),
    estimates: z
      .object({
        instructions: z.number().int().nonnegative(),
        currentRequest: z.number().int().nonnegative(),
        toolSchemas: z.number().int().nonnegative(),
        conversationHistory: z.number().int().nonnegative(),
        continuation: z.number().int().nonnegative(),
        toolResults: z.number().int().nonnegative(),
      })
      .strict(),
    estimatedInputTokens: z.number().int().nonnegative(),
    requestedOutputTokens: z.number().int().nonnegative(),
    safetyBufferTokens: z.number().int().nonnegative(),
    effectiveReserveTokens: z.number().int().nonnegative(),
    availableInputTokens: z.number().int().nonnegative(),
    mandatoryTokens: z.number().int().nonnegative(),
    retainedMessageCount: z.number().int().nonnegative(),
    omittedMessageCount: z.number().int().nonnegative(),
    instructionSnapshotHash: z.string().regex(/^[a-f0-9]{64}$/u),
    fits: z.boolean(),
    mandatoryFits: z.boolean(),
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
      imageCount: z.number().int().positive().max(8).optional(),
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
      type: z.literal("context.budgeted"),
      step: z.number().int().positive(),
      budget: contextBudgetSchema,
    })
    .strict(),
  z
    .object({
      type: z.enum(["context.warning", "context.limit_reached"]),
      step: z.number().int().positive(),
      message: z.string(),
      budget: contextBudgetSchema,
    })
    .strict(),
  z
    .object({
      type: z.literal("context.usage"),
      step: z.number().int().positive(),
      estimatedInputTokens: z.number().int().nonnegative(),
      providerInputTokens: z.number().int().nonnegative(),
      absoluteErrorTokens: z.number().int().nonnegative(),
      relativeError: z.number().nonnegative(),
    })
    .strict(),
  z
    .object({
      type: z.literal("context.compaction.started"),
      step: z.number().int().positive(),
      strategy: z.literal("adapter-continuation"),
      estimatedBeforeTokens: z.number().int().nonnegative(),
    })
    .strict(),
  z
    .object({
      type: z.literal("context.compaction.completed"),
      step: z.number().int().positive(),
      strategy: z.literal("adapter-continuation"),
      estimatedBeforeTokens: z.number().int().nonnegative(),
      estimatedAfterTokens: z.number().int().nonnegative(),
      reclaimedTokens: z.number().int().nonnegative(),
    })
    .strict(),
  z
    .object({
      type: z.literal("context.compaction.failed"),
      step: z.number().int().positive(),
      strategy: z.literal("adapter-continuation"),
      message: z.string(),
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
