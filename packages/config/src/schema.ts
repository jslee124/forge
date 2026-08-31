import { z } from "zod";

import {
  PROVIDER_APIS,
  ProviderEndpointError,
  parseProviderBaseUrl,
  RESERVED_PROVIDER_ROUTES,
} from "./providers.js";

export const permissionProfileSchema = z.enum(["safe", "workspace-write"]);
export type PermissionProfile = z.infer<typeof permissionProfileSchema>;

const modelSchema = z
  .object({
    engine: z.enum(["forge", "codex"]).optional(),
    provider: z.string().trim().min(1).optional(),
    id: z.string().trim().min(1).optional(),
    reasoningEffort: z
      .enum([
        "none",
        "minimal",
        "low",
        "medium",
        "high",
        "xhigh",
        "max",
        "ultra",
      ])
      .optional(),
    thinking: z.enum(["enabled", "disabled"]).optional(),
  })
  .strict();

const reasoningEffortSchema = z.enum([
  "none",
  "minimal",
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
  "ultra",
]);

const reasoningGearsSchema = z.partialRecord(
  reasoningEffortSchema,
  z.string().trim().nullable(),
);

const providerModelSchema = z
  .object({
    id: z.string().trim().min(1).max(512),
    name: z.string().trim().min(1).max(128).optional(),
    contextWindow: z.number().int().positive().max(20_000_000).optional(),
    maxOutputTokens: z.number().int().positive().max(2_000_000).optional(),
    reasoningGears: z
      .union([z.literal(false), reasoningGearsSchema])
      .optional(),
    supportsImages: z.boolean().optional(),
  })
  .strict();

const providerAuthenticationSchema = z.discriminatedUnion("type", [
  z
    .object({
      type: z.literal("bearer"),
      apiKeyEnv: z
        .string()
        .regex(/^[A-Z][A-Z0-9_]{0,63}$/u)
        .optional(),
    })
    .strict(),
  z.object({ type: z.literal("none") }).strict(),
]);

const providerSchema = z
  .object({
    api: z.enum(PROVIDER_APIS),
    baseUrl: z
      .string()
      .trim()
      .min(1)
      .superRefine((value, context) => {
        try {
          parseProviderBaseUrl(value);
        } catch (error) {
          context.addIssue({
            code: "custom",
            message:
              error instanceof ProviderEndpointError
                ? error.message
                : "invalid provider baseUrl",
          });
        }
      }),
    displayName: z.string().trim().min(1).max(64).optional(),
    auth: providerAuthenticationSchema,
    models: z.array(providerModelSchema).max(256).optional(),
  })
  .strict();

const providersSchema = z
  .record(z.string().regex(/^[a-z][a-z0-9-]{0,63}$/u), providerSchema)
  .superRefine((table, context) => {
    for (const route of Object.keys(table)) {
      if (RESERVED_PROVIDER_ROUTES.includes(route)) {
        context.addIssue({
          code: "custom",
          path: [route],
          message: `provider route "${route}" is reserved for a built-in provider or engine`,
        });
      }
    }
    if (Object.keys(table).length > 64) {
      context.addIssue({
        code: "custom",
        message: "at most 64 provider routes may be configured",
      });
    }
  });

export type ProviderProfile = z.infer<typeof providerSchema>;
export type ProviderModelProfile = z.infer<typeof providerModelSchema>;
export type ProviderAuthentication = z.infer<
  typeof providerAuthenticationSchema
>;
export type ReasoningGears = z.infer<typeof reasoningGearsSchema>;

const limitsSchema = z
  .object({
    maxSteps: z.number().int().positive().optional(),
    maxToolCalls: z.number().int().positive().optional(),
    commandTimeoutMs: z.number().int().positive().optional(),
    maxToolOutputBytes: z.number().int().positive().optional(),
  })
  .strict();

const traceSchema = z.object({ enabled: z.boolean().optional() }).strict();
const pluginsSchema = z
  .object({
    enabled: z
      .array(z.string().regex(/^[a-z][a-z0-9-]{0,63}$/u))
      .max(64)
      .optional(),
  })
  .strict();
const resourcesSchema = z
  .object({
    disabledModelInvocation: z
      .array(z.string().regex(/^[a-z0-9][a-z0-9-]{0,63}$/u))
      .max(64)
      .optional(),
  })
  .strict();

const contextModeSchema = z.preprocess(
  (value) =>
    value === "warn" ? "manual" : value === "compact" ? "automatic" : value,
  z.enum(["off", "manual", "automatic"]),
);

const contextSchema = z
  .object({
    mode: contextModeSchema.optional(),
    reservedOutputTokens: z.number().int().positive().max(2_000_000).optional(),
    bufferTokens: z.number().int().positive().max(2_000_000).optional(),
    recentTailTokens: z.number().int().nonnegative().max(2_000_000).optional(),
    summaryTargetTokens: z.number().int().min(64).max(2_000_000).optional(),
    activationThreshold: z.number().min(0.5).max(0.95).optional(),
    minimumReclaimTokens: z
      .number()
      .int()
      .nonnegative()
      .max(2_000_000)
      .optional(),
    minimumReclaimRatio: z.number().min(0).max(0.9).optional(),
  })
  .strict();

export const forgeConfigFileSchema = z
  .object({
    schemaVersion: z.literal(1),
    model: modelSchema.optional(),
    permissionProfile: permissionProfileSchema.optional(),
    limits: limitsSchema.optional(),
    trace: traceSchema.optional(),
    plugins: pluginsSchema.optional(),
    resources: resourcesSchema.optional(),
    context: contextSchema.optional(),
    providers: providersSchema.optional(),
  })
  .strict();

export type ForgeConfigFile = z.infer<typeof forgeConfigFileSchema>;

export interface EffectiveForgeConfig {
  readonly schemaVersion: 1;
  readonly model: {
    readonly engine: "forge" | "codex";
    readonly provider: string;
    readonly id: string;
    readonly reasoningEffort:
      | "none"
      | "minimal"
      | "low"
      | "medium"
      | "high"
      | "xhigh"
      | "max"
      | "ultra";
    readonly thinking: "enabled" | "disabled";
  };
  readonly permissionProfile: PermissionProfile;
  readonly limits: {
    readonly maxSteps: number;
    readonly maxToolCalls: number;
    readonly commandTimeoutMs: number;
    readonly maxToolOutputBytes: number;
  };
  readonly trace: { readonly enabled: boolean };
  readonly plugins: { readonly enabled: readonly string[] };
  readonly resources: { readonly disabledModelInvocation: readonly string[] };
  readonly context: {
    readonly mode: "off" | "manual" | "automatic";
    readonly reservedOutputTokens: number;
    readonly bufferTokens: number;
    readonly recentTailTokens: number;
    readonly summaryTargetTokens: number;
    readonly activationThreshold: number;
    readonly minimumReclaimTokens: number;
    readonly minimumReclaimRatio: number;
  };
  readonly providers: Readonly<Record<string, ProviderProfile>>;
}

export const DEFAULT_FORGE_CONFIG: EffectiveForgeConfig = {
  schemaVersion: 1,
  model: {
    engine: "forge",
    provider: "deepseek",
    id: "deepseek-v4-flash",
    reasoningEffort: "medium",
    thinking: "enabled",
  },
  permissionProfile: "safe",
  limits: {
    maxSteps: 12,
    maxToolCalls: 40,
    commandTimeoutMs: 60_000,
    maxToolOutputBytes: 65_536,
  },
  trace: { enabled: true },
  plugins: { enabled: [] },
  resources: { disabledModelInvocation: [] },
  context: {
    mode: "manual",
    reservedOutputTokens: 4_096,
    bufferTokens: 8_192,
    recentTailTokens: 12_000,
    summaryTargetTokens: 1_200,
    activationThreshold: 0.78,
    minimumReclaimTokens: 8_000,
    minimumReclaimRatio: 0.2,
  },
  providers: {},
};
