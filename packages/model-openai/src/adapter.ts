import type { ModelAdapter, ModelRequest, ModelStreamEvent } from "@forge/core";

import { DEFAULT_OPENAI_MODEL, type OpenAIReasoningEffort } from "./index.js";
import type { OpenAITransport } from "./transport.js";

export interface OpenAIModelAdapterOptions {
  readonly apiKey: string;
  readonly model?: string;
  readonly reasoningEffort?: OpenAIReasoningEffort;
  readonly transport: OpenAITransport;
}

export class OpenAIModelAdapter implements ModelAdapter {
  readonly #apiKey: string;
  readonly #model: string;
  readonly #reasoningEffort: OpenAIReasoningEffort;
  readonly #transport: OpenAITransport;

  constructor(options: OpenAIModelAdapterOptions) {
    this.#apiKey = options.apiKey;
    this.#model = options.model ?? DEFAULT_OPENAI_MODEL;
    this.#reasoningEffort = options.reasoningEffort ?? "medium";
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
        reasoningEffort: this.#reasoningEffort,
        prompt: request.prompt,
        ...(request.instructions ? { instructions: request.instructions } : {}),
        ...(request.conversation ? { conversation: request.conversation } : {}),
        ...(request.tools ? { tools: request.tools } : {}),
        ...(request.continuation ? { continuation: request.continuation } : {}),
        ...(request.toolResults ? { toolResults: request.toolResults } : {}),
      },
      signal,
    );
  }
}
