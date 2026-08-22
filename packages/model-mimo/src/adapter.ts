import {
  conservativeRequestEstimate,
  type ModelAdapter,
  ModelConfigurationError,
  type ModelContextCapabilities,
  type ModelRequest,
  type ModelStreamEvent,
  sha256,
} from "@forge/core";

import { DEFAULT_MIMO_MODEL, type MiMoReasoningEffort } from "./index.js";
import type { MiMoTransport } from "./transport.js";

export interface MiMoModelAdapterOptions {
  readonly apiKey: string;
  readonly baseURL: string;
  readonly model?: string;
  readonly reasoningEffort?: MiMoReasoningEffort;
  readonly transport: MiMoTransport;
}

export class MiMoModelAdapter implements ModelAdapter {
  readonly context: ModelContextCapabilities;
  readonly #apiKey: string;
  readonly #baseURL: string;
  readonly #model: string;
  readonly #reasoningEffort: MiMoReasoningEffort;
  readonly #transport: MiMoTransport;

  constructor(options: MiMoModelAdapterOptions) {
    this.#apiKey = options.apiKey;
    this.#baseURL = options.baseURL;
    this.#model = options.model ?? DEFAULT_MIMO_MODEL;
    this.#reasoningEffort = options.reasoningEffort ?? "medium";
    this.#transport = options.transport;
    const modelContext = miMoModelContext(this.#model);
    this.context = {
      provider: "mimo",
      modelId: this.#model,
      contextWindowTokens: modelContext?.window ?? 32_768,
      contextWindowSource: modelContext
        ? "adapter-table"
        : "configured-fallback",
      maxOutputTokens: modelContext?.output ?? 4_096,
      nativeCompaction: "unsupported",
      continuationProjection: "adapter-owned",
      estimateRequestTokens: async (request) =>
        conservativeRequestEstimate(request),
      isContextOverflow: (error) =>
        error instanceof Error &&
        /context.{0,20}(length|window|limit)|maximum context|too many tokens/iu.test(
          error.message,
        ),
      projectContinuation: async (continuation, targetTokens) => {
        if (continuation.provider !== "mimo") return undefined;
        return projectToolResults(continuation, targetTokens);
      },
    };
  }

  stream(
    request: ModelRequest,
    signal: AbortSignal,
  ): AsyncIterable<ModelStreamEvent> {
    if (request.images?.length && this.#model !== "mimo-v2.5") {
      throw new ModelConfigurationError(
        "MiMo image attachments require model mimo-v2.5.",
      );
    }
    return this.#transport.stream(
      {
        apiKey: this.#apiKey,
        baseURL: this.#baseURL,
        model: this.#model,
        reasoningEffort: this.#reasoningEffort,
        prompt: request.prompt,
        ...(request.images?.length ? { images: request.images } : {}),
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

export function miMoModelContext(
  model: string,
): { readonly window: number; readonly output: number } | undefined {
  if (model === "mimo-v2.5" || model === "mimo-v2.5-pro") {
    return { window: 1_048_576, output: 131_072 };
  }
  return undefined;
}

function projectToolResults(
  continuation: import("@forge/core").ModelContinuation,
  targetTokens: number,
): import("@forge/core").ModelContinuation | undefined {
  const data = continuation.data;
  if (
    typeof data !== "object" ||
    data === null ||
    !("messages" in data) ||
    !Array.isArray(data.messages)
  ) {
    return undefined;
  }
  const messages = data.messages.map((message: unknown) => {
    if (
      typeof message !== "object" ||
      message === null ||
      !("role" in message) ||
      message.role !== "tool" ||
      !("content" in message) ||
      !Array.isArray(message.content)
    ) {
      return message;
    }
    return {
      ...message,
      content: message.content.map((item: unknown) => {
        if (typeof item !== "object" || item === null) return item;
        const record = item as Record<string, unknown>;
        const { output, toolName } = record;
        const serialized = JSON.stringify(output ?? null);
        return {
          ...record,
          output: {
            type: "text",
            value: `[Forge projected completed tool result; tool=${String(toolName ?? "unknown")}; sha256=${sha256(serialized)}; excerpt=${JSON.stringify(serialized.slice(0, 160))}]`,
          },
        };
      }),
    };
  });
  void targetTokens;
  return { provider: continuation.provider, data: { messages } };
}
