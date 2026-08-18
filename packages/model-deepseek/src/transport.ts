import type { ModelStreamEvent } from "@forge/core";

import type { DeepSeekThinkingMode } from "./config.js";

export interface DeepSeekTransportRequest {
  readonly apiKey: string;
  readonly model: string;
  readonly thinking: DeepSeekThinkingMode;
  readonly prompt: string;
}

export interface DeepSeekTransport {
  stream(
    request: DeepSeekTransportRequest,
    signal: AbortSignal,
  ): AsyncIterable<ModelStreamEvent>;
}
