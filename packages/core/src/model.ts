import type { PromptCacheCapabilities } from "./cache.js";
import type { ModelContextCapabilities } from "./context.js";
import type { ModelToolDefinition, ToolCall, ToolResult } from "./tools.js";

export interface ModelContinuation {
  readonly provider: string;
  readonly data: unknown;
}

export interface ModelToolResult {
  readonly callId: string;
  readonly toolName: string;
  readonly result: ToolResult;
}

export interface CanonicalTextContent {
  readonly type: "text";
  readonly text: string;
}

export interface CanonicalToolCallContent {
  readonly type: "tool-call";
  readonly id: string;
  readonly name: string;
  readonly input: unknown;
  readonly providerMetadata?: Readonly<Record<string, unknown>>;
}

export type CanonicalUserContent = CanonicalTextContent;
export type CanonicalAssistantContent =
  | CanonicalTextContent
  | CanonicalToolCallContent;
export type CanonicalToolContent = CanonicalTextContent;

export type CanonicalConversationMessage =
  | {
      readonly id: string;
      readonly runId: string;
      readonly role: "user";
      readonly content: readonly CanonicalUserContent[];
    }
  | {
      readonly id: string;
      readonly runId: string;
      readonly step: number;
      readonly role: "assistant";
      readonly content: readonly CanonicalAssistantContent[];
    }
  | {
      readonly id: string;
      readonly runId: string;
      readonly step: number;
      readonly role: "tool";
      readonly toolCallId: string;
      readonly toolName: string;
      readonly content: readonly CanonicalToolContent[];
      readonly isError: boolean;
    };

/** Read compatibility for callers that still construct pre-v3 text history. */
export interface LegacyConversationMessage {
  readonly role: "assistant" | "user";
  readonly content: string;
}

export type ModelConversationMessage =
  | CanonicalConversationMessage
  | LegacyConversationMessage;

export function canonicalText(message: ModelConversationMessage): string {
  if (typeof message.content === "string") return message.content;
  return message.content
    .flatMap((part) => (part.type === "text" ? [part.text] : []))
    .join("");
}

export function normalizeCanonicalConversation(
  messages: readonly ModelConversationMessage[],
  legacyRunId = "legacy",
): readonly CanonicalConversationMessage[] {
  return messages.map((message, index) => {
    if (typeof message.content !== "string") {
      return message as CanonicalConversationMessage;
    }
    if (message.role === "user") {
      return {
        id: `${legacyRunId}:message:${index}`,
        runId: legacyRunId,
        role: "user",
        content: [{ type: "text", text: message.content }],
      };
    }
    return {
      id: `${legacyRunId}:message:${index}`,
      runId: legacyRunId,
      step: 0,
      role: "assistant",
      content: [{ type: "text", text: message.content }],
    };
  });
}

export function validateCanonicalConversation(
  history: readonly CanonicalConversationMessage[],
): void {
  const messageIds = new Set<string>();
  const calls = new Map<string, { readonly name: string; paired: boolean }>();
  for (const message of history) {
    if (messageIds.has(message.id)) {
      throw new Error(`Duplicate canonical message ID: ${message.id}`);
    }
    messageIds.add(message.id);
    if (message.role === "assistant") {
      for (const part of message.content) {
        if (part.type !== "tool-call") continue;
        assertJsonSafe(part.input, "tool input", 32, 1_000_000);
        if (part.providerMetadata) {
          assertJsonSafe(
            part.providerMetadata,
            "provider metadata",
            16,
            64_000,
          );
        }
        if (calls.has(part.id)) {
          throw new Error(`Duplicate canonical tool-call ID: ${part.id}`);
        }
        calls.set(part.id, { name: part.name, paired: false });
      }
    } else if (message.role === "tool") {
      const call = calls.get(message.toolCallId);
      if (!call || call.paired || call.name !== message.toolName) {
        throw new Error(
          `Orphan, duplicate, or mismatched canonical tool result: ${message.toolCallId}`,
        );
      }
      calls.set(message.toolCallId, { ...call, paired: true });
    }
  }
  const dangling = [...calls].find(([, call]) => !call.paired);
  if (dangling) {
    throw new Error(`Dangling canonical tool call: ${dangling[0]}`);
  }
}

function assertJsonSafe(
  value: unknown,
  label: string,
  maxDepth: number,
  maxBytes: number,
): void {
  const visit = (current: unknown, depth: number): void => {
    if (depth > maxDepth) throw new Error(`${label} exceeds depth limit.`);
    if (
      current === null ||
      typeof current === "string" ||
      typeof current === "boolean"
    ) {
      return;
    }
    if (typeof current === "number") {
      if (!Number.isFinite(current))
        throw new Error(`${label} is not JSON-safe.`);
      return;
    }
    if (Array.isArray(current)) {
      for (const item of current) visit(item, depth + 1);
      return;
    }
    if (typeof current !== "object") {
      throw new Error(`${label} is not JSON-safe.`);
    }
    const prototype = Object.getPrototypeOf(current);
    if (prototype !== Object.prototype && prototype !== null) {
      throw new Error(`${label} has an unsupported prototype.`);
    }
    for (const [key, item] of Object.entries(current)) {
      if (key === "__proto__" || key === "constructor" || key === "prototype") {
        throw new Error(`${label} contains a sensitive key.`);
      }
      visit(item, depth + 1);
    }
  };
  visit(value, 0);
  const serialized = JSON.stringify(value);
  if (Buffer.byteLength(serialized, "utf8") > maxBytes) {
    throw new Error(`${label} exceeds byte limit.`);
  }
}

export function stableCanonicalConversationJson(
  history: readonly CanonicalConversationMessage[],
): string {
  validateCanonicalConversation(history);
  return JSON.stringify(history);
}

/** Provider-neutral projection consumed by the AI SDK transports. */
export function projectCanonicalConversation(
  messages: readonly ModelConversationMessage[],
): readonly unknown[] {
  const history = normalizeCanonicalConversation(messages);
  validateCanonicalConversation(history);
  return history.map((message) => {
    if (message.role === "user") {
      return { role: "user", content: canonicalText(message) };
    }
    if (message.role === "tool") {
      return {
        role: "tool",
        content: [
          {
            type: "tool-result",
            toolCallId: message.toolCallId,
            toolName: message.toolName,
            output: { type: "text", value: canonicalText(message) },
          },
        ],
      };
    }
    const calls = message.content.filter(
      (part): part is CanonicalToolCallContent => part.type === "tool-call",
    );
    if (calls.length === 0) {
      return { role: "assistant", content: canonicalText(message) };
    }
    return {
      role: "assistant",
      content: message.content.map((part) =>
        part.type === "text"
          ? part
          : {
              type: "tool-call",
              toolCallId: part.id,
              toolName: part.name,
              input: part.input,
            },
      ),
    };
  });
}

export type ModelImageInput =
  | {
      readonly type: "url";
      readonly url: string;
    }
  | {
      readonly type: "base64";
      readonly mediaType:
        | "image/jpeg"
        | "image/png"
        | "image/gif"
        | "image/webp";
      readonly data: string;
      readonly filename?: string;
    };

export interface ModelRequest {
  readonly prompt: string;
  readonly images?: readonly ModelImageInput[];
  readonly instructions?: string;
  readonly conversation?: readonly ModelConversationMessage[];
  readonly tools?: readonly ModelToolDefinition[];
  readonly continuation?: ModelContinuation;
  readonly toolResults?: readonly ModelToolResult[];
  readonly cacheControl?: {
    readonly mode: "automatic" | "keyed" | "explicit-breakpoints";
    readonly key?: string;
    readonly stablePrefixHash: string;
  };
}

export interface ModelUsage {
  readonly inputTokens: number | undefined;
  readonly outputTokens: number | undefined;
  readonly reasoningTokens: number | undefined;
  readonly cachedInputTokens: number | undefined;
  readonly cacheWriteTokens: number | undefined;
  readonly totalTokens: number | undefined;
}

export type ModelFinishReason =
  | "stop"
  | "length"
  | "content-filter"
  | "tool-calls"
  | "error"
  | "other";

export type ModelStreamEvent =
  | {
      readonly type: "reasoning.delta";
      readonly text: string;
    }
  | {
      readonly type: "text.delta";
      readonly text: string;
    }
  | {
      readonly type: "warning";
      readonly message: string;
    }
  | {
      readonly type: "tool.call";
      readonly call: ToolCall;
    }
  | {
      readonly type: "finish";
      readonly finishReason: ModelFinishReason;
      readonly usage: ModelUsage;
      readonly providerMetadata?: Readonly<Record<string, unknown>>;
      readonly continuation?: ModelContinuation;
    }
  | {
      readonly type: "abort";
      readonly reason?: string;
    };

export interface ModelAdapter {
  readonly context?: ModelContextCapabilities;
  readonly promptCache?: PromptCacheCapabilities;
  stream(
    request: ModelRequest,
    signal: AbortSignal,
  ): AsyncIterable<ModelStreamEvent>;
}
