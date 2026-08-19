import { type Dirent, existsSync } from "node:fs";
import { readdir, readFile, realpath } from "node:fs/promises";
import path from "node:path";

import { ZodError } from "zod";

import { pluginManifestSchema } from "./schema.js";
import type {
  DiscoveredPlugin,
  PluginManifest,
  PortableSkill,
} from "./types.js";

export class PluginError extends Error {
  readonly code = "FORGE_PLUGIN_ERROR";
  readonly sourcePath: string | undefined;

  constructor(message: string, sourcePath?: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "PluginError";
    this.sourcePath = sourcePath;
  }
}

export async function discoverPlugins(options: {
  readonly root: string;
  readonly scope: "user" | "project";
  readonly names?: readonly string[];
}): Promise<readonly DiscoveredPlugin[]> {
  const entries = await readDirectories(options.root);
  const selected = options.names ? new Set(options.names) : undefined;
  const plugins: DiscoveredPlugin[] = [];
  for (const entry of entries) {
    if (selected && !selected.has(entry.name)) continue;
    const directory = path.join(options.root, entry.name);
    const manifestPath = path.join(directory, "plugin.json");
    if (!existsSync(manifestPath)) continue;
    const value = await readJson(manifestPath);
    let manifest: PluginManifest;
    try {
      manifest = pluginManifestSchema.parse(value);
    } catch (error) {
      const detail =
        error instanceof ZodError
          ? error.issues.map((issue) => issue.message).join("; ")
          : "manifest does not match schema version 1";
      throw new PluginError(
        `Invalid plugin manifest at ${manifestPath}: ${detail}.`,
        manifestPath,
        {
          cause: error,
        },
      );
    }
    if (manifest.name !== entry.name) {
      throw new PluginError(
        `Plugin name "${manifest.name}" must match its directory "${entry.name}".`,
        manifestPath,
      );
    }
    validateRelativeEntry(manifest.entry, directory, manifestPath);
    plugins.push({
      scope: options.scope,
      directory,
      manifestPath,
      manifest,
    });
  }
  if (selected) {
    for (const name of selected) {
      if (!plugins.some((plugin) => plugin.manifest.name === name)) {
        throw new PluginError(
          `Enabled user plugin "${name}" was not found under ${options.root}.`,
          options.root,
        );
      }
    }
  }
  return plugins.sort((left, right) =>
    left.manifest.name.localeCompare(right.manifest.name),
  );
}

export async function discoverPortableSkills(
  workspaceRoot: string,
): Promise<readonly PortableSkill[]> {
  const root = path.join(workspaceRoot, ".agents", "skills");
  const entries = await readDirectories(root);
  const skills: PortableSkill[] = [];
  for (const entry of entries) {
    if (!/^[a-z0-9][a-z0-9-]{0,63}$/u.test(entry.name)) continue;
    const skillPath = path.join(root, entry.name, "SKILL.md");
    let content: string;
    try {
      content = await readFile(skillPath, "utf8");
    } catch (error) {
      if (isNotFound(error)) continue;
      throw new PluginError(
        `Could not read portable skill ${skillPath}.`,
        skillPath,
        { cause: error },
      );
    }
    if (Buffer.byteLength(content) > 32_768) {
      throw new PluginError(
        `Portable skill ${skillPath} exceeds 32768 bytes.`,
        skillPath,
      );
    }
    skills.push({ name: entry.name, path: skillPath, content });
  }
  return skills.sort((left, right) => left.name.localeCompare(right.name));
}

export function selectPortableSkills(
  prompt: string,
  skills: readonly PortableSkill[],
): readonly PortableSkill[] {
  return skills.filter((skill) =>
    new RegExp(
      `(^|\\s)\\$${escapeRegExp(skill.name)}(?=\\s|$|[.,:;!?])`,
      "u",
    ).test(prompt),
  );
}

export async function resolvePluginEntry(
  plugin: DiscoveredPlugin,
): Promise<string> {
  const directory = await realpath(plugin.directory);
  const candidate = await realpath(
    path.resolve(directory, plugin.manifest.entry),
  );
  const relative = path.relative(directory, candidate);
  if (
    relative === "" ||
    relative === ".." ||
    relative.startsWith(`..${path.sep}`) ||
    path.isAbsolute(relative)
  ) {
    throw new PluginError(
      `Plugin entry escapes its plugin directory: ${plugin.manifestPath}.`,
      plugin.manifestPath,
    );
  }
  if (!/\.(?:cjs|js|mjs)$/u.test(candidate)) {
    throw new PluginError(
      `Plugin entry must be executable JavaScript (.js, .mjs, or .cjs): ${candidate}.`,
      plugin.manifestPath,
    );
  }
  return candidate;
}

async function readDirectories(root: string): Promise<readonly Dirent[]> {
  try {
    const entries = await readdir(root, { withFileTypes: true });
    return entries.filter(
      (entry) => entry.isDirectory() && !entry.isSymbolicLink(),
    );
  } catch (error) {
    if (isNotFound(error)) return [];
    throw new PluginError(
      `Could not inspect plugin resource directory ${root}.`,
      root,
      { cause: error },
    );
  }
}

async function readJson(sourcePath: string): Promise<unknown> {
  try {
    return JSON.parse(await readFile(sourcePath, "utf8"));
  } catch (error) {
    throw new PluginError(
      `Could not parse plugin manifest ${sourcePath}.`,
      sourcePath,
      { cause: error },
    );
  }
}

function validateRelativeEntry(
  entry: string,
  directory: string,
  manifestPath: string,
): void {
  if (path.isAbsolute(entry)) {
    throw new PluginError(
      "Plugin entry must be relative to the plugin directory.",
      manifestPath,
    );
  }
  const resolved = path.resolve(directory, entry);
  const relative = path.relative(directory, resolved);
  if (
    relative === ".." ||
    relative.startsWith(`..${path.sep}`) ||
    path.isAbsolute(relative)
  ) {
    throw new PluginError(
      "Plugin entry must stay inside the plugin directory.",
      manifestPath,
    );
  }
}

function isNotFound(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === "ENOENT"
  );
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}
