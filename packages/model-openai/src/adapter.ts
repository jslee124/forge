import {
  conservativeRequestEstimate,
  type ModelAdapter,
  type ModelContextCapabilities,
  type ModelRequest,
  type ModelStreamEvent,
  sha256,
} from "@forge/core";

import { DEFAULT_OPENAI_MODEL, type OpenAIReasoningEffort } from "./index.js";
import type { OpenAITransport } from "./transport.js";

export interface OpenAIModelAdapterOptions {
  readonly apiKey: string;
  readonly model?: string;
  readonly reasoningEffort?: OpenAIReasoningEffort;
  readonly transport: OpenAITransport;
}

export class OpenAIModelAdapter implements ModelAdapter {
  readonly context: ModelContextCapabilities;
  readonly promptCache = { mode: "automatic" as const };
  readonly #apiKey: string;
  readonly #model: string;
  readonly #reasoningEffort: OpenAIReasoningEffort;
  readonly #transport: OpenAITransport;

  constructor(options: OpenAIModelAdapterOptions) {
    this.#apiKey = options.apiKey;
    this.#model = options.model ?? DEFAULT_OPENAI_MODEL;
    this.#reasoningEffort = options.reasoningEffort ?? "medium";
    this.#transport = options.transport;
    const modelContext = openAIModelContext(this.#model);
    this.context = {
      provider: "openai",
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
        if (continuation.provider !== "openai") return undefined;
        return projectToolResults(continuation, targetTokens);
      },
    };
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

export function openAIModelContext(
  model: string,
): { readonly window: number; readonly output: number } | undefined {
  if (/^gpt-5\.4-(mini|nano)(?:-|$)/u.test(model)) {
    return { window: 400_000, output: 128_000 };
  }
  if (/^gpt-5\.(?:4|5|6)(?:-|$)/u.test(model)) {
    return { window: 1_050_000, output: 128_000 };
  }
  if (/^gpt-5(?:-|$)/u.test(model)) {
    return { window: 400_000, output: 128_000 };
  }
  return undefined;
}
