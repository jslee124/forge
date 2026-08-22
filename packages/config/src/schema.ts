import { z } from "zod";

export const permissionProfileSchema = z.enum(["safe", "workspace-write"]);
export type PermissionProfile = z.infer<typeof permissionProfileSchema>;

const modelSchema = z
  .object({
    engine: z.enum(["forge", "codex"]).optional(),
    provider: z.enum(["deepseek", "mimo", "openai"]).optional(),
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
  })
  .strict();

export type ForgeConfigFile = z.infer<typeof forgeConfigFileSchema>;

export interface EffectiveForgeConfig {
  readonly schemaVersion: 1;
  readonly model: {
    readonly engine: "forge" | "codex";
    readonly provider: "deepseek" | "mimo" | "openai";
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
  readonly context: {
    readonly mode: "off" | "warn" | "compact";
    readonly reservedOutputTokens: number;
    readonly bufferTokens: number;
    readonly recentTailTokens: number;
    readonly summaryTargetTokens: number;
  };
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
};
