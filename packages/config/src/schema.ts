import { z } from "zod";

import {
  PROVIDER_APIS,
  ProviderEndpointError,
  parseProviderBaseUrl,
  RESERVED_PROVIDER_ROUTES,
} from "./providers.js";

export const permissionProfileSchema = z.enum(["safe", "workspace-write"]);
export type PermissionProfile = z.infer<typeof permissionProfileSchema>;

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

export type ReasoningEffort = z.infer<typeof reasoningEffortSchema>;

const modelSchema = z
  .object({
    engine: z.enum(["forge", "codex"]).optional(),
    // A third-party route is selected by its `providers` key, which the route
    // name rules keep from colliding with the built-in provider names.
    provider: z.string().trim().min(1).optional(),
    id: z.string().trim().min(1).optional(),
    reasoningEffort: reasoningEffortSchema.optional(),
    thinking: z.enum(["enabled", "disabled"]).optional(),
  })
  .strict();

/**
 * Selectable reasoning gears for one model: each key is a gear the model
 * offers and its value is the wire spelling dispatch sends for it. A null
 * value means "offered, but send no reasoning parameter", which is how most
 * endpoints spell not thinking. A gear absent from the object is not offered.
 */
const reasoningGearsSchema = z.partialRecord(
  reasoningEffortSchema,
  z.string().trim().nullable(),
);

const providerModelSchema = z
  .object({
    id: z.string().trim().min(1),
    name: z.string().trim().min(1).optional(),
    contextWindow: z.number().int().positive().max(20_000_000).optional(),
    maxOutputTokens: z.number().int().positive().max(2_000_000).optional(),
    /**
     * `false` declares a model that does not reason; an object declares the
     * offered gears. Absent leaves reasoning support unknown, and no reasoning
     * parameter is sent.
     */
    reasoningGears: z
      .union([z.literal(false), reasoningGearsSchema])
      .optional(),
  })
  .strict();

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
    /**
     * Environment variable consulted for this route's key. It takes precedence
     * over the stored credential, matching how the built-in providers treat
     * `DEEPSEEK_API_KEY` and `OPENAI_API_KEY`.
     */
    apiKeyEnv: z
      .string()
      .regex(/^[A-Z][A-Z0-9_]{0,63}$/u)
      .optional(),
    models: z.array(providerModelSchema).max(256).optional(),
  })
  .strict();

const providersSchema = z
  .record(z.string().regex(/^[a-z][a-z0-9-]{0,63}$/u), providerSchema)
  // Reserved names and the route ceiling are checked here rather than on the
  // key schema, because a rejected record key reports only "invalid key in
  // record" and discards the reason.
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

const contextSchema = z
  .object({
    mode: z.enum(["off", "warn", "compact"]).optional(),
    reservedOutputTokens: z.number().int().positive().max(2_000_000).optional(),
    bufferTokens: z.number().int().positive().max(2_000_000).optional(),
    recentTailTokens: z.number().int().nonnegative().max(2_000_000).optional(),
    summaryTargetTokens: z.number().int().min(64).max(2_000_000).optional(),
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
    context: contextSchema.optional(),
    providers: providersSchema.optional(),
  })
  .strict();

export type ForgeConfigFile = z.infer<typeof forgeConfigFileSchema>;

export interface EffectiveForgeConfig {
  readonly schemaVersion: 1;
  readonly model: {
    readonly engine: "forge" | "codex";
    /** A built-in provider name, or a configured third-party route key. */
    readonly provider: string;
    readonly id: string;
    readonly reasoningEffort: ReasoningEffort;
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
  readonly context: {
    readonly mode: "off" | "warn" | "compact";
    readonly reservedOutputTokens: number;
    readonly bufferTokens: number;
    readonly recentTailTokens: number;
    readonly summaryTargetTokens: number;
  };
  /** Configured third-party routes, keyed by route name. */
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
  context: {
    mode: "warn",
    reservedOutputTokens: 4_096,
    bufferTokens: 8_192,
    recentTailTokens: 12_000,
    summaryTargetTokens: 1_200,
  },
  providers: {},
};
