import path from "node:path";

import { ForgeConfigError, loadForgeConfig } from "@forge/config";
import {
  discoverPlugins,
  isProjectTrusted,
  loadPluginHost,
  PluginError,
  trustProject,
  untrustProject,
} from "@forge/plugin-api";
import { builtinTools } from "@forge/tools";

import type { WritableOutput } from "./ask.js";

export interface PluginsCommandDependencies {
  readonly cwd: string;
  readonly env: NodeJS.ProcessEnv;
  readonly stdout: WritableOutput;
  readonly stderr: WritableOutput;
  readonly isTTY?: boolean;
  readonly confirm?: (prompt: string) => Promise<boolean>;
}

export async function runPluginsCommand(
  mode: "list" | "trust" | "untrust" | "run",
  options: {
    readonly yes?: boolean;
    readonly name?: string;
    readonly args?: readonly string[];
  },
  dependencies: PluginsCommandDependencies,
): Promise<number> {
  try {
    const loaded = await loadForgeConfig({
      cwd: dependencies.cwd,
      env: dependencies.env,
    });
    if (mode === "list") {
      const user = await discoverPlugins({
        root: path.join(loaded.forgeHome, "plugins"),
        scope: "user",
      });
      const project = await discoverPlugins({
        root: path.join(loaded.workspaceRoot, ".forge", "plugins"),
        scope: "project",
      });
      const trusted = await isProjectTrusted(
        loaded.forgeHome,
        loaded.workspaceRoot,
      );
      dependencies.stdout.write(
        formatPluginList({
          user,
          project,
          enabled: loaded.config.plugins.enabled,
          projectTrusted: trusted,
        }),
      );
      return 0;
    }

    if (mode === "untrust") {
      await untrustProject(loaded.forgeHome, loaded.workspaceRoot);
      dependencies.stdout.write(
        `Removed plugin trust for ${loaded.workspaceRoot}.\n`,
      );
      return 0;
    }

    if (mode === "trust") {
      const project = await discoverPlugins({
        root: path.join(loaded.workspaceRoot, ".forge", "plugins"),
        scope: "project",
      });
      if (project.length === 0) {
        dependencies.stderr.write("No project plugins were discovered.\n");
        return 2;
      }
      dependencies.stdout.write(
        [
          `Project: ${loaded.workspaceRoot}`,
          ...project.map(
            (plugin) =>
              `- ${plugin.manifest.name}@${plugin.manifest.version}\n  manifest: ${plugin.manifestPath}\n  capabilities: ${plugin.manifest.capabilities.join(", ") || "none"}`,
          ),
          "",
          "Warning: trusted plugins run in-process with the full local privileges of Forge.",
          "",
        ].join("\n"),
      );
      const approved =
        options.yes === true
          ? true
          : dependencies.isTTY !== false && dependencies.confirm
            ? await dependencies.confirm(
                "Trust and load these project plugins? [y/N] ",
              )
            : false;
      if (!approved) {
        dependencies.stderr.write(
          dependencies.isTTY === false
            ? "Trust was not recorded. Re-run with --yes for an explicit non-interactive decision.\n"
            : "Trust was not recorded.\n",
        );
        return 4;
      }
      await trustProject(loaded.forgeHome, loaded.workspaceRoot);
      dependencies.stdout.write(
        `Trusted project plugins for ${loaded.workspaceRoot}.\n`,
      );
      return 0;
    }

    const host = await loadPluginHost({
      forgeHome: loaded.forgeHome,
      workspaceRoot: loaded.workspaceRoot,
      enabledUserPlugins: loaded.config.plugins.enabled,
      reservedToolNames: builtinTools.map(({ name }) => name),
    });
    const command = host.commands.find(
      (candidate) => candidate.name === options.name,
    );
    if (!command) {
      dependencies.stderr.write(
        `Unknown plugin command "${options.name ?? ""}".\n`,
      );
      return 2;
    }
    const controller = new AbortController();
    const result = await command.execute(
      Object.freeze({
        cwd: loaded.workingDirectory,
        workspaceRoot: loaded.workspaceRoot,
        args: Object.freeze([...(options.args ?? [])]),
        signal: controller.signal,
        write: (text: string) => dependencies.stdout.write(text),
        writeError: (text: string) => dependencies.stderr.write(text),
      }),
    );
    return typeof result === "number" ? result : 0;
  } catch (error) {
    if (error instanceof ForgeConfigError || error instanceof PluginError) {
      dependencies.stderr.write(`Plugin error: ${error.message}\n`);
      return 2;
    }
    dependencies.stderr.write("Unexpected error while handling plugins.\n");
    return 1;
  }
}

function formatPluginList(options: {
  readonly user: readonly import("@forge/plugin-api").DiscoveredPlugin[];
  readonly project: readonly import("@forge/plugin-api").DiscoveredPlugin[];
  readonly enabled: readonly string[];
  readonly projectTrusted: boolean;
}): string {
  const enabled = new Set(options.enabled);
  return [
    "User plugins:",
    ...(options.user.length > 0
      ? options.user.map(
          (plugin) =>
            `  ${plugin.manifest.name}@${plugin.manifest.version}  ${enabled.has(plugin.manifest.name) ? "enabled" : "disabled"}`,
        )
      : ["  (none)"]),
    "Project plugins:",
    ...(options.project.length > 0
      ? options.project.map(
          (plugin) =>
            `  ${plugin.manifest.name}@${plugin.manifest.version}  ${options.projectTrusted ? "trusted" : "untrusted"}`,
        )
      : ["  (none)"]),
    "Skills are non-executable resources. Use `forge resources list` to inspect them.",
    "",
  ].join("\n");
}
