import type { ProviderProfile } from "@forge/config";
import type { ModelAdapter } from "@forge/core";
import { ModelConfigurationError } from "@forge/core";
import {
  createDeepSeekModelAdapter,
  type DeepSeekThinkingMode,
} from "@forge/model-deepseek";
import {
  createOpenAIModelAdapter,
  type OpenAIReasoningEffort,
} from "@forge/model-openai";

export interface CreateForgeModelAdapterOptions {
  readonly env: NodeJS.ProcessEnv;
  /** A built-in provider name, or a configured third-party route key. */
  readonly provider: string;
  readonly model: string;
  readonly thinking: DeepSeekThinkingMode;
  readonly reasoningEffort: OpenAIReasoningEffort | "ultra";
  /** Configured third-party routes, consulted when provider is not built in. */
  readonly providers?: Readonly<Record<string, ProviderProfile>>;
}

export function createForgeModelAdapter(
  options: CreateForgeModelAdapterOptions,
): ModelAdapter {
  if (options.provider === "openai") {
    if (options.reasoningEffort === "ultra") {
      throw new ModelConfigurationError(
        'OpenAI API reasoning effort "ultra" is not supported by the Responses provider. It may be selected only for a Codex subscription model that advertises it.',
      );
    }
    return createOpenAIModelAdapter({
      env: options.env,
      model: options.model,
      reasoningEffort: options.reasoningEffort,
    });
  }
  if (options.provider === "deepseek") {
    return createDeepSeekModelAdapter({
      env: options.env,
      model: options.model,
      thinking: options.thinking,
    });
  }
  const route = options.providers?.[options.provider];
  if (route === undefined) {
    throw new ModelConfigurationError(
      `Unknown provider "${options.provider}". Use "deepseek", "openai", or a route defined under providers in the user configuration.`,
    );
  }
  throw new ModelConfigurationError(
    `Provider route "${options.provider}" speaks ${route.api}, which this build cannot dispatch yet.`,
  );
}
