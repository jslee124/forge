import { createHash } from "node:crypto";

import { z } from "zod";

import type {
  ModelAdapter,
  ModelContinuation,
  ModelConversationMessage,
  ModelRequest,
} from "./model.js";

export type ContextMode = "off" | "warn" | "compact";
export type TokenEstimateMethod =
  | "provider-tokenizer"
  | "sdk"
  | "conservative-fallback";

export interface TokenEstimate {
  readonly tokens: number;
  readonly method: TokenEstimateMethod;
  readonly confidence: "exact" | "estimated";
}

export interface ModelContextCapabilities {
  readonly provider: string;
  readonly modelId: string;
  readonly contextWindowTokens: number;
  readonly contextWindowSource: "adapter-table" | "configured-fallback";
  readonly maxOutputTokens?: number;
  readonly nativeCompaction: "unsupported" | "opaque-provider-item";
  readonly continuationProjection: "unsupported" | "adapter-owned";
  estimateRequestTokens(request: ModelRequest): Promise<TokenEstimate>;
  isContextOverflow?(error: unknown): boolean;
  projectContinuation?(
    continuation: ModelContinuation,
    targetTokens: number,
  ): Promise<ModelContinuation | undefined>;
}

export interface ContextConfiguration {
  readonly mode: ContextMode;
  readonly reservedOutputTokens: number;
  readonly bufferTokens: number;
  readonly recentTailTokens: number;
  readonly summaryTargetTokens: number;
}

export const DEFAULT_CONTEXT_CONFIGURATION: ContextConfiguration = {
  mode: "warn",
  reservedOutputTokens: 4_096,
  bufferTokens: 8_192,
  recentTailTokens: 12_000,
  summaryTargetTokens: 1_200,
};

export interface ContextTokenBreakdown {
  readonly instructions: number;
  readonly currentRequest: number;
  readonly toolSchemas: number;
  readonly conversationHistory: number;
  readonly continuation: number;
  readonly toolResults: number;
}

export interface ContextBudgetReport {
  readonly schemaVersion: 1;
  readonly provider: string;
  readonly modelId: string;
  readonly contextWindowTokens: number;
  readonly contextWindowSource: ModelContextCapabilities["contextWindowSource"];
  readonly estimationMethod: TokenEstimateMethod;
  readonly estimationConfidence: TokenEstimate["confidence"];
  readonly estimates: ContextTokenBreakdown;
  readonly estimatedInputTokens: number;
  readonly requestedOutputTokens: number;
  readonly safetyBufferTokens: number;
  readonly effectiveReserveTokens: number;
  readonly availableInputTokens: number;
  readonly mandatoryTokens: number;
  readonly retainedMessageCount: number;
  readonly omittedMessageCount: number;
  readonly instructionSnapshotHash: string;
  readonly fits: boolean;
  readonly mandatoryFits: boolean;
}

export interface ActiveConversationView {
  readonly messages: readonly ModelConversationMessage[];
  readonly retainedMessageCount: number;
  readonly omittedMessageCount: number;
  readonly retainedTailStartIndex: number;
  readonly estimatedTokens: number;
}

const DEFAULT_UNKNOWN_CAPABILITIES: ModelContextCapabilities = {
  provider: "unknown",
  modelId: "unknown",
  contextWindowTokens: 32_768,
  contextWindowSource: "configured-fallback",
  maxOutputTokens: 4_096,
  nativeCompaction: "unsupported",
  continuationProjection: "unsupported",
  estimateRequestTokens: async (request) =>
    conservativeRequestEstimate(request),
};

export function modelContextCapabilities(
  model: ModelAdapter,
): ModelContextCapabilities {
  return model.context ?? DEFAULT_UNKNOWN_CAPABILITIES;
}

export async function budgetModelRequest(options: {
  readonly model: ModelAdapter;
  readonly request: ModelRequest;
  readonly configuration?: ContextConfiguration;
  readonly omittedMessageCount?: number;
}): Promise<ContextBudgetReport> {
  const configuration = options.configuration ?? DEFAULT_CONTEXT_CONFIGURATION;
  const capabilities = modelContextCapabilities(options.model);
  const total = await capabilities.estimateRequestTokens(options.request);
  const usesContinuation = options.request.continuation !== undefined;
  const estimates: ContextTokenBreakdown = {
    instructions: usesContinuation
      ? 0
      : conservativeTextTokens(options.request.instructions ?? ""),
    currentRequest: usesContinuation
      ? 0
      : conservativeTextTokens(options.request.prompt) +
        conservativeImageTokens(options.request.images),
    toolSchemas: conservativeValueTokens(
      options.request.tools?.map((tool) => ({
        name: tool.name,
        description: tool.description,
        inputSchema: safeJsonSchema(tool.inputSchema),
      })) ?? [],
    ),
    conversationHistory: usesContinuation
      ? 0
      : conservativeValueTokens(options.request.conversation ?? []),
    continuation: conservativeContinuationTokens(
      options.request.continuation?.data ?? null,
    ),
    toolResults: conservativeValueTokens(options.request.toolResults ?? []),
  };
  const effectiveReserveTokens = Math.max(
    configuration.reservedOutputTokens,
    configuration.bufferTokens,
  );
  const availableInputTokens = Math.max(
    0,
    capabilities.contextWindowTokens - effectiveReserveTokens,
  );
  const mandatoryTokens =
    estimates.instructions +
    estimates.currentRequest +
    estimates.toolSchemas +
    estimates.continuation +
    estimates.toolResults;
  return {
    schemaVersion: 1,
    provider: capabilities.provider,
    modelId: capabilities.modelId,
    contextWindowTokens: capabilities.contextWindowTokens,
    contextWindowSource: capabilities.contextWindowSource,
    estimationMethod: total.method,
    estimationConfidence: total.confidence,
    estimates,
    estimatedInputTokens: total.tokens,
    requestedOutputTokens: configuration.reservedOutputTokens,
    safetyBufferTokens: configuration.bufferTokens,
    effectiveReserveTokens,
    availableInputTokens,
    mandatoryTokens,
    retainedMessageCount: options.request.conversation?.length ?? 0,
    omittedMessageCount: options.omittedMessageCount ?? 0,
    instructionSnapshotHash: sha256(options.request.instructions ?? ""),
    fits: total.tokens <= availableInputTokens,
    mandatoryFits: mandatoryTokens <= availableInputTokens,
  };
}

/**
 * Selects only complete user/assistant turns from the end of a transcript.
 * The transcript itself is never changed. An unmatched trailing user message is
 * excluded because the current request is supplied separately by the runtime.
 */
export function selectRecentConversation(
  messages: readonly ModelConversationMessage[],
  tokenBudget: number,
): ActiveConversationView {
  const boundary = completedConversationBoundary(messages);
  let start = boundary;
  let tokens = 0;
  while (start >= 2) {
    const pair = messages.slice(start - 2, start);
    if (pair[0]?.role !== "user" || pair[1]?.role !== "assistant") break;
    const pairTokens = conservativeValueTokens(pair);
    if (tokens + pairTokens > tokenBudget) break;
    tokens += pairTokens;
    start -= 2;
  }
  return {
    messages: messages.slice(start, boundary),
    retainedMessageCount: boundary - start,
    omittedMessageCount: start + (messages.length - boundary),
    retainedTailStartIndex: start,
    estimatedTokens: tokens,
  };
}

export function conservativeRequestEstimate(
  request: ModelRequest,
): TokenEstimate {
  const usesContinuation = request.continuation !== undefined;
  const tokens =
    (usesContinuation
      ? 0
      : conservativeTextTokens(request.instructions ?? "")) +
    (usesContinuation
      ? 0
      : conservativeTextTokens(request.prompt) +
        conservativeImageTokens(request.images)) +
    (usesContinuation
      ? 0
      : conservativeValueTokens(request.conversation ?? [])) +
    conservativeValueTokens(
      request.tools?.map((tool) => ({
        name: tool.name,
        description: tool.description,
        inputSchema: safeJsonSchema(tool.inputSchema),
      })) ?? [],
    ) +
    conservativeContinuationTokens(request.continuation?.data ?? null) +
    conservativeValueTokens(request.toolResults ?? []) +
    16;
  return {
    tokens,
    method: "conservative-fallback",
    confidence: "estimated",
  };
}

export function conservativeTextTokens(value: string): number {
  if (value === "") return 0;
  // Three UTF-8 bytes per token deliberately errs high for English/code while
  // remaining useful for CJK text. Adapters can replace this with a tokenizer.
  return Math.ceil(Buffer.byteLength(value, "utf8") / 3) + 4;
}

function conservativeImageTokens(images: ModelRequest["images"]): number {
  // Image tokenization depends on provider-side resizing. Reserve a deliberately
  // conservative fixed allowance without counting base64 transport bytes as text.
  return (images?.length ?? 0) * 4_096;
}

function conservativeContinuationTokens(value: unknown): number {
  return (
    conservativeValueTokens(redactInlineImageDataForEstimate(value)) +
    countInlineImages(value) * 4_096
  );
}

function countInlineImages(value: unknown): number {
  if (Array.isArray(value)) {
    return value.reduce((total, entry) => total + countInlineImages(entry), 0);
  }
  if (typeof value !== "object" || value === null) return 0;
  const record = value as Record<string, unknown> & {
    readonly type?: unknown;
    readonly mediaType?: unknown;
  };
  if (
    record.type === "file" &&
    typeof record.mediaType === "string" &&
    (record.mediaType === "image" || record.mediaType.startsWith("image/"))
  ) {
    return 1;
  }
  return Object.values(record).reduce<number>(
    (total, entry) => total + countInlineImages(entry),
    0,
  );
}

function redactInlineImageDataForEstimate(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(redactInlineImageDataForEstimate);
  }
  if (typeof value !== "object" || value === null) return value;
  const record = value as Record<string, unknown> & {
    readonly type?: unknown;
    readonly mediaType?: unknown;
  };
  if (
    record.type === "file" &&
    typeof record.mediaType === "string" &&
    (record.mediaType === "image" || record.mediaType.startsWith("image/"))
  ) {
    return { ...record, data: "[inline image: 4096 token allowance]" };
  }
  return Object.fromEntries(
    Object.entries(record).map(([key, entry]) => [
      key,
      redactInlineImageDataForEstimate(entry),
    ]),
  );
}

export function conservativeValueTokens(value: unknown): number {
  if (value === null || value === undefined) return 0;
  return conservativeTextTokens(stableSerialize(value));
}

export function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function completedConversationBoundary(
  messages: readonly ModelConversationMessage[],
): number {
  let boundary = 0;
  for (let index = 0; index + 1 < messages.length; index += 2) {
    if (
      messages[index]?.role !== "user" ||
      messages[index + 1]?.role !== "assistant"
    ) {
      break;
    }
    boundary = index + 2;
  }
  return boundary;
}

function safeJsonSchema(schema: z.ZodType): unknown {
  try {
    return z.toJSONSchema(schema);
  } catch {
    return { type: "object", description: "unavailable schema projection" };
  }
}

function stableSerialize(value: unknown): string {
  return JSON.stringify(normalizeForEstimate(value, new WeakSet<object>()));
}

function normalizeForEstimate(
  value: unknown,
  ancestors: WeakSet<object>,
): unknown {
  if (typeof value === "bigint") return value.toString();
  if (typeof value !== "object" || value === null) return value;
  if (ancestors.has(value)) return "[Circular]";
  ancestors.add(value);
  const normalized = Array.isArray(value)
    ? value.map((entry) => normalizeForEstimate(entry, ancestors))
    : Object.fromEntries(
        Object.entries(value)
          .sort(([left], [right]) => left.localeCompare(right))
          .map(([key, entry]) => [key, normalizeForEstimate(entry, ancestors)]),
      );
  ancestors.delete(value);
  return normalized;
}
