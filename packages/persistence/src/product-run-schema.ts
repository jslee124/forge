import { z } from "zod";

export const productIdSchema = z.string().regex(/^[a-zA-Z0-9_-]{1,128}$/);
export const productTimestampSchema = z.iso.datetime();
export const productCompletionSchema = z
  .object({
    outcome: z.enum([
      "completed",
      "failed",
      "cancelled",
      "denied",
      "limit_reached",
      "interrupted",
    ]),
    reason: z
      .enum([
        "model_step_limit",
        "tool_call_limit",
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
    message: z.string().max(16_384).optional(),
    modelSteps: z.number().int().nonnegative().optional(),
    toolCalls: z.number().int().nonnegative().optional(),
    durationMs: z.number().nonnegative().optional(),
  })
  .strict();
export const productActionSchema = z
  .object({
    actionId: productIdSchema,
    step: z.number().int().positive(),
    tool: z.string().max(256),
    status: z.enum([
      "proposed",
      "awaiting_approval",
      "running",
      "succeeded",
      "failed",
      "denied",
      "unknown",
      "cancelled",
    ]),
    input: z.string().max(16_384),
    output: z.string().max(16_384).optional(),
    truncated: z.boolean().optional(),
  })
  .strict();
export type RecordedAction = z.infer<typeof productActionSchema>;
export const productRecordPayloadSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("action"), action: productActionSchema }).strict(),
  z
    .object({
      type: z.literal("detail"),
      kind: z.enum(["reasoning", "tool", "context", "error", "system"]),
      text: z.string().max(65_536),
      step: z.number().int().positive().optional(),
      truncated: z.boolean().optional(),
    })
    .strict(),
  z
    .object({
      type: z.literal("text"),
      text: z.string().max(65_536),
      truncated: z.boolean().optional(),
    })
    .strict(),
  z
    .object({
      type: z.literal("approval"),
      approvalId: productIdSchema,
      actionId: productIdSchema.optional(),
      description: z.string().max(16_384),
    })
    .strict(),
  z
    .object({
      type: z.literal("decision"),
      approvalId: productIdSchema,
      allow: z.boolean(),
    })
    .strict(),
  z
    .object({ type: z.literal("result"), completion: productCompletionSchema })
    .strict(),
]);
export type ProductRecordPayload = z.infer<typeof productRecordPayloadSchema>;
export const productRecordEventSchema = z
  .object({
    sequence: z.number().int().positive(),
    occurredAt: productTimestampSchema,
    payload: productRecordPayloadSchema,
  })
  .strict();
export type ProductRecordEvent = z.infer<typeof productRecordEventSchema>;
export const productRunSummarySchema = z
  .object({
    schemaVersion: z.literal(1),
    sessionId: productIdSchema,
    runId: productIdSchema,
    engine: z.enum(["native", "codex"]),
    prompt: z.string().max(2048),
    startedAt: productTimestampSchema,
    updatedAt: productTimestampSchema,
    state: z.enum(["running", "finished"]),
    completion: productCompletionSchema.optional(),
    sequence: z.number().int().nonnegative(),
    omittedCharacters: z.number().int().nonnegative(),
    omittedEvents: z.number().int().nonnegative(),
    journalIncomplete: z.boolean().optional(),
  })
  .strict();
export type ProductRunSummary = z.infer<typeof productRunSummarySchema>;
export interface ProductRunRecord {
  summary: ProductRunSummary;
  events: ProductRecordEvent[];
  incomplete: boolean;
}

export const productActivityItemSchema = z
  .object({
    id: z.string().max(256),
    kind: z.enum([
      "action",
      "reasoning",
      "approval",
      "error",
      "context",
      "system",
      "tool",
    ]),
    text: z.string().max(65_536),
    step: z.number().int().positive().optional(),
    action: productActionSchema.optional(),
    decision: z.enum(["pending", "allowed", "denied", "unresolved"]).optional(),
    truncated: z.boolean(),
  })
  .strict();
export const productActivitySchema = z
  .object({
    items: z.array(productActivityItemSchema).max(500),
    omitted: z.number().int().nonnegative(),
  })
  .strict();
export type ProductActivityItem = z.infer<typeof productActivityItemSchema>;
export type ProductActivity = z.infer<typeof productActivitySchema>;
export const productRunHistorySchema = z
  .object({
    runs: z.array(productRunSummarySchema).max(20),
    nextCursor: z.number().int().nonnegative().optional(),
    selected: z
      .object({
        summary: productRunSummarySchema,
        activity: productActivitySchema,
        incomplete: z.boolean(),
      })
      .strict()
      .optional(),
    error: z.string().max(256).optional(),
  })
  .strict();
