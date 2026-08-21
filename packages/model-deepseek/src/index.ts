import type { ModelAdapter } from "@forge/core";

import { DeepSeekModelAdapter } from "./adapter.js";
import { AiSdkDeepSeekTransport } from "./ai-sdk-transport.js";
import {
  type DeepSeekEnvironment,
  type DeepSeekReasoningEffort,
  type DeepSeekThinkingMode,
  resolveDeepSeekApiKey,
} from "./config.js";
import type { DeepSeekTransport } from "./transport.js";

export interface CreateDeepSeekModelAdapterOptions {
  readonly env: DeepSeekEnvironment;
  readonly model?: string;
  readonly thinking?: DeepSeekThinkingMode;
  readonly reasoningEffort?: DeepSeekReasoningEffort;
  readonly transport?: DeepSeekTransport;
}

export function createDeepSeekModelAdapter(
  options: CreateDeepSeekModelAdapterOptions,
): ModelAdapter {
  return new DeepSeekModelAdapter({
    apiKey: resolveDeepSeekApiKey(options.env),
    transport: options.transport ?? new AiSdkDeepSeekTransport(),
    ...(options.model ? { model: options.model } : {}),
    ...(options.thinking ? { thinking: options.thinking } : {}),
    ...(options.reasoningEffort
      ? { reasoningEffort: options.reasoningEffort }
      : {}),
  });
}

export { DeepSeekModelAdapter, deepSeekModelContext } from "./adapter.js";
export {
  AiSdkDeepSeekTransport,
  mapDeepSeekError,
  toAiSdkTools,
} from "./ai-sdk-transport.js";
export {
  DEFAULT_DEEPSEEK_MODEL,
  type DeepSeekEnvironment,
  type DeepSeekReasoningEffort,
  type DeepSeekThinkingMode,
  resolveDeepSeekApiKey,
} from "./config.js";
export type {
  DeepSeekTransport,
  DeepSeekTransportRequest,
} from "./transport.js";
