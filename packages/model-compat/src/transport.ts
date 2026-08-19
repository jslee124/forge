import type { ProviderApi } from "@forge/config";
import type {
  ModelContinuation,
  ModelConversationMessage,
  ModelStreamEvent,
  ModelToolDefinition,
  ModelToolResult,
} from "@forge/core";

export interface CompatTransportRequest {
  readonly apiKey: string;
  /** Route key, used for continuation tagging and error attribution. */
  readonly route: string;
  readonly api: ProviderApi;
  readonly baseUrl: string;
  readonly model: string;
  /**
   * Wire value for the selected reasoning gear, or undefined to send no
   * reasoning parameter at all. Resolution from gear to wire value happens in
   * the adapter, so the transport never interprets Forge's gear names.
   */
  readonly reasoningEffort?: string;
  readonly prompt: string;
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
