import {
  ForgeConfigError,
  loadForgeConfig,
  setUserSkillModelInvocation,
} from "@forge/config";
import { discoverSkillCatalog } from "@forge/resources";

import type { WritableOutput } from "./ask.js";

export interface ResourcesCommandDependencies {
  readonly cwd: string;
  readonly env: NodeJS.ProcessEnv;
  readonly stdout: WritableOutput;
  readonly stderr: WritableOutput;
}

export async function runResourcesCommand(
  mode: "list" | "disable" | "enable",
  name: string | undefined,
  dependencies: ResourcesCommandDependencies,
): Promise<number> {
  try {
    const loaded = await loadForgeConfig({
      cwd: dependencies.cwd,
      env: dependencies.env,
    });
    const catalog = await discoverSkillCatalog({
      forgeHome: loaded.forgeHome,
      workspaceRoot: loaded.workspaceRoot,
      disabledModelInvocation: loaded.config.resources.disabledModelInvocation,
    });
    if (mode === "list") {
      dependencies.stdout.write(formatResourceList(catalog));
      return 0;
    }
    if (!name || !/^[a-z0-9][a-z0-9-]{0,63}$/u.test(name)) {
      dependencies.stderr.write("A valid Skill name is required.\n");
      return 2;
    }
    const skill = catalog.skills.find((candidate) => candidate.name === name);
    if (!skill) {
      dependencies.stderr.write(`Skill "${name}" was not discovered.\n`);
      return 2;
    }
    if (mode === "enable" && skill.invocation === "explicit-only") {
      dependencies.stderr.write(
        `Skill "${name}" declares disable-model-invocation and remains explicit-only.\n`,
      );
      return 2;
    }
    const configPath = await setUserSkillModelInvocation({
      cwd: dependencies.cwd,
      env: dependencies.env,
      name,
      enabled: mode === "enable",
    });
    dependencies.stdout.write(
      `${mode === "enable" ? "Enabled" : "Disabled"} automatic model invocation for $${name} in ${configPath}. Explicit $${name} selection remains available.\n`,
    );
    return 0;
  } catch (error) {
    dependencies.stderr.write(
      `${error instanceof ForgeConfigError || error instanceof Error ? error.message : "Could not inspect resources."}\n`,
    );
    return 2;
  }
}

function formatResourceList(
  catalog: Awaited<ReturnType<typeof discoverSkillCatalog>>,
): string {
  const winners = new Map(catalog.skills.map((skill) => [skill.name, skill]));
  const lines = ["Skills:"];
  if (catalog.resources.length === 0) lines.push("  none");
  for (const skill of catalog.resources) {
    const winner = winners.get(skill.name);
    const shadowed = winner?.id !== skill.id;
    const status = shadowed
      ? `shadowed by ${winner?.source ?? "higher-priority source"}`
      : skill.invocation === "explicit-only"
        ? "explicit-only"
        : skill.modelInvocationEnabled
          ? "automatic"
          : "automatic disabled by user; explicit available";
    lines.push(`  $${skill.name} · ${skill.source} · ${status}`);
    lines.push(`    ${skill.description}`);
  }
  if (catalog.diagnostics.length > 0) {
    lines.push("Diagnostics:");
    for (const diagnostic of catalog.diagnostics)
      lines.push(
        `  [${diagnostic.code}/${diagnostic.source}] ${diagnostic.message}`,
      );
  }
  lines.push("");
  return lines.join("\n");
}
