import type {
  ModelContinuation,
  ModelConversationMessage,
  ModelStreamEvent,
  ModelToolDefinition,
  ModelToolResult,
} from "@forge/core";

import type { OpenAIReasoningEffort } from "./index.js";

export interface OpenAITransportRequest {
  readonly apiKey: string;
  readonly model: string;
  readonly reasoningEffort: OpenAIReasoningEffort;
  readonly prompt: string;
  readonly instructions?: string;
  readonly conversation?: readonly ModelConversationMessage[];
  readonly tools?: readonly ModelToolDefinition[];
  readonly continuation?: ModelContinuation;
  readonly toolResults?: readonly ModelToolResult[];
}

export interface OpenAITransport {
  stream(
    request: OpenAITransportRequest,
    signal: AbortSignal,
  ): AsyncIterable<ModelStreamEvent>;
}
