import {
  conservativeRequestEstimate,
  type ModelAdapter,
  ModelConfigurationError,
  type ModelContextCapabilities,
  type ModelRequest,
  type ModelStreamEvent,
  sha256,
} from "@forge/core";

import {
  DEFAULT_DEEPSEEK_MODEL,
  type DeepSeekReasoningEffort,
  type DeepSeekThinkingMode,
} from "./config.js";
import type { DeepSeekTransport } from "./transport.js";

export interface DeepSeekModelAdapterOptions {
  readonly apiKey: string;
  readonly model?: string;
  readonly thinking?: DeepSeekThinkingMode;
  readonly reasoningEffort?: DeepSeekReasoningEffort;
  readonly transport: DeepSeekTransport;
}

export class DeepSeekModelAdapter implements ModelAdapter {
  readonly context: ModelContextCapabilities;
  readonly #apiKey: string;
  readonly #model: string;
  readonly #thinking: DeepSeekThinkingMode;
  readonly #reasoningEffort: DeepSeekReasoningEffort;
  readonly #transport: DeepSeekTransport;

  constructor(options: DeepSeekModelAdapterOptions) {
    this.#apiKey = options.apiKey;
    this.#model = options.model ?? DEFAULT_DEEPSEEK_MODEL;
    this.#thinking = options.thinking ?? "enabled";
    this.#reasoningEffort = options.reasoningEffort ?? "high";
    this.#transport = options.transport;
    const modelContext = deepSeekModelContext(this.#model);
    this.context = {
      provider: "deepseek",
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
        if (continuation.provider !== "deepseek") return undefined;
        return projectToolResults(continuation, targetTokens);
      },
    };
  }

  stream(
    request: ModelRequest,
    signal: AbortSignal,
  ): AsyncIterable<ModelStreamEvent> {
    if (
      request.images?.length &&
      this.#model !== "deepseek-v4-flash-vision-exp"
    ) {
      throw new ModelConfigurationError(
        `DeepSeek model "${this.#model}" does not accept image input. Select deepseek-v4-flash-vision-exp.`,
      );
    }
    return this.#transport.stream(
      {
        apiKey: this.#apiKey,
        model: this.#model,
        thinking: this.#thinking,
        reasoningEffort:
          this.#thinking === "disabled" ? "none" : this.#reasoningEffort,
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

export function deepSeekModelContext(
  model: string,
): { readonly window: number; readonly output: number } | undefined {
  if (
    model === "deepseek-v4-flash" ||
    model === "deepseek-v4-pro" ||
    model === "deepseek-v4-flash-vision-exp"
  ) {
    return { window: 1_048_576, output: 393_216 };
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
        const success = /"ok":true/u.test(serialized)
          ? "true"
          : /"ok":false/u.test(serialized)
            ? "false"
            : "unknown";
        const truncated = /"truncated":true/u.test(serialized);
        return {
          ...record,
          output: {
            type: "text",
            value: `[Forge projected completed tool result; tool=${String(toolName ?? "unknown")}; success=${success}; truncated=${truncated}; sha256=${sha256(serialized)}; excerpt=${JSON.stringify(serialized.slice(0, 160))}]`,
          },
        };
      }),
    };
  });
  const projected = { provider: continuation.provider, data: { messages } };
  void targetTokens;
  return projected;
}
