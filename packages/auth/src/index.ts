import { ModelConfigurationError } from "@forge/core";

export type ApiKeyProvider = "deepseek" | "openai";

export interface ApiKeyAuthentication {
  readonly kind: "api-key";
  readonly provider: ApiKeyProvider;
  readonly apiKey: string;
  readonly source: "environment";
  readonly environmentVariable: string;
}

export interface AuthenticationStatus {
  readonly provider: ApiKeyProvider;
  readonly method: "api-key";
  readonly authenticated: boolean;
  readonly source?: "environment";
  readonly environmentVariable: string;
}

const API_KEY_ENVIRONMENT_VARIABLES = {
  deepseek: "DEEPSEEK_API_KEY",
  openai: "OPENAI_API_KEY",
} as const satisfies Record<ApiKeyProvider, string>;

/** Resolves ordinary API credentials without ever persisting them. */
export class AuthenticationManager {
  readonly #env: NodeJS.ProcessEnv;

  constructor(env: NodeJS.ProcessEnv = process.env) {
    this.#env = env;
  }

  status(provider: ApiKeyProvider): AuthenticationStatus {
    const environmentVariable = API_KEY_ENVIRONMENT_VARIABLES[provider];
    const authenticated = Boolean(this.#env[environmentVariable]?.trim());
    return {
      provider,
      method: "api-key",
      authenticated,
      ...(authenticated ? { source: "environment" as const } : {}),
      environmentVariable,
    };
  }

  requireApiKey(provider: ApiKeyProvider): ApiKeyAuthentication {
    const status = this.status(provider);
    const apiKey = this.#env[status.environmentVariable]?.trim();
    if (!apiKey) {
      const distinction =
        provider === "openai"
          ? " ChatGPT subscriptions do not include OpenAI API usage; use `forge codex` for subscription access."
          : "";
      throw new ModelConfigurationError(
        `Missing ${status.environmentVariable}. Export an API key before using the ${provider} API provider.${distinction}`,
      );
    }
    return {
      kind: "api-key",
      provider,
      apiKey,
      source: "environment",
      environmentVariable: status.environmentVariable,
    };
  }
}

export function isApiKeyProvider(value: string): value is ApiKeyProvider {
  return value === "deepseek" || value === "openai";
}
