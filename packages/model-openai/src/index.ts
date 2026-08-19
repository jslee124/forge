import { AuthenticationManager } from "@forge/auth";
import type { ModelAdapter } from "@forge/core";

import { OpenAIModelAdapter } from "./adapter.js";
import { AiSdkOpenAITransport } from "./ai-sdk-transport.js";
import type { OpenAITransport } from "./transport.js";

export const DEFAULT_OPENAI_MODEL = "gpt-5.4-mini";
export type OpenAIReasoningEffort =
  | "none"
  | "minimal"
  | "low"
  | "medium"
  | "high"
  | "xhigh"
  | "max";

export interface CreateOpenAIModelAdapterOptions {
  readonly env: NodeJS.ProcessEnv;
  readonly model?: string;
  readonly reasoningEffort?: OpenAIReasoningEffort;
  readonly transport?: OpenAITransport;
}

export function createOpenAIModelAdapter(
  options: CreateOpenAIModelAdapterOptions,
): ModelAdapter {
  const authentication = new AuthenticationManager(options.env).requireApiKey(
    "openai",
  );
  return new OpenAIModelAdapter({
    apiKey: authentication.apiKey,
    transport: options.transport ?? new AiSdkOpenAITransport(),
    ...(options.model ? { model: options.model } : {}),
    ...(options.reasoningEffort
      ? { reasoningEffort: options.reasoningEffort }
      : {}),
  });
}

export { OpenAIModelAdapter } from "./adapter.js";
export { AiSdkOpenAITransport, mapOpenAIError } from "./ai-sdk-transport.js";
export type {
  OpenAITransport,
  OpenAITransportRequest,
} from "./transport.js";
