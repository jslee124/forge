import type {
  ModelContinuation,
  ModelConversationMessage,
  ModelStreamEvent,
  ModelToolDefinition,
  ModelToolResult,
} from "@forge/core";

import type { DeepSeekThinkingMode } from "./config.js";

export interface DeepSeekTransportRequest {
  readonly apiKey: string;
  readonly model: string;
  readonly thinking: DeepSeekThinkingMode;
  readonly prompt: string;
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
