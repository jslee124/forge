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

export interface ModelConversationMessage {
  readonly role: "assistant" | "user";
  readonly content: string;
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
  stream(
    request: ModelRequest,
    signal: AbortSignal,
  ): AsyncIterable<ModelStreamEvent>;
}
