import type { ProviderProfile } from "@forge/config";
import type { ModelAdapter } from "@forge/core";
import { ModelConfigurationError } from "@forge/core";
import { createCompatModelAdapter } from "@forge/model-compat";
import {
  createDeepSeekModelAdapter,
  type DeepSeekReasoningEffort,
  type DeepSeekThinkingMode,
} from "@forge/model-deepseek";
import {
  createOpenAIModelAdapter,
  type OpenAIReasoningEffort,
} from "@forge/model-openai";

export interface CreateForgeModelAdapterOptions {
  readonly env: NodeJS.ProcessEnv;
  readonly provider: string;
  readonly model: string;
  readonly thinking: DeepSeekThinkingMode;
  readonly reasoningEffort: OpenAIReasoningEffort | "ultra";
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
    if (options.reasoningEffort === "ultra") {
      throw new ModelConfigurationError(
        'DeepSeek reasoning effort "ultra" is not supported. Use none, minimal, low, medium, high, xhigh, or max.',
      );
    }
    return createDeepSeekModelAdapter({
      env: options.env,
      model: options.model,
      thinking: options.thinking,
      reasoningEffort:
        options.reasoningEffort satisfies DeepSeekReasoningEffort,
    });
  }
  const profile = options.providers?.[options.provider];
  if (profile === undefined) {
    throw new ModelConfigurationError(
      `Unknown provider "${options.provider}". Configure it under providers in the user configuration.`,
    );
  }
  return createCompatModelAdapter({
    env: options.env,
    route: options.provider,
    profile,
    model: options.model,
    reasoningEffort: options.reasoningEffort,
  });
}
