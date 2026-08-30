import type {
  CanonicalConversationMessage,
  ModelConversationMessage,
  RunEvent,
  RunStatus,
} from "@forge/core";
import { validateCanonicalConversation } from "@forge/core";
import { z } from "zod";

const conversationMessageSchema = z
  .object({
    role: z.enum(["user", "assistant"]),
    content: z.string(),
  })
  .strict();

const canonicalTextContentSchema = z
  .object({ type: z.literal("text"), text: z.string().max(1_000_000) })
  .strict();
const canonicalToolCallContentSchema = z
  .object({
    type: z.literal("tool-call"),
    id: z.string().min(1).max(1_000),
    name: z.string().min(1).max(500),
    input: z.unknown(),
    providerMetadata: z.record(z.string(), z.unknown()).optional(),
  })
  .strict();
const canonicalUserMessageSchema = z
  .object({
    id: z.string().min(1).max(1_000),
    runId: z.string().min(1).max(1_000),
    role: z.literal("user"),
    content: z.array(canonicalTextContentSchema).min(1).max(100),
  })
  .strict();
const canonicalAssistantMessageSchema = z
  .object({
    id: z.string().min(1).max(1_000),
    runId: z.string().min(1).max(1_000),
    step: z.number().int().nonnegative(),
    role: z.literal("assistant"),
    content: z
      .array(
        z.discriminatedUnion("type", [
          canonicalTextContentSchema,
          canonicalToolCallContentSchema,
        ]),
      )
      .min(1)
      .max(200),
  })
  .strict();
const canonicalToolMessageSchema = z
  .object({
    id: z.string().min(1).max(1_000),
    runId: z.string().min(1).max(1_000),
    step: z.number().int().nonnegative(),
    role: z.literal("tool"),
    toolCallId: z.string().min(1).max(1_000),
    toolName: z.string().min(1).max(500),
    content: z.array(canonicalTextContentSchema).min(1).max(100),
    isError: z.boolean(),
  })
  .strict();
const canonicalConversationMessageSchema = z.discriminatedUnion("role", [
  canonicalUserMessageSchema,
  canonicalAssistantMessageSchema,
  canonicalToolMessageSchema,
]);

const sessionReasoningSchema = z
  .object({
    assistantMessageIndex: z.number().int().nonnegative(),
    content: z.string(),
  })
  .strict();

const checkpointSafetyLabels = z.tuple([
  z.literal("untrusted-conversation-memory"),
  z.literal("no-approval-state"),
  z.literal("no-policy-authority"),
]);

const contextCheckpointV1Schema = z
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
    generation: z
      .object({
        incurredProviderUsage: z.boolean(),
        durationMs: z.number().nonnegative(),
        inputTokens: z.number().int().nonnegative().optional(),
        outputTokens: z.number().int().nonnegative().optional(),
      })
      .strict()
      .optional(),
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

export const contextCheckpointSchema = z
  .preprocess((value) => {
    if (
      typeof value === "object" &&
      value !== null &&
      "schemaVersion" in value &&
      value.schemaVersion === 2
    ) {
      return { ...value, schemaVersion: 1 };
    }
    return value;
  }, contextCheckpointV1Schema)
  .transform((checkpoint) => ({ ...checkpoint, schemaVersion: 2 as const }));

export interface ContextCheckpoint {
  readonly schemaVersion: 2;
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
  readonly generation?: {
    readonly incurredProviderUsage: boolean;
    readonly durationMs: number;
    readonly inputTokens?: number;
    readonly outputTokens?: number;
  };
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

const sessionSnapshotV2Schema = z
  .object({
    schemaVersion: z.literal(2),
    id: z.uuid(),
    createdAt: z.iso.datetime(),
    updatedAt: z.iso.datetime(),
    workspaceRoot: z.string().min(1),
    workingDirectory: z.string().min(1),
    messages: z.array(conversationMessageSchema).max(10_000),
    reasoning: z.array(sessionReasoningSchema).max(10_000).default([]),
    runIds: z.array(z.uuid()).max(10_000),
    lastRunStatus: z
      .enum(["completed", "failed", "cancelled", "denied", "limit_reached"])
      .optional(),
    contextCheckpoint: contextCheckpointV1Schema.optional(),
  })
  .strict()
  .superRefine((session, context) => {
    for (const entry of session.reasoning) {
      if (session.messages[entry.assistantMessageIndex]?.role !== "assistant") {
        context.addIssue({
          code: "custom",
          message: "Saved reasoning must reference an assistant message.",
        });
      }
    }
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

export const sessionSnapshotSchema = z
  .object({
    schemaVersion: z.literal(3),
    id: z.uuid(),
    createdAt: z.iso.datetime(),
    updatedAt: z.iso.datetime(),
    workspaceRoot: z.string().min(1),
    workingDirectory: z.string().min(1),
    history: z.array(canonicalConversationMessageSchema).max(10_000),
    reasoning: z.array(sessionReasoningSchema).max(10_000).default([]),
    runIds: z.array(z.uuid()).max(10_000),
    historyFidelity: z.enum(["structured", "text-only-migrated"]),
    lastRunStatus: z
      .enum(["completed", "failed", "cancelled", "denied", "limit_reached"])
      .optional(),
    contextCheckpoint: contextCheckpointSchema.optional(),
  })
  .strict()
  .superRefine((session, context) => {
    try {
      validateCanonicalConversation(
        session.history as readonly CanonicalConversationMessage[],
      );
    } catch (error) {
      context.addIssue({
        code: "custom",
        message: error instanceof Error ? error.message : "Invalid history.",
      });
    }
    for (const entry of session.reasoning) {
      if (session.history[entry.assistantMessageIndex]?.role !== "assistant") {
        context.addIssue({
          code: "custom",
          message: "Saved reasoning must reference an assistant message.",
        });
      }
    }
    const checkpoint = session.contextCheckpoint;
    if (
      checkpoint &&
      (checkpoint.sourceMessageCount > session.history.length ||
        checkpoint.retainedTailStartIndex > session.history.length)
    ) {
      context.addIssue({
        code: "custom",
        message: "Checkpoint range exceeds the canonical transcript.",
      });
    }
  });

export const persistedSessionSnapshotSchema = z.union([
  sessionSnapshotSchema,
  sessionSnapshotV2Schema,
  sessionSnapshotV1Schema,
]);

export interface SessionSnapshot {
  readonly schemaVersion: 3;
  readonly id: string;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly workspaceRoot: string;
  readonly workingDirectory: string;
  readonly history: readonly CanonicalConversationMessage[];
  /** @deprecated Display-only v2 text projection. Model continuation uses history. */
  readonly messages: readonly ModelConversationMessage[];
  readonly reasoning: readonly SessionReasoning[];
  readonly runIds: readonly string[];
  readonly historyFidelity: "structured" | "text-only-migrated";
  readonly lastRunStatus?: RunStatus;
  readonly contextCheckpoint?: ContextCheckpoint;
}

export interface SessionReasoning {
  readonly assistantMessageIndex: number;
  readonly content: string;
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

const hashSchema = z.string().regex(/^[a-f0-9]{64}$/u);
const contextPressureSchema = z
  .object({
    schemaVersion: z.literal(1),
    provider: z.string(),
    modelId: z.string(),
    estimatedInputTokens: z.number().int().nonnegative(),
    availableInputTokens: z.number().int().nonnegative(),
    ratio: z.number().nonnegative(),
    confidence: z.enum(["exact", "estimated", "unavailable"]),
    mode: z.enum(["off", "warn", "auto-session", "auto-default", "paused"]),
    state: z.enum([
      "normal",
      "elevated",
      "compact-soon",
      "compacting",
      "compacted",
      "critical",
      "paused",
    ]),
    estimates: contextBudgetSchema.shape.estimates,
  })
  .strict();

const promptPrefixObservationSchema = z
  .object({
    schemaVersion: z.literal(1),
    promptSchemaVersion: z.number().int().positive(),
    stablePrefixHash: hashSchema,
    instructionHash: hashSchema,
    resourceCatalogHash: hashSchema,
    toolSchemaHash: hashSchema,
    providerModelHash: hashSchema,
    promptSchemaHash: hashSchema,
    enabledResourceHash: hashSchema,
    enabledPluginHash: hashSchema,
    checkpointGenerationHash: hashSchema,
    providerOptionsHash: hashSchema,
    invalidatedBy: z.array(
      z.enum([
        "initial",
        "provider-or-model",
        "prompt-schema",
        "instructions",
        "resource-catalog",
        "enabled-resources",
        "enabled-plugins",
        "tool-schema",
        "checkpoint-generation",
      ]),
    ),
    cacheMode: z.enum([
      "automatic",
      "keyed",
      "explicit-breakpoints",
      "unsupported",
    ]),
    cacheKey: hashSchema.optional(),
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
      type: z.literal("skill.discovery"),
      catalogCount: z.number().int().nonnegative().max(64),
      diagnosticCount: z.number().int().nonnegative(),
      diagnostics: z
        .array(
          z
            .object({
              code: z.string().max(100),
              source: z.enum(["builtin", "user", "project"]),
              sourcePath: z.string().max(4_096),
              message: z.string().max(1_000),
            })
            .strict(),
        )
        .max(128),
    })
    .strict(),
  z
    .object({
      type: z.literal("skill.selected"),
      id: z.string().max(200),
      name: z.string().max(64),
      source: z.enum(["builtin", "user", "project"]),
      reason: z.enum(["automatic", "explicit"]),
      invocation: z.enum(["model", "explicit-only"]),
    })
    .strict(),
  z
    .object({
      type: z.literal("skill.loaded"),
      id: z.string().max(300),
      name: z.string().max(64),
      source: z.enum(["builtin", "user", "project"]),
      relativePath: z.string().max(4_096),
      truncated: z.boolean(),
    })
    .strict(),
  z
    .object({
      type: z.literal("skill.rejected"),
      id: z.string().max(300).optional(),
      code: z.string().max(100),
      message: z.string().max(1_000),
    })
    .strict(),
  z
    .object({
      type: z.literal("docs.search"),
      query: z.string().max(500),
      resultCount: z.number().int().nonnegative().max(8),
      locale: z.enum(["en", "zh-CN"]),
      fallback: z.boolean(),
    })
    .strict(),
  z
    .object({
      type: z.literal("docs.read"),
      reference: z.string().max(300),
      truncated: z.boolean(),
    })
    .strict(),
  z
    .object({
      type: z.literal("docs.rejected"),
      tool: z.enum(["search_forge_docs", "read_forge_doc"]),
      code: z.string().max(100),
      message: z.string().max(1_000),
    })
    .strict(),
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
      type: z.literal("context.pressure"),
      step: z.number().int().positive(),
      snapshot: contextPressureSchema,
    })
    .strict(),
  z
    .object({
      type: z.literal("cache.prefix"),
      step: z.number().int().positive(),
      observation: promptPrefixObservationSchema,
    })
    .strict(),
  z
    .object({
      type: z.literal("cache.observed"),
      schemaVersion: z.literal(1),
      step: z.number().int().positive(),
      inputTokens: z.number().int().nonnegative().optional(),
      cacheReadTokens: z.number().int().nonnegative().optional(),
      cacheWriteTokens: z.number().int().nonnegative().optional(),
      uncachedInputTokens: z.number().int().nonnegative().optional(),
      hitRatio: z.number().min(0).max(1).optional(),
    })
    .strict(),
  z
    .object({
      type: z.literal("approval.scope-decision"),
      schemaVersion: z.literal(1),
      actionId: z.string().min(1).max(200),
      decision: z.enum(["allow-once", "allow-session", "deny"]),
      scopeId: hashSchema.optional(),
      provenance: z.enum(["user", "policy"]),
      persisted: z.literal(false),
    })
    .strict(),
  z
    .object({
      type: z.literal("update.availability"),
      schemaVersion: z.literal(1),
      state: z.enum([
        "cached",
        "refreshing",
        "available",
        "current",
        "failed",
        "disabled",
      ]),
      currentVersion: z.string().max(100),
      latestVersion: z.string().max(100).optional(),
      source: z.literal("npm-registry"),
    })
    .strict(),
  z
    .object({
      type: z.literal("context.auto-paused"),
      step: z.number().int().positive(),
      reason: z.enum([
        "cancelled",
        "invalid-output",
        "repeated-failure",
        "low-reclamation",
      ]),
      message: z.string(),
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
      type: z.literal("model.reasoning-unavailable"),
      step: z.number().int().positive(),
      reasoningTokens: z.number().int().nonnegative(),
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
    parentRunId: z.uuid().optional(),
    subagentName: z
      .string()
      .regex(/^[a-z][a-z0-9-]{0,63}$/u)
      .optional(),
    sequence: z.number().int().nonnegative(),
    timestamp: z.iso.datetime(),
    event: runEventSchema,
  })
  .strict();

export interface TraceEnvelope {
  readonly schemaVersion: 1;
  readonly runId: string;
  readonly sessionId?: string;
  readonly parentRunId?: string;
  readonly subagentName?: string;
  readonly sequence: number;
  readonly timestamp: string;
  readonly event: RunEvent;
}
