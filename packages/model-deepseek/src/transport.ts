import type {
  ModelContinuation,
  ModelConversationMessage,
  ModelImageInput,
  ModelStreamEvent,
  ModelToolDefinition,
  ModelToolResult,
} from "@forge/core";

import type {
  DeepSeekReasoningEffort,
  DeepSeekThinkingMode,
} from "./config.js";

export interface DeepSeekTransportRequest {
  readonly apiKey: string;
  readonly model: string;
  readonly thinking: DeepSeekThinkingMode;
  readonly reasoningEffort?: DeepSeekReasoningEffort;
  readonly prompt: string;
  readonly images?: readonly ModelImageInput[];
  readonly instructions?: string;
  readonly conversation?: readonly ModelConversationMessage[];
  readonly tools?: readonly ModelToolDefinition[];
  readonly continuation?: ModelContinuation;
  readonly toolResults?: readonly ModelToolResult[];
}

export interface DeepSeekTransport {
  stream(
    request: DeepSeekTransportRequest,
    signal: AbortSignal,
  ): AsyncIterable<ModelStreamEvent>;
}
