import path from "node:path";

import { loadForgeConfig } from "@forge/config";
import type { PluginCapability } from "@forge/plugin-api";
import {
  discoverPlugins,
  isProjectTrusted,
  PluginError,
  trustProject,
  untrustProject,
} from "@forge/plugin-api";
import { discoverSkillCatalog } from "@forge/resources";

export interface DetectedPluginResource {
  readonly name: string;
  readonly version: string;
  readonly scope: "project" | "user";
  readonly state: "enabled" | "trusted" | "untrusted";
  readonly capabilities: readonly PluginCapability[];
}

export interface DetectedSkillResource {
  readonly name: string;
  readonly description?: string;
  readonly path: string;
  readonly source: "builtin" | "user" | "project";
  readonly invocation: "model" | "explicit-only";
  readonly status?: "automatic" | "explicit-only" | "disabled" | "shadowed";
  readonly shadowedBy?: "builtin" | "user" | "project";
}

export interface DetectedStartupResources {
  readonly plugins: readonly DetectedPluginResource[];
  readonly skills: readonly DetectedSkillResource[];
  readonly diagnostics?: readonly string[];
}

export const EMPTY_STARTUP_RESOURCES: DetectedStartupResources = Object.freeze({
  plugins: Object.freeze([]),
  skills: Object.freeze([]),
  diagnostics: Object.freeze([]),
});

export async function detectStartupResources(options: {
  readonly forgeHome: string;
  readonly workspaceRoot: string;
  readonly enabledUserPlugins: readonly string[];
  readonly disabledModelInvocation?: readonly string[];
}): Promise<DetectedStartupResources> {
  const [userPlugins, projectPlugins, skills] = await Promise.all([
    discoverPlugins({
      root: path.join(options.forgeHome, "plugins"),
      scope: "user",
      names: options.enabledUserPlugins,
    }),
    discoverPlugins({
      root: path.join(options.workspaceRoot, ".forge", "plugins"),
      scope: "project",
    }),
    discoverSkillCatalog({
      forgeHome: options.forgeHome,
      workspaceRoot: options.workspaceRoot,
      ...(options.disabledModelInvocation
        ? { disabledModelInvocation: options.disabledModelInvocation }
        : {}),
    }),
  ]);
  const projectTrusted =
    projectPlugins.length > 0 &&
    (await isProjectTrusted(options.forgeHome, options.workspaceRoot));

  return {
    plugins: [
      ...userPlugins.map((plugin) => ({
        name: plugin.manifest.name,
        version: plugin.manifest.version,
        scope: "user" as const,
        state: "enabled" as const,
        capabilities: plugin.manifest.capabilities,
      })),
      ...projectPlugins.map((plugin) => ({
        name: plugin.manifest.name,
        version: plugin.manifest.version,
        scope: "project" as const,
        state: projectTrusted ? ("trusted" as const) : ("untrusted" as const),
        capabilities: plugin.manifest.capabilities,
      })),
    ],
    skills: skills.resources.map((skill) => {
      const winner = skills.skills.find(({ name }) => name === skill.name);
      const shadowedBy = winner?.id === skill.id ? undefined : winner?.source;
      return {
        name: skill.name,
        description: skill.description,
        path: skill.canonicalPath,
        source: skill.source,
        invocation: skill.invocation,
        status: shadowedBy
          ? ("shadowed" as const)
          : skill.invocation === "explicit-only"
            ? ("explicit-only" as const)
            : skill.modelInvocationEnabled
              ? ("automatic" as const)
              : ("disabled" as const),
        ...(shadowedBy ? { shadowedBy } : {}),
      };
    }),
    diagnostics: skills.diagnostics.map(
      ({ code, source, message }) => `[${code}/${source}] ${message}`,
    ),
  };
}

export async function changeProjectPluginTrust(options: {
  readonly cwd: string;
  readonly env: NodeJS.ProcessEnv;
  readonly trusted: boolean;
}): Promise<DetectedStartupResources> {
  const loaded = await loadForgeConfig({ cwd: options.cwd, env: options.env });
  const projectPlugins = await discoverPlugins({
    root: path.join(loaded.workspaceRoot, ".forge", "plugins"),
    scope: "project",
  });
  if (options.trusted && projectPlugins.length === 0) {
    throw new PluginError("No project plugins were discovered.");
  }
  if (options.trusted) {
    await trustProject(loaded.forgeHome, loaded.workspaceRoot);
  } else {
    await untrustProject(loaded.forgeHome, loaded.workspaceRoot);
  }
  return detectStartupResources({
    forgeHome: loaded.forgeHome,
    workspaceRoot: loaded.workspaceRoot,
    enabledUserPlugins: loaded.config.plugins.enabled,
    disabledModelInvocation: loaded.config.resources.disabledModelInvocation,
  });
}
