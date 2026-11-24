import { BUILTIN_NATIVE_MODELS } from "@forge/application";
import { type ApiKeyProvider, AuthenticationManager } from "@forge/auth";
import type { CodexModel } from "@forge/codex-app-server";
import type { PersistedModelSelection, ProviderProfile } from "@forge/config";
import type { AskOptions } from "../ask.js";

export interface ModelChoice {
  readonly label: string;
  readonly description: string;
  readonly selection: PersistedModelSelection;
  readonly supportedReasoningEfforts: readonly EffortChoice[];
  readonly defaultReasoningEffort: ReasoningEffort;
}

export type ReasoningEffort = NonNullable<
  PersistedModelSelection["reasoningEffort"]
>;

export interface EffortChoice {
  readonly effort: ReasoningEffort;
  readonly description: string;
}

export interface LoginChoice {
  readonly label: string;
  readonly description: string;
  readonly kind:
    | "subscription"
    | "api-key"
    | "provider-route"
    | "configured-provider";
  readonly provider?: ApiKeyProvider;
  readonly route?: string;
  readonly details?: string;
}

export interface LogoutChoice {
  readonly label: string;
  readonly description: string;
  readonly kind: "subscription" | "api-key";
  readonly provider: string;
  readonly environmentVariable?: string;
}

export interface ProviderRouteState {
  readonly ready: boolean;
  readonly label: string;
}

export interface ProviderActionChoice {
  readonly kind: "add-model" | "delete-model" | "logout" | "remove";
  readonly label: string;
  readonly description: string;
}

export const LOGIN_CHOICES: readonly LoginChoice[] = [
  {
    label: "ChatGPT subscription",
    description: "Official Codex sign-in · subscription usage",
    kind: "subscription",
  },
  {
    label: "DeepSeek API",
    description: "Save a DeepSeek API key",
    kind: "api-key",
    provider: "deepseek",
  },
  {
    label: "OpenAI API",
    description: "Save an API key · billed separately from ChatGPT",
    kind: "api-key",
    provider: "openai",
  },
  {
    label: "Add third-party provider",
    description: "OpenAI-compatible endpoint or local server",
    kind: "provider-route",
  },
];

export const STANDARD_EFFORTS: readonly EffortChoice[] = [
  { effort: "none", description: "No reasoning" },
  { effort: "minimal", description: "Fastest" },
  { effort: "low", description: "Fast" },
  { effort: "medium", description: "Balanced" },
  { effort: "high", description: "Deep" },
  { effort: "xhigh", description: "Deeper" },
  { effort: "max", description: "Maximum" },
];

export const MODEL_CHOICES: readonly ModelChoice[] = BUILTIN_NATIVE_MODELS.map(
  (model) => ({
    label: model.label,
    description:
      model.provider === "openai"
        ? "OpenAI API key · separately billed"
        : "DeepSeek API",
    selection: { engine: "forge", provider: model.provider, id: model.id },
    supportedReasoningEfforts: STANDARD_EFFORTS,
    defaultReasoningEffort: model.defaultEffort,
  }),
);

export function providerLoginChoices(
  providers: Readonly<Record<string, ProviderProfile>>,
  statusFor: (route: string, profile: ProviderProfile) => ProviderRouteState,
): readonly LoginChoice[] {
  return [
    ...LOGIN_CHOICES,
    ...Object.entries(providers).map(([route, profile]) => {
      const modelCount = profile.models?.length ?? 0;
      const status = statusFor(route, profile);
      return {
        label: profile.displayName ?? route,
        description: `${status.label} · ${modelCount} ${modelCount === 1 ? "model" : "models"}`,
        details: `${profile.baseUrl} · ${profile.api} · ${profile.auth.type === "bearer" ? "bearer" : "no auth"}`,
        kind: "configured-provider" as const,
        route,
      };
    }),
  ];
}

export function providerActions(
  profile: ProviderProfile,
  status: ProviderRouteState,
): readonly ProviderActionChoice[] {
  return [
    {
      kind: "add-model",
      label: status.ready ? "Add model" : "Log in and add model",
      description: status.ready
        ? "Discover or enter another model"
        : "Save a credential, then discover models",
    },
    ...((profile.models?.length ?? 0) > 0
      ? [
          {
            kind: "delete-model" as const,
            label: "Delete model",
            description: "Remove one configured model",
          },
        ]
      : []),
    ...(profile.auth.type === "bearer" && status.ready
      ? [
          {
            kind: "logout" as const,
            label: "Log out",
            description: "Remove the stored credential",
          },
        ]
      : []),
    {
      kind: "remove",
      label: "Remove provider",
      description: "Delete the route, models, and stored credential",
    },
  ];
}

export function providerCapabilitySummary(profile: ProviderProfile): string {
  const efforts = [
    ...new Set(
      (profile.models ?? []).flatMap((model) =>
        typeof model.reasoningGears === "object"
          ? Object.keys(model.reasoningGears)
          : [],
      ),
    ),
  ];
  return efforts.length > 0
    ? `Declared reasoning: ${efforts.join(", ")} · tools: protocol-supported · agent loop: unverified`
    : "Reasoning controls: provider default · tools: protocol-supported · agent loop: unverified";
}

export function providerModelChoices(
  providers: Readonly<Record<string, ProviderProfile>>,
): readonly ModelChoice[] {
  return Object.entries(providers).flatMap(([route, profile]) =>
    (profile.models ?? []).map((model) => {
      const declared = model.reasoningGears;
      const supported =
        declared === false || declared === undefined
          ? [{ effort: "none" as const, description: "No reasoning" }]
          : STANDARD_EFFORTS.filter(({ effort }) =>
              Object.hasOwn(declared, effort),
            );
      return {
        label: model.name ?? model.id,
        description: `${profile.displayName ?? route} · ${profile.api}`,
        selection: { engine: "forge" as const, provider: route, id: model.id },
        supportedReasoningEfforts:
          supported.length > 0
            ? supported
            : [{ effort: "none" as const, description: "No reasoning" }],
        defaultReasoningEffort:
          supported.find(({ effort }) => effort === "medium")?.effort ??
          supported[0]?.effort ??
          "none",
      };
    }),
  );
}

export function providerLogoutChoices(
  providers: Readonly<Record<string, ProviderProfile>>,
  env: NodeJS.ProcessEnv,
): readonly LogoutChoice[] {
  const authentication = new AuthenticationManager(env);
  const isAuthenticated = (
    provider: string,
    options?: { endpoint?: string; environmentVariable?: string },
  ): boolean => {
    try {
      return authentication.status(provider, options).authenticated;
    } catch {
      return false;
    }
  };
  return [
    {
      label: "ChatGPT subscription",
      description: "Codex account",
      kind: "subscription" as const,
      provider: "openai",
    },
    ...(isAuthenticated("deepseek")
      ? [
          {
            label: "DeepSeek API",
            description: "Stored or environment credential",
            kind: "api-key" as const,
            provider: "deepseek",
          },
        ]
      : []),
    ...(isAuthenticated("openai")
      ? [
          {
            label: "OpenAI API",
            description: "Stored or environment credential",
            kind: "api-key" as const,
            provider: "openai",
          },
        ]
      : []),
    ...Object.entries(providers)
      .filter(
        ([route, profile]) =>
          profile.auth.type === "bearer" &&
          isAuthenticated(route, {
            endpoint: profile.baseUrl,
            ...(profile.auth.apiKeyEnv
              ? { environmentVariable: profile.auth.apiKeyEnv }
              : {}),
          }),
      )
      .map(([route, profile]) => ({
        label: profile.displayName ?? route,
        description: `Provider route · ${route}`,
        kind: "api-key" as const,
        provider: route,
        ...(profile.auth.type === "bearer" && profile.auth.apiKeyEnv
          ? { environmentVariable: profile.auth.apiKeyEnv }
          : {}),
      })),
  ];
}

export function providerRouteState(
  route: string,
  profile: ProviderProfile,
  env: NodeJS.ProcessEnv,
  loggedOut: ReadonlySet<string>,
): ProviderRouteState {
  if (profile.auth.type === "none") return { ready: true, label: "ready" };
  if (loggedOut.has(route)) return { ready: false, label: "signed out" };
  try {
    const status = new AuthenticationManager(env).status(route, {
      endpoint: profile.baseUrl,
      ...(profile.auth.apiKeyEnv
        ? { environmentVariable: profile.auth.apiKeyEnv }
        : {}),
    });
    if (!status.authenticated) return { ready: false, label: "signed out" };
    return {
      ready: true,
      label:
        status.source === "environment"
          ? `ready via ${status.environmentVariable}`
          : "ready",
    };
  } catch {
    return { ready: false, label: "credential unavailable" };
  }
}

export function modelChoiceKey(choice: ModelChoice): string {
  const { selection } = choice;
  return [selection.engine, selection.provider, selection.id].join("\u0000");
}

export function modelChoiceSearchFields(
  choice: ModelChoice,
): readonly string[] {
  const { selection } = choice;
  return [
    choice.label,
    choice.description,
    selection.engine,
    selection.provider,
    selection.id,
  ].filter((value): value is string => value !== undefined);
}

export function asPersistedReasoningEffort(
  value: string,
): PersistedModelSelection["reasoningEffort"] {
  if (
    value === "none" ||
    value === "minimal" ||
    value === "low" ||
    value === "medium" ||
    value === "high" ||
    value === "xhigh" ||
    value === "max" ||
    value === "ultra"
  ) {
    return value;
  }
  return undefined;
}

export function subscriptionModelChoices(
  models: readonly CodexModel[],
): readonly ModelChoice[] {
  return models.flatMap((model) => {
    const supportedReasoningEfforts = model.supportedReasoningEfforts.flatMap(
      ({ reasoningEffort, description }) => {
        const effort = asPersistedReasoningEffort(reasoningEffort);
        return effort ? [{ effort, description }] : [];
      },
    );
    const defaultReasoningEffort = asPersistedReasoningEffort(
      model.defaultReasoningEffort,
    );
    if (!defaultReasoningEffort || supportedReasoningEfforts.length === 0) {
      return [];
    }
    return [
      {
        label: model.displayName,
        description: "ChatGPT subscription · Codex Engine",
        selection: {
          engine: "codex" as const,
          provider: "openai" as const,
          id: model.id,
        },
        supportedReasoningEfforts,
        defaultReasoningEffort,
      },
    ];
  });
}

export function effortsForModel(
  choices: readonly ModelChoice[],
  options: AskOptions,
): readonly EffortChoice[] {
  return (
    modelChoiceFor(choices, options)?.supportedReasoningEfforts ??
    STANDARD_EFFORTS
  );
}

export function modelChoiceFor(
  choices: readonly ModelChoice[],
  options: AskOptions,
): ModelChoice | undefined {
  return choices.find(
    ({ selection }) =>
      selection.engine === options.engine &&
      selection.provider === options.provider &&
      selection.id === options.model,
  );
}
