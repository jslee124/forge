import { z } from "zod";
import { sha256 } from "./context.js";
import type { ModelRequest } from "./model.js";

export const FORGE_PROMPT_SCHEMA_VERSION = 3;

export type PromptCacheMode =
  | "automatic"
  | "keyed"
  | "explicit-breakpoints"
  | "unsupported";

export interface PromptCacheCapabilities {
  readonly mode: PromptCacheMode;
  readonly keyScope?: "session" | "workspace";
}

export interface PromptPrefixInputs {
  readonly provider: string;
  readonly modelId: string;
  readonly coreContract: string;
  readonly instructions: readonly string[];
  readonly resourceCatalog: string;
  readonly enabledResourceIds: readonly string[];
  readonly enabledPluginIds: readonly string[];
  readonly checkpointGeneration: string;
  readonly providerOptions?: Readonly<
    Record<string, string | number | boolean>
  >;
}

export interface PromptPrefixObservation {
  readonly schemaVersion: 1;
  readonly promptSchemaVersion: number;
  readonly stablePrefixHash: string;
  readonly instructionHash: string;
  readonly resourceCatalogHash: string;
  readonly toolSchemaHash: string;
  readonly providerModelHash: string;
  readonly promptSchemaHash: string;
  readonly enabledResourceHash: string;
  readonly enabledPluginHash: string;
  readonly checkpointGenerationHash: string;
  readonly providerOptionsHash: string;
  readonly invalidatedBy: readonly PromptPrefixInvalidation[];
  readonly cacheMode: PromptCacheMode;
  readonly cacheKey?: string;
}

export type PromptPrefixInvalidation =
  | "initial"
  | "provider-or-model"
  | "prompt-schema"
  | "instructions"
  | "resource-catalog"
  | "enabled-resources"
  | "enabled-plugins"
  | "tool-schema"
  | "checkpoint-generation";

interface PrefixComponents {
  readonly providerModel: string;
  readonly promptSchema: string;
  readonly instructions: string;
  readonly resourceCatalog: string;
  readonly enabledResources: string;
  readonly enabledPlugins: string;
  readonly toolSchema: string;
  readonly checkpointGeneration: string;
  readonly providerOptions: string;
}

export function observePromptPrefix(options: {
  readonly request: ModelRequest;
  readonly inputs: PromptPrefixInputs;
  readonly capabilities: PromptCacheCapabilities;
  readonly previous?: PromptPrefixObservation;
  readonly sessionId?: string;
  readonly workspaceRoot?: string;
}): PromptPrefixObservation {
  const components = prefixComponents(options.request, options.inputs);
  const hashes = Object.fromEntries(
    Object.entries(components).map(([name, value]) => [name, sha256(value)]),
  ) as Record<keyof PrefixComponents, string>;
  const stablePrefixHash = sha256(stableSerialize(hashes));
  const invalidatedBy = options.previous
    ? invalidations(options.previous, hashes, stablePrefixHash)
    : (["initial"] as const);
  const cacheKey = cacheKeyFor(options, stablePrefixHash);
  return {
    schemaVersion: 1,
    promptSchemaVersion: FORGE_PROMPT_SCHEMA_VERSION,
    stablePrefixHash,
    instructionHash: hashes.instructions,
    resourceCatalogHash: hashes.resourceCatalog,
    toolSchemaHash: hashes.toolSchema,
    providerModelHash: hashes.providerModel,
    promptSchemaHash: hashes.promptSchema,
    enabledResourceHash: hashes.enabledResources,
    enabledPluginHash: hashes.enabledPlugins,
    checkpointGenerationHash: hashes.checkpointGeneration,
    providerOptionsHash: hashes.providerOptions,
    invalidatedBy,
    cacheMode: options.capabilities.mode,
    ...(cacheKey ? { cacheKey } : {}),
  };
}

function prefixComponents(
  request: ModelRequest,
  inputs: PromptPrefixInputs,
): PrefixComponents {
  return {
    providerModel: `${inputs.provider}\0${inputs.modelId}`,
    promptSchema: String(FORGE_PROMPT_SCHEMA_VERSION),
    instructions: stableSerialize({
      coreContract: inputs.coreContract,
      instructions: inputs.instructions,
    }),
    resourceCatalog: inputs.resourceCatalog,
    enabledResources: stableSerialize([...inputs.enabledResourceIds].sort()),
    enabledPlugins: stableSerialize([...inputs.enabledPluginIds].sort()),
    toolSchema: stableSerialize(
      (request.tools ?? []).map(({ name, description, inputSchema }) => ({
        name,
        description,
        inputSchema: safeSchema(inputSchema),
      })),
    ),
    checkpointGeneration: inputs.checkpointGeneration,
    providerOptions: stableSerialize(inputs.providerOptions ?? {}),
  };
}

function invalidations(
  previous: PromptPrefixObservation,
  hashes: Record<keyof PrefixComponents, string>,
  stablePrefixHash: string,
): readonly PromptPrefixInvalidation[] {
  if (previous.stablePrefixHash === stablePrefixHash) return [];
  const reasons: PromptPrefixInvalidation[] = [];
  if (previous.providerModelHash !== hashes.providerModel)
    reasons.push("provider-or-model");
  if (previous.providerOptionsHash !== hashes.providerOptions)
    reasons.push("provider-or-model");
  if (previous.promptSchemaHash !== hashes.promptSchema)
    reasons.push("prompt-schema");
  if (previous.instructionHash !== hashes.instructions)
    reasons.push("instructions");
  if (previous.resourceCatalogHash !== hashes.resourceCatalog)
    reasons.push("resource-catalog");
  if (previous.enabledResourceHash !== hashes.enabledResources)
    reasons.push("enabled-resources");
  if (previous.enabledPluginHash !== hashes.enabledPlugins)
    reasons.push("enabled-plugins");
  if (previous.toolSchemaHash !== hashes.toolSchema)
    reasons.push("tool-schema");
  if (previous.checkpointGenerationHash !== hashes.checkpointGeneration)
    reasons.push("checkpoint-generation");
  return [...new Set(reasons)];
}

function cacheKeyFor(
  options: {
    readonly capabilities: PromptCacheCapabilities;
    readonly sessionId?: string;
    readonly workspaceRoot?: string;
  },
  stablePrefixHash: string,
): string | undefined {
  if (options.capabilities.mode !== "keyed") return undefined;
  const identity =
    options.capabilities.keyScope === "session"
      ? options.sessionId
      : options.workspaceRoot;
  return identity ? sha256(`${identity}\0${stablePrefixHash}`) : undefined;
}

function safeSchema(schema: z.ZodType): unknown {
  try {
    return z.toJSONSchema(schema);
  } catch {
    return "unavailable";
  }
}

function stableSerialize(value: unknown): string {
  return JSON.stringify(normalize(value, new WeakSet<object>()));
}

function normalize(value: unknown, ancestors: WeakSet<object>): unknown {
  if (typeof value === "function")
    return `[Function:${value.name || "anonymous"}]`;
  if (typeof value === "bigint") return value.toString();
  if (typeof value !== "object" || value === null) return value;
  if (ancestors.has(value)) return "[Circular]";
  ancestors.add(value);
  const normalized = Array.isArray(value)
    ? value.map((entry) => normalize(entry, ancestors))
    : Object.fromEntries(
        Object.entries(value)
          .filter(([key]) => key !== "bag")
          .sort(([left], [right]) => left.localeCompare(right))
          .map(([key, entry]) => [key, normalize(entry, ancestors)]),
      );
  ancestors.delete(value);
  return normalized;
}
