import type { ModelAdapter } from "@forge/core";

import { DeepSeekModelAdapter } from "./adapter.js";
import { AiSdkDeepSeekTransport } from "./ai-sdk-transport.js";
import {
  type DeepSeekEnvironment,
  type DeepSeekThinkingMode,
  resolveDeepSeekApiKey,
} from "./config.js";
import type { DeepSeekTransport } from "./transport.js";

export interface CreateDeepSeekModelAdapterOptions {
  readonly env: DeepSeekEnvironment;
  readonly model?: string;
  readonly thinking?: DeepSeekThinkingMode;
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
  });
}

export { DeepSeekModelAdapter } from "./adapter.js";
export {
  AiSdkDeepSeekTransport,
  mapDeepSeekError,
} from "./ai-sdk-transport.js";
export {
  DEFAULT_DEEPSEEK_MODEL,
  type DeepSeekEnvironment,
  type DeepSeekThinkingMode,
  resolveDeepSeekApiKey,
} from "./config.js";
export type {
  DeepSeekTransport,
  DeepSeekTransportRequest,
} from "./transport.js";
