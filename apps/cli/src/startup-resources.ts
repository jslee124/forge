import path from "node:path";

import { loadForgeConfig } from "@forge/config";
import type { PluginCapability } from "@forge/plugin-api";
import {
  discoverPlugins,
  discoverPortableSkills,
  isProjectTrusted,
  PluginError,
  trustProject,
  untrustProject,
} from "@forge/plugin-api";

export interface DetectedPluginResource {
  readonly name: string;
  readonly version: string;
  readonly scope: "project" | "user";
  readonly state: "enabled" | "trusted" | "untrusted";
  readonly capabilities: readonly PluginCapability[];
}

export interface DetectedSkillResource {
  readonly name: string;
  readonly path: string;
}

export interface DetectedStartupResources {
  readonly plugins: readonly DetectedPluginResource[];
  readonly skills: readonly DetectedSkillResource[];
}

export const EMPTY_STARTUP_RESOURCES: DetectedStartupResources = Object.freeze({
  plugins: Object.freeze([]),
  skills: Object.freeze([]),
});

export async function detectStartupResources(options: {
  readonly forgeHome: string;
  readonly workspaceRoot: string;
  readonly enabledUserPlugins: readonly string[];
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
    discoverPortableSkills(options.workspaceRoot),
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
    skills: skills.map((skill) => ({ name: skill.name, path: skill.path })),
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
  });
}
