import { AuthenticationManager } from "@forge/auth";
import {
  type ProviderProfile,
  parseProviderBaseUrl,
  type ReasoningEffort,
} from "@forge/config";
import { type ModelAdapter, ModelConfigurationError } from "@forge/core";

import { CompatModelAdapter } from "./adapter.js";
import { AiSdkCompatTransport } from "./ai-sdk-transport.js";
import type { CompatTransport } from "./transport.js";

export interface CreateCompatModelAdapterOptions {
  readonly env: NodeJS.ProcessEnv;
  /** Route key naming this endpoint in configuration. */
  readonly route: string;
  readonly profile: ProviderProfile;
  readonly model: string;
  readonly reasoningEffort: ReasoningEffort;
  readonly transport?: CompatTransport;
}

/**
 * Build an adapter for one configured third-party route.
 *
 * The endpoint is re-validated here rather than trusted from configuration,
 * because a route can also arrive from a draft the user is still editing.
 */
export function createCompatModelAdapter(
  options: CreateCompatModelAdapterOptions,
): ModelAdapter {
  const baseUrl = parseProviderBaseUrl(options.profile.baseUrl);
  const authentication = new AuthenticationManager(options.env).requireApiKey(
    options.route,
    ...(options.profile.apiKeyEnv === undefined
      ? []
      : [{ environmentVariable: options.profile.apiKeyEnv }]),
  );
  const profile = options.profile.models?.find(
    (entry) => entry.id === options.model,
  );
  if (options.profile.models?.length && profile === undefined) {
    throw new ModelConfigurationError(
      `Provider route "${options.route}" does not configure model "${options.model}". Add it to the route's models, or select one of: ${options.profile.models.map((entry) => entry.id).join(", ")}.`,
    );
  }
  return new CompatModelAdapter({
    apiKey: authentication.apiKey,
    route: options.route,
    api: options.profile.api,
    baseUrl,
    model: options.model,
    reasoningEffort: options.reasoningEffort,
    ...(profile ? { profile } : {}),
    transport: options.transport ?? new AiSdkCompatTransport(),
  });
}

export {
  CompatModelAdapter,
  type CompatModelAdapterOptions,
  DEFAULT_COMPAT_CONTEXT_WINDOW,
  DEFAULT_COMPAT_MAX_OUTPUT_TOKENS,
  resolveReasoningWireValue,
} from "./adapter.js";
export { AiSdkCompatTransport, mapCompatError } from "./ai-sdk-transport.js";
export type { CompatTransport, CompatTransportRequest } from "./transport.js";
