import { ModelConfigurationError } from "@forge/core";

export const DEFAULT_DEEPSEEK_MODEL = "deepseek-v4-flash";

export type DeepSeekThinkingMode = "enabled" | "disabled";

export interface DeepSeekEnvironment {
  readonly DEEPSEEK_API_KEY?: string;
}

export function resolveDeepSeekApiKey(env: DeepSeekEnvironment): string {
  const apiKey = env.DEEPSEEK_API_KEY?.trim();

  if (!apiKey) {
    throw new ModelConfigurationError(
      "Missing DEEPSEEK_API_KEY. Export a DeepSeek API key before running a model command.",
    );
  }

  return apiKey;
}
