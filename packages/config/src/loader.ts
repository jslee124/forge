import { access, readFile, realpath } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";

import { ZodError } from "zod";

import {
  DEFAULT_FORGE_CONFIG,
  type EffectiveForgeConfig,
  type ForgeConfigFile,
  forgeConfigFileSchema,
  permissionProfileSchema,
} from "./schema.js";

export type ConfigKey =
  | "schemaVersion"
  | "model.id"
  | "model.thinking"
  | "permissionProfile"
  | "limits.maxSteps"
  | "limits.maxToolCalls"
  | "limits.commandTimeoutMs"
  | "limits.maxToolOutputBytes"
  | "trace.enabled";

export interface ConfigSource {
  readonly kind: "default" | "user" | "project" | "environment" | "cli";
  readonly label: string;
  readonly path?: string;
}

export type ConfigProvenance = Readonly<Record<ConfigKey, ConfigSource>>;

export interface ConfigOverrides {
  readonly model?: string;
  readonly thinking?: string;
  readonly permissionProfile?: string;
  readonly maxSteps?: number;
  readonly maxToolCalls?: number;
  readonly commandTimeoutMs?: number;
  readonly maxToolOutputBytes?: number;
}

interface ForgeEnvironment extends NodeJS.ProcessEnv {
  readonly FORGE_HOME?: string;
  readonly FORGE_MODEL?: string;
  readonly FORGE_THINKING?: string;
}

export interface LoadedForgeConfig {
  readonly config: EffectiveForgeConfig;
  readonly provenance: ConfigProvenance;
  readonly forgeHome: string;
  readonly workspaceRoot: string;
  readonly workingDirectory: string;
  readonly userConfigPath: string;
  readonly projectConfigPath: string;
}

export class ForgeConfigError extends Error {
  readonly code = "FORGE_CONFIG_ERROR";
  readonly sourcePath: string | undefined;

  constructor(message: string, sourcePath?: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "ForgeConfigError";
    this.sourcePath = sourcePath;
  }
}

export async function loadForgeConfig(options: {
  readonly cwd: string;
  readonly env?: NodeJS.ProcessEnv;
  readonly cli?: ConfigOverrides;
}): Promise<LoadedForgeConfig> {
  const env: ForgeEnvironment = options.env ?? process.env;
  const workingDirectory = await canonicalDirectory(options.cwd);
  const workspaceRoot = await findWorkspaceRoot(workingDirectory);
  const forgeHome = path.resolve(
    env.FORGE_HOME?.trim() || path.join(homedir(), ".forge"),
  );
  const userConfigPath = path.join(forgeHome, "config.json");
  const projectConfigPath = path.join(workspaceRoot, ".forge", "config.json");
  const defaults: ConfigSource = { kind: "default", label: "built-in default" };
  const provenance = Object.fromEntries(
    CONFIG_KEYS.map((key) => [key, defaults]),
  ) as Record<ConfigKey, ConfigSource>;
  let config = cloneDefaults();

  const user = await readConfigFile(userConfigPath);
  if (user) {
    config = mergeOrdinary(config, user);
    recordFileProvenance(provenance, user, {
      kind: "user",
      label: userConfigPath,
      path: userConfigPath,
    });
  }

  const project = await readConfigFile(projectConfigPath);
  if (project) {
    rejectProjectOnlyFields(project, projectConfigPath);
    const source: ConfigSource = {
      kind: "project",
      label: projectConfigPath,
      path: projectConfigPath,
    };
    config = mergeProjectLimits(config, project, provenance, source);
  }

  config = applyEnvironment(config, provenance, env);
  config = applyCli(config, provenance, options.cli ?? {});

  return {
    config,
    provenance,
    forgeHome,
    workspaceRoot,
    workingDirectory,
    userConfigPath,
    projectConfigPath,
  };
}

const CONFIG_KEYS: readonly ConfigKey[] = [
  "schemaVersion",
  "model.id",
  "model.thinking",
  "permissionProfile",
  "limits.maxSteps",
  "limits.maxToolCalls",
  "limits.commandTimeoutMs",
  "limits.maxToolOutputBytes",
  "trace.enabled",
];

function cloneDefaults(): EffectiveForgeConfig {
  return {
    ...DEFAULT_FORGE_CONFIG,
    model: { ...DEFAULT_FORGE_CONFIG.model },
    limits: { ...DEFAULT_FORGE_CONFIG.limits },
    trace: { ...DEFAULT_FORGE_CONFIG.trace },
  };
}

async function canonicalDirectory(directory: string): Promise<string> {
  try {
    return await realpath(path.resolve(directory));
  } catch (error) {
    throw new ForgeConfigError(
      `Could not resolve working directory: ${directory}`,
      directory,
      { cause: error },
    );
  }
}

async function findWorkspaceRoot(cwd: string): Promise<string> {
  let current = cwd;
  while (true) {
    try {
      await access(path.join(current, ".git"));
      return current;
    } catch {
      const parent = path.dirname(current);
      if (parent === current) return cwd;
      current = parent;
    }
  }
}

async function readConfigFile(
  sourcePath: string,
): Promise<ForgeConfigFile | undefined> {
  let text: string;
  try {
    text = await readFile(sourcePath, "utf8");
  } catch (error) {
    if (isNotFound(error)) return undefined;
    throw new ForgeConfigError(
      `Could not read configuration at ${sourcePath}.`,
      sourcePath,
      { cause: error },
    );
  }

  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch (error) {
    throw new ForgeConfigError(`Invalid JSON in ${sourcePath}.`, sourcePath, {
      cause: error,
    });
  }
  try {
    return forgeConfigFileSchema.parse(value);
  } catch (error) {
    const detail =
      error instanceof ZodError
        ? error.issues
            .map((issue) => `${formatIssuePath(issue.path)}: ${issue.message}`)
            .join("; ")
        : "Configuration did not match schema version 1.";
    throw new ForgeConfigError(
      `Invalid configuration at ${sourcePath}: ${detail}`,
      sourcePath,
      { cause: error },
    );
  }
}

function rejectProjectOnlyFields(
  config: ForgeConfigFile,
  sourcePath: string,
): void {
  const forbidden = [
    config.model === undefined ? undefined : "model",
    config.permissionProfile === undefined ? undefined : "permissionProfile",
    config.trace === undefined ? undefined : "trace",
  ].filter((value): value is string => value !== undefined);
  if (forbidden.length > 0) {
    throw new ForgeConfigError(
      `Invalid project configuration at ${sourcePath}: ${forbidden.join(", ")} may only be set by the user or CLI.`,
      sourcePath,
    );
  }
}

function mergeOrdinary(
  base: EffectiveForgeConfig,
  next: ForgeConfigFile,
): EffectiveForgeConfig {
  return {
    schemaVersion: 1,
    model: {
      id: next.model?.id ?? base.model.id,
      thinking: next.model?.thinking ?? base.model.thinking,
    },
    permissionProfile: next.permissionProfile ?? base.permissionProfile,
    limits: {
      maxSteps: next.limits?.maxSteps ?? base.limits.maxSteps,
      maxToolCalls: next.limits?.maxToolCalls ?? base.limits.maxToolCalls,
      commandTimeoutMs:
        next.limits?.commandTimeoutMs ?? base.limits.commandTimeoutMs,
      maxToolOutputBytes:
        next.limits?.maxToolOutputBytes ?? base.limits.maxToolOutputBytes,
    },
    trace: { enabled: next.trace?.enabled ?? base.trace.enabled },
  };
}

function mergeProjectLimits(
  base: EffectiveForgeConfig,
  project: ForgeConfigFile,
  provenance: Record<ConfigKey, ConfigSource>,
  source: ConfigSource,
): EffectiveForgeConfig {
  const limits = { ...base.limits };
  for (const [field, key] of LIMIT_KEYS) {
    const proposed = project.limits?.[field];
    if (proposed !== undefined && proposed < limits[field]) {
      limits[field] = proposed;
      provenance[key] = source;
    }
  }
  return { ...base, limits };
}

function applyEnvironment(
  base: EffectiveForgeConfig,
  provenance: Record<ConfigKey, ConfigSource>,
  env: ForgeEnvironment,
): EffectiveForgeConfig {
  let config = base;
  if (env.FORGE_MODEL?.trim()) {
    config = {
      ...config,
      model: { ...config.model, id: env.FORGE_MODEL.trim() },
    };
    provenance["model.id"] = { kind: "environment", label: "FORGE_MODEL" };
  }
  if (env.FORGE_THINKING !== undefined) {
    const thinking = parseThinking(env.FORGE_THINKING, "FORGE_THINKING");
    config = { ...config, model: { ...config.model, thinking } };
    provenance["model.thinking"] = {
      kind: "environment",
      label: "FORGE_THINKING",
    };
  }
  return config;
}

function applyCli(
  base: EffectiveForgeConfig,
  provenance: Record<ConfigKey, ConfigSource>,
  cli: ConfigOverrides,
): EffectiveForgeConfig {
  let config = base;
  const cliSource: ConfigSource = { kind: "cli", label: "explicit CLI option" };
  if (cli.model !== undefined) {
    const model = cli.model.trim();
    if (!model) throw new ForgeConfigError("--model must not be empty.");
    config = { ...config, model: { ...config.model, id: model } };
    provenance["model.id"] = cliSource;
  }
  if (cli.thinking !== undefined) {
    config = {
      ...config,
      model: {
        ...config.model,
        thinking: parseThinking(cli.thinking, "--thinking"),
      },
    };
    provenance["model.thinking"] = cliSource;
  }
  if (cli.permissionProfile !== undefined) {
    const parsed = permissionProfileSchema.safeParse(cli.permissionProfile);
    if (!parsed.success)
      throw new ForgeConfigError(
        `Invalid permission profile "${cli.permissionProfile}". Use "safe" or "workspace-write".`,
      );
    config = { ...config, permissionProfile: parsed.data };
    provenance.permissionProfile = cliSource;
  }
  for (const [field, key] of LIMIT_KEYS) {
    const value = cli[field];
    if (value !== undefined) {
      if (!Number.isInteger(value) || value <= 0)
        throw new ForgeConfigError(
          `--${toKebab(field)} must be a positive integer.`,
        );
      config = { ...config, limits: { ...config.limits, [field]: value } };
      provenance[key] = cliSource;
    }
  }
  return config;
}

function recordFileProvenance(
  provenance: Record<ConfigKey, ConfigSource>,
  config: ForgeConfigFile,
  source: ConfigSource,
): void {
  provenance.schemaVersion = source;
  if (config.model?.id !== undefined) provenance["model.id"] = source;
  if (config.model?.thinking !== undefined)
    provenance["model.thinking"] = source;
  if (config.permissionProfile !== undefined)
    provenance.permissionProfile = source;
  for (const [field, key] of LIMIT_KEYS) {
    if (config.limits?.[field] !== undefined) provenance[key] = source;
  }
  if (config.trace?.enabled !== undefined) provenance["trace.enabled"] = source;
}

const LIMIT_KEYS = [
  ["maxSteps", "limits.maxSteps"],
  ["maxToolCalls", "limits.maxToolCalls"],
  ["commandTimeoutMs", "limits.commandTimeoutMs"],
  ["maxToolOutputBytes", "limits.maxToolOutputBytes"],
] as const;

function parseThinking(value: string, source: string): "enabled" | "disabled" {
  if (value === "enabled" || value === "disabled") return value;
  throw new ForgeConfigError(
    `Invalid ${source} value "${value}". Use "enabled" or "disabled".`,
  );
}

function formatIssuePath(parts: readonly PropertyKey[]): string {
  return parts.length === 0 ? "configuration" : parts.join(".");
}

function toKebab(value: string): string {
  return value.replace(/[A-Z]/gu, (letter) => `-${letter.toLowerCase()}`);
}

function isNotFound(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === "ENOENT"
  );
}
