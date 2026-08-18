import type { ModelAdapter, ModelRequest, ModelStreamEvent } from "@forge/core";

import { DEFAULT_DEEPSEEK_MODEL, type DeepSeekThinkingMode } from "./config.js";
import type { DeepSeekTransport } from "./transport.js";

export interface DeepSeekModelAdapterOptions {
  readonly apiKey: string;
  readonly model?: string;
  readonly thinking?: DeepSeekThinkingMode;
  readonly transport: DeepSeekTransport;
}

export class DeepSeekModelAdapter implements ModelAdapter {
  readonly #apiKey: string;
  readonly #model: string;
  readonly #thinking: DeepSeekThinkingMode;
  readonly #transport: DeepSeekTransport;

  constructor(options: DeepSeekModelAdapterOptions) {
    this.#apiKey = options.apiKey;
    this.#model = options.model ?? DEFAULT_DEEPSEEK_MODEL;
    this.#thinking = options.thinking ?? "enabled";
    this.#transport = options.transport;
  }

  stream(
    request: ModelRequest,
    signal: AbortSignal,
  ): AsyncIterable<ModelStreamEvent> {
    return this.#transport.stream(
      {
        apiKey: this.#apiKey,
        model: this.#model,
        thinking: this.#thinking,
        prompt: request.prompt,
        ...(request.tools ? { tools: request.tools } : {}),
        ...(request.continuation ? { continuation: request.continuation } : {}),
        ...(request.toolResults ? { toolResults: request.toolResults } : {}),
      },
      signal,
    );
  }
}
