import { z } from "zod";

export const permissionProfileSchema = z.enum(["safe", "workspace-write"]);
export type PermissionProfile = z.infer<typeof permissionProfileSchema>;

const modelSchema = z
  .object({
    id: z.string().trim().min(1).optional(),
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

export const forgeConfigFileSchema = z
  .object({
    schemaVersion: z.literal(1),
    model: modelSchema.optional(),
    permissionProfile: permissionProfileSchema.optional(),
    limits: limitsSchema.optional(),
    trace: traceSchema.optional(),
  })
  .strict();

export type ForgeConfigFile = z.infer<typeof forgeConfigFileSchema>;

export interface EffectiveForgeConfig {
  readonly schemaVersion: 1;
  readonly model: {
    readonly id: string;
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
}

export const DEFAULT_FORGE_CONFIG: EffectiveForgeConfig = {
  schemaVersion: 1,
  model: { id: "deepseek-v4-flash", thinking: "enabled" },
  permissionProfile: "safe",
  limits: {
    maxSteps: 12,
    maxToolCalls: 40,
    commandTimeoutMs: 60_000,
    maxToolOutputBytes: 65_536,
  },
  trace: { enabled: true },
};
