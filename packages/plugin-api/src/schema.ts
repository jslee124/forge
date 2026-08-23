import { z } from "zod";

import { PLUGIN_API_VERSION } from "./types.js";

export const pluginCapabilitySchema = z.enum([
  "commands:register",
  "events:observe",
  "network:access",
  "policy:restrict",
  "prompt:contribute",
  "subagents:register",
  "tools:register",
]);

export const pluginManifestSchema = z
  .object({
    schemaVersion: z.literal(1),
    apiVersion: z.literal(PLUGIN_API_VERSION),
    name: z.string().regex(/^[a-z][a-z0-9-]{0,63}$/u),
    version: z.string().trim().min(1),
    entry: z.string().trim().min(1),
    capabilities: z.array(pluginCapabilitySchema).max(16).default([]),
  })
  .strict();
