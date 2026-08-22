import {
  access,
  mkdir,
  readFile,
  realpath,
  rename,
  writeFile,
} from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";

import { ZodError } from "zod";

import {
  DEFAULT_FORGE_CONFIG,
  type EffectiveForgeConfig,
  type ForgeConfigFile,
  forgeConfigFileSchema,
  type ProviderProfile,
  permissionProfileSchema,
} from "./schema.js";

export type ConfigKey =
  | "schemaVersion"
  | "model.engine"
  | "model.provider"
  | "model.id"
  | "model.reasoningEffort"
  | "model.thinking"
  | "permissionProfile"
  | "limits.maxSteps"
  | "limits.maxToolCalls"
  | "limits.commandTimeoutMs"
  | "limits.maxToolOutputBytes"
  | "trace.enabled"
  | "plugins.enabled"
  | "context.mode"
  | "context.reservedOutputTokens"
  | "context.bufferTokens"
  | "context.recentTailTokens"
  | "context.summaryTargetTokens";

export interface ConfigSource {
  readonly kind: "default" | "user" | "project" | "environment" | "cli";
  readonly label: string;
  readonly path?: string;
}

export type ConfigProvenance = Readonly<Record<ConfigKey, ConfigSource>>;

export interface ConfigOverrides {
  readonly engine?: string;
  readonly provider?: string;
  readonly model?: string;
  readonly reasoningEffort?: string;
  readonly thinking?: string;
  readonly permissionProfile?: string;
  readonly maxSteps?: number;
  readonly maxToolCalls?: number;
  readonly commandTimeoutMs?: number;
  readonly maxToolOutputBytes?: number;
  readonly contextMode?: string;
  readonly reservedOutputTokens?: number;
  readonly bufferTokens?: number;
  readonly recentTailTokens?: number;
  readonly summaryTargetTokens?: number;
}

interface ForgeEnvironment extends NodeJS.ProcessEnv {
  readonly FORGE_HOME?: string;
  readonly FORGE_MODEL?: string;
  readonly FORGE_PROVIDER?: string;
  readonly FORGE_REASONING_EFFORT?: string;
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

export interface PersistedModelSelection {
  readonly engine: "forge" | "codex";
  readonly provider: string;
  readonly id: string;
  readonly reasoningEffort?: EffectiveForgeConfig["model"]["reasoningEffort"];
  readonly thinking?: EffectiveForgeConfig["model"]["thinking"];
}

async function writeUserConfig(
  loaded: LoadedForgeConfig,
  candidate: unknown,
  description: string,
): Promise<string> {
  const next: ForgeConfigFile = forgeConfigFileSchema.parse(candidate);
  await mkdir(loaded.forgeHome, { recursive: true, mode: 0o700 });
  const temporaryPath = `${loaded.userConfigPath}.tmp-${process.pid}-${Date.now()}`;
  try {
    await writeFile(temporaryPath, `${JSON.stringify(next, null, 2)}\n`, {
      encoding: "utf8",
      mode: 0o600,
    });
    await rename(temporaryPath, loaded.userConfigPath);
  } catch (error) {
    throw new ForgeConfigError(
      `Could not persist ${description} at ${loaded.userConfigPath}.`,
      loaded.userConfigPath,
      { cause: error },
    );
  }
  return loaded.userConfigPath;
}

export async function saveUserModelSelection(options: {
  readonly cwd: string;
  readonly env?: NodeJS.ProcessEnv;
  readonly selection: PersistedModelSelection;
}): Promise<string> {
  const loaded = await loadForgeConfig({
    cwd: options.cwd,
    ...(options.env ? { env: options.env } : {}),
  });
  const existing = await readConfigFile(loaded.userConfigPath);
  return writeUserConfig(
    loaded,
    {
      ...(existing ?? { schemaVersion: 1 }),
      model: {
        ...(existing?.model ?? {}),
        ...options.selection,
      },
    },
    "model selection",
  );
}

export async function saveUserProviderRoute(options: {
  readonly cwd: string;
  readonly env?: NodeJS.ProcessEnv;
  readonly route: string;
  readonly profile: ProviderProfile;
}): Promise<string> {
  const loaded = await loadForgeConfig({
    cwd: options.cwd,
    ...(options.env ? { env: options.env } : {}),
  });
  const existing = await readConfigFile(loaded.userConfigPath);
  return writeUserConfig(
    loaded,
    {
      ...(existing ?? { schemaVersion: 1 }),
      providers: {
        ...(existing?.providers ?? {}),
        [options.route]: options.profile,
      },
    },
    `provider route "${options.route}"`,
  );
}

export async function removeUserProviderRoute(options: {
  readonly cwd: string;
  readonly env?: NodeJS.ProcessEnv;
  readonly route: string;
}): Promise<{ readonly path: string; readonly removed: boolean }> {
  const loaded = await loadForgeConfig({
    cwd: options.cwd,
    ...(options.env ? { env: options.env } : {}),
  });
  const existing = await readConfigFile(loaded.userConfigPath);
  if (
    existing?.providers === undefined ||
    !Object.hasOwn(existing.providers, options.route)
  ) {
    return { path: loaded.userConfigPath, removed: false };
  }
  if (existing.model?.provider === options.route) {
    throw new ForgeConfigError(
      `Provider route "${options.route}" is selected. Choose another provider before removing it.`,
      loaded.userConfigPath,
    );
  }
  const providers = { ...existing.providers };
  delete providers[options.route];
  const savedPath = await writeUserConfig(
    loaded,
    { ...existing, providers },
    `provider route "${options.route}"`,
  );
  return { path: savedPath, removed: true };
}

export async function removeUserProviderModel(options: {
  readonly cwd: string;
  readonly env?: NodeJS.ProcessEnv;
  readonly route: string;
  readonly model: string;
}): Promise<{ readonly path: string; readonly removed: boolean }> {
  const loaded = await loadForgeConfig({
    cwd: options.cwd,
    ...(options.env ? { env: options.env } : {}),
  });
  const existing = await readConfigFile(loaded.userConfigPath);
  if (existing === undefined) {
    return { path: loaded.userConfigPath, removed: false };
  }
  const profile = existing.providers?.[options.route];
  const models = profile?.models;
  if (
    profile === undefined ||
    models === undefined ||
    !models.some(({ id }) => id === options.model)
  ) {
    return { path: loaded.userConfigPath, removed: false };
  }
  if (
    existing.model?.provider === options.route &&
    existing.model.id === options.model
  ) {
    throw new ForgeConfigError(
      `Model "${options.route}/${options.model}" is selected. Choose another model before removing it.`,
      loaded.userConfigPath,
    );
  }
  const providers = {
    ...existing.providers,
    [options.route]: {
      ...profile,
      models: models.filter(({ id }) => id !== options.model),
    },
  };
  const savedPath = await writeUserConfig(
    loaded,
    { ...existing, providers },
    `model "${options.route}/${options.model}"`,
  );
  return { path: savedPath, removed: true };
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
  const [canonicalUserConfigPath, canonicalProjectConfigPath] =
    await Promise.all([
      canonicalConfigPath(userConfigPath),
      canonicalConfigPath(projectConfigPath),
    ]);
  const projectConfigIsUserConfig =
    canonicalProjectConfigPath === canonicalUserConfigPath;
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

  // When Forge is started from the user's home directory, the conventional
  // user config path can also be the derived project config path. Load that
  // file only as user config; otherwise user-only fields such as model are
  // incorrectly rejected as project settings.
  const project = projectConfigIsUserConfig
    ? undefined
    : await readConfigFile(projectConfigPath);
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

  parseProvider(
    config.model.provider,
    provenance["model.provider"].label,
    config.providers,
  );

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
  "model.engine",
  "model.provider",
  "model.id",
  "model.reasoningEffort",
  "model.thinking",
  "permissionProfile",
  "limits.maxSteps",
  "limits.maxToolCalls",
  "limits.commandTimeoutMs",
  "limits.maxToolOutputBytes",
  "trace.enabled",
  "plugins.enabled",
  "context.mode",
  "context.reservedOutputTokens",
  "context.bufferTokens",
  "context.recentTailTokens",
  "context.summaryTargetTokens",
];

function cloneDefaults(): EffectiveForgeConfig {
  return {
    ...DEFAULT_FORGE_CONFIG,
    model: { ...DEFAULT_FORGE_CONFIG.model },
    limits: { ...DEFAULT_FORGE_CONFIG.limits },
    trace: { ...DEFAULT_FORGE_CONFIG.trace },
    plugins: { enabled: [...DEFAULT_FORGE_CONFIG.plugins.enabled] },
    context: { ...DEFAULT_FORGE_CONFIG.context },
    providers: { ...DEFAULT_FORGE_CONFIG.providers },
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

async function canonicalConfigPath(configPath: string): Promise<string> {
  const resolvedPath = path.resolve(configPath);
  try {
    return await realpath(resolvedPath);
  } catch (error) {
    if (!isNotFound(error)) return resolvedPath;
  }

  try {
    return path.join(
      await realpath(path.dirname(resolvedPath)),
      path.basename(resolvedPath),
    );
  } catch (error) {
    if (!isNotFound(error)) return resolvedPath;
    return resolvedPath;
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
    config.plugins === undefined ? undefined : "plugins",
    config.providers === undefined ? undefined : "providers",
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
  const providers = next.providers ?? base.providers;
  const provider = next.model?.provider ?? base.model.provider;
  return {
    schemaVersion: 1,
    model: {
      engine: next.model?.engine ?? base.model.engine,
      provider,
      id:
        next.model?.id ??
        (next.model?.provider && next.model.provider !== base.model.provider
          ? defaultModelId(provider, providers, "model.provider")
          : base.model.id),
      reasoningEffort:
        next.model?.reasoningEffort ?? base.model.reasoningEffort,
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
    plugins: { enabled: next.plugins?.enabled ?? base.plugins.enabled },
    context: {
      mode: next.context?.mode ?? base.context.mode,
      reservedOutputTokens:
        next.context?.reservedOutputTokens ?? base.context.reservedOutputTokens,
      bufferTokens: next.context?.bufferTokens ?? base.context.bufferTokens,
      recentTailTokens:
        next.context?.recentTailTokens ?? base.context.recentTailTokens,
      summaryTargetTokens:
        next.context?.summaryTargetTokens ?? base.context.summaryTargetTokens,
    },
    providers,
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
  const context = { ...base.context };
  const projectMode = project.context?.mode;
  if (
    projectMode !== undefined &&
    CONTEXT_MODE_STRENGTH[projectMode] > CONTEXT_MODE_STRENGTH[context.mode]
  ) {
    context.mode = projectMode;
    provenance["context.mode"] = source;
  }
  for (const [field, key] of CONTEXT_LIMIT_KEYS) {
    const proposed = project.context?.[field];
    const stricter =
      field === "reservedOutputTokens" || field === "bufferTokens"
        ? proposed !== undefined && proposed > context[field]
        : proposed !== undefined && proposed < context[field];
    if (proposed !== undefined && stricter) {
      context[field] = proposed;
      provenance[key] = source;
    }
  }
  return { ...base, limits, context };
}

function applyEnvironment(
  base: EffectiveForgeConfig,
  provenance: Record<ConfigKey, ConfigSource>,
  env: ForgeEnvironment,
): EffectiveForgeConfig {
  let config = base;
  if (env.FORGE_PROVIDER?.trim()) {
    const provider = parseProvider(
      env.FORGE_PROVIDER,
      "FORGE_PROVIDER",
      config.providers,
    );
    config = {
      ...config,
      model: {
        ...config.model,
        provider,
        ...(!env.FORGE_MODEL
          ? {
              id: defaultModelId(provider, config.providers, "FORGE_PROVIDER"),
            }
          : {}),
      },
    };
    provenance["model.provider"] = {
      kind: "environment",
      label: "FORGE_PROVIDER",
    };
  }
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
  if (env.FORGE_REASONING_EFFORT !== undefined) {
    const reasoningEffort = parseReasoningEffort(
      env.FORGE_REASONING_EFFORT,
      "FORGE_REASONING_EFFORT",
    );
    config = { ...config, model: { ...config.model, reasoningEffort } };
    provenance["model.reasoningEffort"] = {
      kind: "environment",
      label: "FORGE_REASONING_EFFORT",
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
  if (cli.engine !== undefined) {
    if (cli.engine !== "forge" && cli.engine !== "codex") {
      throw new ForgeConfigError(
        `Invalid --engine value "${cli.engine}". Use "forge" or "codex".`,
      );
    }
    config = { ...config, model: { ...config.model, engine: cli.engine } };
    provenance["model.engine"] = cliSource;
  }
  if (cli.provider !== undefined) {
    const provider = parseProvider(
      cli.provider,
      "--provider",
      config.providers,
    );
    config = {
      ...config,
      model: {
        ...config.model,
        provider,
        ...(cli.model === undefined
          ? {
              id: defaultModelId(provider, config.providers, "--provider"),
            }
          : {}),
      },
    };
    provenance["model.provider"] = cliSource;
  }
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
  if (cli.reasoningEffort !== undefined) {
    config = {
      ...config,
      model: {
        ...config.model,
        reasoningEffort: parseReasoningEffort(
          cli.reasoningEffort,
          "--reasoning-effort",
        ),
      },
    };
    provenance["model.reasoningEffort"] = cliSource;
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
  if (cli.contextMode !== undefined) {
    if (
      cli.contextMode !== "off" &&
      cli.contextMode !== "warn" &&
      cli.contextMode !== "compact"
    ) {
      throw new ForgeConfigError(
        `Invalid --context-mode value "${cli.contextMode}". Use off, warn, or compact.`,
      );
    }
    config = {
      ...config,
      context: { ...config.context, mode: cli.contextMode },
    };
    provenance["context.mode"] = cliSource;
  }
  for (const [field, key] of CONTEXT_LIMIT_KEYS) {
    const value = cli[field];
    if (value !== undefined) {
      if (
        !Number.isInteger(value) ||
        value <
          (field === "recentTailTokens"
            ? 0
            : field === "summaryTargetTokens"
              ? 64
              : 1) ||
        value > 2_000_000
      ) {
        throw new ForgeConfigError(
          `--${toKebab(field)} must be an integer from ${field === "recentTailTokens" ? 0 : field === "summaryTargetTokens" ? 64 : 1} to 2000000.`,
        );
      }
      config = { ...config, context: { ...config.context, [field]: value } };
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
  if (config.model?.engine !== undefined) provenance["model.engine"] = source;
  if (config.model?.provider !== undefined)
    provenance["model.provider"] = source;
  if (config.model?.id !== undefined) provenance["model.id"] = source;
  if (config.model?.reasoningEffort !== undefined)
    provenance["model.reasoningEffort"] = source;
  if (config.model?.thinking !== undefined)
    provenance["model.thinking"] = source;
  if (config.permissionProfile !== undefined)
    provenance.permissionProfile = source;
  for (const [field, key] of LIMIT_KEYS) {
    if (config.limits?.[field] !== undefined) provenance[key] = source;
  }
  if (config.trace?.enabled !== undefined) provenance["trace.enabled"] = source;
  if (config.plugins?.enabled !== undefined)
    provenance["plugins.enabled"] = source;
  if (config.context?.mode !== undefined) provenance["context.mode"] = source;
  for (const [field, key] of CONTEXT_LIMIT_KEYS) {
    if (config.context?.[field] !== undefined) provenance[key] = source;
  }
}

const LIMIT_KEYS = [
  ["maxSteps", "limits.maxSteps"],
  ["maxToolCalls", "limits.maxToolCalls"],
  ["commandTimeoutMs", "limits.commandTimeoutMs"],
  ["maxToolOutputBytes", "limits.maxToolOutputBytes"],
] as const;

const CONTEXT_LIMIT_KEYS = [
  ["reservedOutputTokens", "context.reservedOutputTokens"],
  ["bufferTokens", "context.bufferTokens"],
  ["recentTailTokens", "context.recentTailTokens"],
  ["summaryTargetTokens", "context.summaryTargetTokens"],
] as const;

const CONTEXT_MODE_STRENGTH = { off: 0, warn: 1, compact: 2 } as const;

function parseThinking(value: string, source: string): "enabled" | "disabled" {
  if (value === "enabled" || value === "disabled") return value;
  throw new ForgeConfigError(
    `Invalid ${source} value "${value}". Use "enabled" or "disabled".`,
  );
}

function parseProvider(
  value: string,
  source: string,
  providers: Readonly<Record<string, ProviderProfile>>,
): string {
  if (value === "deepseek" || value === "openai") return value;
  if (Object.hasOwn(providers, value)) return value;
  const routes = Object.keys(providers).sort();
  throw new ForgeConfigError(
    `Invalid ${source} value "${value}". Use "deepseek", "openai"${
      routes.length === 0
        ? ""
        : `, or a configured provider route: ${routes.join(", ")}`
    }.`,
  );
}

function parseReasoningEffort(
  value: string,
  source: string,
): EffectiveForgeConfig["model"]["reasoningEffort"] {
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
  throw new ForgeConfigError(
    `Invalid ${source} value "${value}". Use none, minimal, low, medium, high, xhigh, max, or ultra.`,
  );
}

function defaultModelId(
  provider: string,
  providers: Readonly<Record<string, ProviderProfile>>,
  source: string,
): string {
  if (provider === "openai") return "gpt-5.4-mini";
  if (provider === "deepseek") return "deepseek-v4-flash";
  const first = providers[provider]?.models?.[0]?.id;
  if (first !== undefined) return first;
  throw new ForgeConfigError(
    `Provider route "${provider}" (${source}) configures no models. Add a model or pass --model/FORGE_MODEL.`,
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
