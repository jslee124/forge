import type {
  ProviderApi,
  ProviderModelProfile,
  ReasoningEffort,
} from "@forge/config";
import {
  conservativeRequestEstimate,
  type ModelAdapter,
  type ModelContextCapabilities,
  type ModelContinuation,
  type ModelRequest,
  type ModelStreamEvent,
  sha256,
} from "@forge/core";

import type { CompatTransport } from "./transport.js";

/**
 * Context capacity assumed for a model the route does not size. A gateway
 * cannot be interrogated for a window, and the two wrong answers do not cost
 * the same: overstating invites a mid-turn provider rejection after the
 * request is built, while understating only compacts earlier than necessary.
 */
export const DEFAULT_COMPAT_CONTEXT_WINDOW = 131_072;

/** Output capacity assumed for a model the route does not size. */
export const DEFAULT_COMPAT_MAX_OUTPUT_TOKENS = 8_192;

export interface CompatModelAdapterOptions {
  readonly apiKey: string;
  readonly route: string;
  readonly api: ProviderApi;
  readonly baseUrl: string;
  readonly model: string;
  readonly reasoningEffort: ReasoningEffort;
  readonly profile?: ProviderModelProfile;
  readonly transport: CompatTransport;
}

/**
 * Resolve a Forge reasoning gear to the wire value this model declares for it.
 *
 * A model that declares no gears, declares itself non-reasoning, or does not
 * offer the selected gear sends no reasoning parameter. A gear mapped to null
 * is offered but spelled as the parameter's absence, which is how most
 * endpoints express not thinking.
 */
export function resolveReasoningWireValue(
  gear: ReasoningEffort,
  profile?: ProviderModelProfile,
): string | undefined {
  const gears = profile?.reasoningGears;
  if (gears === undefined || gears === false) return undefined;
  if (!Object.hasOwn(gears, gear)) return undefined;
  const wire = gears[gear];
  if (wire === null || wire === undefined || wire === "") return undefined;
  return wire;
}

export class CompatModelAdapter implements ModelAdapter {
  readonly context: ModelContextCapabilities;
  readonly #options: CompatModelAdapterOptions;
  readonly #reasoningWireValue: string | undefined;

  constructor(options: CompatModelAdapterOptions) {
    this.#options = options;
    this.#reasoningWireValue = resolveReasoningWireValue(
      options.reasoningEffort,
      options.profile,
    );
    const sized =
      options.profile?.contextWindow !== undefined ||
      options.profile?.maxOutputTokens !== undefined;
    this.context = {
      provider: options.route,
      modelId: options.model,
      contextWindowTokens:
        options.profile?.contextWindow ?? DEFAULT_COMPAT_CONTEXT_WINDOW,
      // A configured size is a declaration by the user; anything else is
      // Forge's fallback and is reported as such.
      contextWindowSource: sized ? "adapter-table" : "configured-fallback",
      maxOutputTokens:
        options.profile?.maxOutputTokens ?? DEFAULT_COMPAT_MAX_OUTPUT_TOKENS,
      nativeCompaction: "unsupported",
      continuationProjection: "adapter-owned",
      estimateRequestTokens: async (request) =>
        conservativeRequestEstimate(request),
      isContextOverflow: (error) =>
        error instanceof Error &&
        /context.{0,20}(length|window|limit)|maximum context|too many tokens|reduce the length/iu.test(
          error.message,
        ),
      projectContinuation: async (continuation, targetTokens) => {
        if (continuation.provider !== options.route) return undefined;
        return projectToolResults(continuation, targetTokens);
      },
    };
  }

  stream(
    request: ModelRequest,
    signal: AbortSignal,
  ): AsyncIterable<ModelStreamEvent> {
    return this.#options.transport.stream(
      {
        apiKey: this.#options.apiKey,
        route: this.#options.route,
        api: this.#options.api,
        baseUrl: this.#options.baseUrl,
        model: this.#options.model,
        ...(this.#reasoningWireValue === undefined
          ? {}
          : { reasoningEffort: this.#reasoningWireValue }),
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
  continuation: ModelContinuation,
  targetTokens: number,
): ModelContinuation | undefined {
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
  void targetTokens;
  return { provider: continuation.provider, data: { messages } };
}
