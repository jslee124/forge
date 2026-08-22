import type {
  ModelContinuation,
  ModelConversationMessage,
  ModelImageInput,
  ModelStreamEvent,
  ModelToolDefinition,
  ModelToolResult,
} from "@forge/core";

import type { MiMoReasoningEffort } from "./index.js";

export interface MiMoTransportRequest {
  readonly apiKey: string;
  readonly baseURL: string;
  readonly model: string;
  readonly reasoningEffort: MiMoReasoningEffort;
  readonly prompt: string;
  readonly images?: readonly ModelImageInput[];
  readonly instructions?: string;
  readonly conversation?: readonly ModelConversationMessage[];
  readonly tools?: readonly ModelToolDefinition[];
  readonly continuation?: ModelContinuation;
  readonly toolResults?: readonly ModelToolResult[];
}

export interface MiMoTransport {
  stream(
    request: MiMoTransportRequest,
    signal: AbortSignal,
  ): AsyncIterable<ModelStreamEvent>;
}
