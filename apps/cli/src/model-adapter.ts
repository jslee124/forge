import type { ModelAdapter } from "@forge/core";
import { ModelConfigurationError } from "@forge/core";
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
  readonly provider: "deepseek" | "openai";
  readonly model: string;
  readonly thinking: DeepSeekThinkingMode;
  readonly reasoningEffort: OpenAIReasoningEffort | "ultra";
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
  if (options.reasoningEffort === "ultra") {
    throw new ModelConfigurationError(
      'DeepSeek reasoning effort "ultra" is not supported. Use none, minimal, low, medium, high, xhigh, or max.',
    );
  }
  return createDeepSeekModelAdapter({
    env: options.env,
    model: options.model,
    thinking: options.thinking,
    reasoningEffort: options.reasoningEffort satisfies DeepSeekReasoningEffort,
  });
}
