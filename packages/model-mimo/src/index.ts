import { AuthenticationManager } from "@forge/auth";
import type { ModelAdapter } from "@forge/core";

import { MiMoModelAdapter } from "./adapter.js";
import { AiSdkMiMoTransport } from "./ai-sdk-transport.js";
import type { MiMoTransport } from "./transport.js";

export const DEFAULT_MIMO_MODEL = "mimo-v2.5";
export const DEFAULT_MIMO_BASE_URL = "https://api.xiaomimimo.com/v1";
export type MiMoReasoningEffort = "none" | "low" | "medium" | "high";

export interface CreateMiMoModelAdapterOptions {
  readonly env: NodeJS.ProcessEnv;
  readonly model?: string;
  readonly reasoningEffort?: MiMoReasoningEffort;
  readonly transport?: MiMoTransport;
}

export function createMiMoModelAdapter(
  options: CreateMiMoModelAdapterOptions,
): ModelAdapter {
  const authentication = new AuthenticationManager(options.env).requireApiKey(
    "mimo",
  );
  return new MiMoModelAdapter({
    apiKey: authentication.apiKey,
    baseURL: resolveMiMoBaseURL(options.env),
    transport: options.transport ?? new AiSdkMiMoTransport(),
    ...(options.model ? { model: options.model } : {}),
    ...(options.reasoningEffort
      ? { reasoningEffort: options.reasoningEffort }
      : {}),
  });
}

export function resolveMiMoBaseURL(env: NodeJS.ProcessEnv): string {
  const configured =
    (env as { MIMO_BASE_URL?: string }).MIMO_BASE_URL?.trim() ||
    DEFAULT_MIMO_BASE_URL;
  return configured.replace(/\/+$/u, "");
}

export { MiMoModelAdapter, miMoModelContext } from "./adapter.js";
export { AiSdkMiMoTransport, mapMiMoError } from "./ai-sdk-transport.js";
export type { MiMoTransport, MiMoTransportRequest } from "./transport.js";
