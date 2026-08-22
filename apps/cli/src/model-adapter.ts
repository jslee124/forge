import type { ModelAdapter } from "@forge/core";
import { ModelConfigurationError } from "@forge/core";
import {
  createDeepSeekModelAdapter,
  type DeepSeekReasoningEffort,
  type DeepSeekThinkingMode,
} from "@forge/model-deepseek";
import {
  createMiMoModelAdapter,
  type MiMoReasoningEffort,
} from "@forge/model-mimo";
import {
  createOpenAIModelAdapter,
  type OpenAIReasoningEffort,
} from "@forge/model-openai";

export interface CreateForgeModelAdapterOptions {
  readonly env: NodeJS.ProcessEnv;
  readonly provider: "deepseek" | "mimo" | "openai";
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
  if (options.provider === "mimo") {
    if (
      options.reasoningEffort !== "none" &&
      options.reasoningEffort !== "low" &&
      options.reasoningEffort !== "medium" &&
      options.reasoningEffort !== "high"
    ) {
      throw new ModelConfigurationError(
        `MiMo reasoning effort "${options.reasoningEffort}" is not supported. Use none, low, medium, or high.`,
      );
    }
    return createMiMoModelAdapter({
      env: options.env,
      model: options.model,
      reasoningEffort: options.reasoningEffort satisfies MiMoReasoningEffort,
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
