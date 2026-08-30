import {
  type ConfigKey,
  ForgeConfigError,
  type LoadedForgeConfig,
  loadForgeConfig,
} from "@forge/config";

import type { WritableOutput } from "./ask.js";

const DISPLAY_KEYS: readonly ConfigKey[] = [
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
  "resources.disabledModelInvocation",
  "context.mode",
  "context.reservedOutputTokens",
  "context.bufferTokens",
  "context.recentTailTokens",
  "context.summaryTargetTokens",
  "context.activationThreshold",
  "context.minimumReclaimTokens",
  "context.minimumReclaimRatio",
];

export async function runConfigCommand(
  mode: "show" | "validate",
  dependencies: {
    readonly cwd: string;
    readonly env: NodeJS.ProcessEnv;
    readonly stdout: WritableOutput;
    readonly stderr: WritableOutput;
  },
): Promise<number> {
  try {
    const loaded = await loadForgeConfig({
      cwd: dependencies.cwd,
      env: dependencies.env,
    });
    dependencies.stdout.write(
      mode === "show" ? formatConfig(loaded) : formatValidation(loaded),
    );
    return 0;
  } catch (error) {
    if (error instanceof ForgeConfigError) {
      dependencies.stderr.write(`Configuration error: ${error.message}\n`);
      return 2;
    }
    dependencies.stderr.write(
      "Unexpected error while loading configuration.\n",
    );
    return 1;
  }
}

export function formatConfig(loaded: LoadedForgeConfig): string {
  const values = flatten(loaded);
  return [
    `Forge home: ${loaded.forgeHome}`,
    `Workspace: ${loaded.workspaceRoot}`,
    ...DISPLAY_KEYS.map(
      (key) =>
        `${key} = ${JSON.stringify(values[key])}  [${loaded.provenance[key].label}]`,
    ),
    `providers = ${JSON.stringify(Object.keys(loaded.config.providers).sort())}  [user configuration only]`,
    "",
  ].join("\n");
}

function formatValidation(loaded: LoadedForgeConfig): string {
  return [
    "Configuration is valid.",
    `User config: ${loaded.userConfigPath}`,
    `Project config: ${loaded.projectConfigPath}`,
    "",
  ].join("\n");
}

function flatten(loaded: LoadedForgeConfig): Record<ConfigKey, unknown> {
  const { config } = loaded;
  return {
    schemaVersion: config.schemaVersion,
    "model.engine": config.model.engine,
    "model.provider": config.model.provider,
    "model.id": config.model.id,
    "model.reasoningEffort": config.model.reasoningEffort,
    "model.thinking": config.model.thinking,
    permissionProfile: config.permissionProfile,
    "limits.maxSteps": config.limits.maxSteps,
    "limits.maxToolCalls": config.limits.maxToolCalls,
    "limits.commandTimeoutMs": config.limits.commandTimeoutMs,
    "limits.maxToolOutputBytes": config.limits.maxToolOutputBytes,
    "trace.enabled": config.trace.enabled,
    "plugins.enabled": config.plugins.enabled,
    "resources.disabledModelInvocation":
      config.resources.disabledModelInvocation,
    "context.mode": config.context.mode,
    "context.reservedOutputTokens": config.context.reservedOutputTokens,
    "context.bufferTokens": config.context.bufferTokens,
    "context.recentTailTokens": config.context.recentTailTokens,
    "context.summaryTargetTokens": config.context.summaryTargetTokens,
    "context.activationThreshold": config.context.activationThreshold,
    "context.minimumReclaimTokens": config.context.minimumReclaimTokens,
    "context.minimumReclaimRatio": config.context.minimumReclaimRatio,
  };
}
