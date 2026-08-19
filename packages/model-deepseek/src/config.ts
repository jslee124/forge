import { AuthenticationManager } from "@forge/auth";

export const DEFAULT_DEEPSEEK_MODEL = "deepseek-v4-flash";

export type DeepSeekThinkingMode = "enabled" | "disabled";

export interface DeepSeekEnvironment extends NodeJS.ProcessEnv {
  readonly DEEPSEEK_API_KEY?: string;
}

export function resolveDeepSeekApiKey(env: DeepSeekEnvironment): string {
  return new AuthenticationManager(env).requireApiKey("deepseek").apiKey;
}
