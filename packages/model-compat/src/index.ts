import { AuthenticationManager } from "@forge/auth";
import { type ProviderProfile, parseProviderBaseUrl } from "@forge/config";
import { type ModelAdapter, ModelConfigurationError } from "@forge/core";

import { CompatModelAdapter } from "./adapter.js";
import { AiSdkCompatTransport } from "./ai-sdk-transport.js";
import type { CompatTransport } from "./transport.js";

export interface CreateCompatModelAdapterOptions {
  readonly env: NodeJS.ProcessEnv;
  readonly route: string;
  readonly profile: ProviderProfile;
  readonly model: string;
  readonly reasoningEffort: string;
  readonly transport?: CompatTransport;
}

export function createCompatModelAdapter(
  options: CreateCompatModelAdapterOptions,
): ModelAdapter {
  const baseUrl = parseProviderBaseUrl(options.profile.baseUrl);
  const profile = options.profile.models?.find(
    (entry) => entry.id === options.model,
  );
  if (options.profile.models?.length && profile === undefined) {
    throw new ModelConfigurationError(
      `Provider route "${options.route}" does not configure model "${options.model}". Choose one of: ${options.profile.models.map((entry) => entry.id).join(", ")}.`,
    );
  }
  const apiKey =
    options.profile.auth.type === "bearer"
      ? new AuthenticationManager(options.env).requireApiKey(options.route, {
          endpoint: baseUrl,
          ...(options.profile.auth.apiKeyEnv
            ? { environmentVariable: options.profile.auth.apiKeyEnv }
            : {}),
        }).apiKey
      : undefined;
  return new CompatModelAdapter({
    ...(apiKey === undefined ? {} : { apiKey }),
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
export {
  canDiscoverModels,
  DISCOVERY_TIMEOUT_MS,
  type DiscoveredModel,
  type DiscoverModelsRequest,
  discoverModels,
  MAX_DISCOVERY_RESPONSE_BYTES,
  ModelDiscoveryError,
  readModelListing,
} from "./discovery.js";
export type { CompatTransport, CompatTransportRequest } from "./transport.js";
