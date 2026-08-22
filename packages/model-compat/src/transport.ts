import type { ProviderApi } from "@forge/config";
import type {
  ModelContinuation,
  ModelConversationMessage,
  ModelImageInput,
  ModelStreamEvent,
  ModelToolDefinition,
  ModelToolResult,
} from "@forge/core";

export interface CompatTransportRequest {
  readonly apiKey?: string;
  readonly route: string;
  readonly api: ProviderApi;
  readonly baseUrl: string;
  readonly model: string;
  readonly reasoningEffort?: string;
  readonly prompt: string;
  readonly images?: readonly ModelImageInput[];
  readonly instructions?: string;
  readonly conversation?: readonly ModelConversationMessage[];
  readonly tools?: readonly ModelToolDefinition[];
  readonly continuation?: ModelContinuation;
  readonly toolResults?: readonly ModelToolResult[];
}

export interface CompatTransport {
  stream(
    request: CompatTransportRequest,
    signal: AbortSignal,
  ): AsyncIterable<ModelStreamEvent>;
}
