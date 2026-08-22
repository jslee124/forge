import type { ProviderApi, ProviderModelProfile } from "@forge/config";
import {
  conservativeRequestEstimate,
  type ModelAdapter,
  type ModelContextCapabilities,
  type ModelRequest,
  type ModelStreamEvent,
} from "@forge/core";

import type { CompatTransport } from "./transport.js";

export const DEFAULT_COMPAT_CONTEXT_WINDOW = 32_768;
export const DEFAULT_COMPAT_MAX_OUTPUT_TOKENS = 4_096;

export interface CompatModelAdapterOptions {
  readonly apiKey?: string;
  readonly route: string;
  readonly api: ProviderApi;
  readonly baseUrl: string;
  readonly model: string;
  readonly reasoningEffort: string;
  readonly profile?: ProviderModelProfile;
  readonly transport: CompatTransport;
}

export function resolveReasoningWireValue(
  gear: string,
  profile?: ProviderModelProfile,
): string | undefined {
  const gears = profile?.reasoningGears;
  if (gears === undefined || gears === false || !Object.hasOwn(gears, gear)) {
    return undefined;
  }
  const wire = gears[gear as keyof typeof gears];
  // Version 1 provider setup historically stored `none: null`. Treat a null
  // mapping as the canonical wire value so "none" cannot silently become
  // "use the provider default". New configurations always store strings.
  return wire === null
    ? gear
    : wire === undefined || wire === ""
      ? undefined
      : wire;
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
      contextWindowSource: sized ? "adapter-table" : "configured-fallback",
      maxOutputTokens:
        options.profile?.maxOutputTokens ?? DEFAULT_COMPAT_MAX_OUTPUT_TOKENS,
      nativeCompaction: "unsupported",
      continuationProjection: "unsupported",
      estimateRequestTokens: async (request) =>
        conservativeRequestEstimate(request),
      isContextOverflow: (error) =>
        error instanceof Error &&
        /context.{0,20}(length|window|limit)|maximum context|too many tokens|reduce the length/iu.test(
          error.message,
        ),
    };
  }

  stream(
    request: ModelRequest,
    signal: AbortSignal,
  ): AsyncIterable<ModelStreamEvent> {
    return this.#options.transport.stream(
      {
        ...(this.#options.apiKey === undefined
          ? {}
          : { apiKey: this.#options.apiKey }),
        route: this.#options.route,
        api: this.#options.api,
        baseUrl: this.#options.baseUrl,
        model: this.#options.model,
        ...(this.#reasoningWireValue === undefined
          ? {}
          : { reasoningEffort: this.#reasoningWireValue }),
        prompt: request.prompt,
        ...(request.images ? { images: request.images } : {}),
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
