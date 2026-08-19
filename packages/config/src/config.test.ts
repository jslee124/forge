import { mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { loadForgeConfig, loadInstructions } from "./index.js";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

async function fixture(): Promise<{
  root: string;
  nested: string;
  forgeHome: string;
}> {
  const root = await mkdtemp(path.join(tmpdir(), "forge-config-"));
  temporaryDirectories.push(root);
  const nested = path.join(root, "packages", "example");
  const forgeHome = path.join(root, "user-home");
  await Promise.all([
    mkdir(path.join(root, ".git")),
    mkdir(path.join(root, ".forge")),
    mkdir(nested, { recursive: true }),
    mkdir(forgeHome),
  ]);
  return { root, nested, forgeHome };
}

describe("Forge configuration", () => {
  it("merges sources with provenance while project limits only become stricter", async () => {
    const { root, nested, forgeHome } = await fixture();
    await writeFile(
      path.join(forgeHome, "config.json"),
      JSON.stringify({
        schemaVersion: 1,
        model: { id: "user-model" },
        permissionProfile: "workspace-write",
        limits: { maxSteps: 8, maxToolCalls: 20 },
      }),
    );
    await writeFile(
      path.join(root, ".forge", "config.json"),
      JSON.stringify({
        schemaVersion: 1,
        limits: { maxSteps: 10, maxToolCalls: 5 },
      }),
    );

    const loaded = await loadForgeConfig({
      cwd: nested,
      env: { FORGE_HOME: forgeHome, FORGE_THINKING: "disabled" },
      cli: { model: "cli-model" },
    });

    expect(loaded.workspaceRoot).toBe(await realpath(root));
    expect(loaded.config).toMatchObject({
      model: { id: "cli-model", thinking: "disabled" },
      permissionProfile: "workspace-write",
      limits: { maxSteps: 8, maxToolCalls: 5 },
    });
    expect(loaded.provenance["limits.maxSteps"].kind).toBe("user");
    expect(loaded.provenance["limits.maxToolCalls"].kind).toBe("project");
    expect(loaded.provenance["model.id"].kind).toBe("cli");
  });

  it("rejects project attempts to select a permission profile", async () => {
    const { root, nested, forgeHome } = await fixture();
    const sourcePath = path.join(root, ".forge", "config.json");
    await writeFile(
      sourcePath,
      JSON.stringify({
        schemaVersion: 1,
        permissionProfile: "workspace-write",
      }),
    );

    await expect(
      loadForgeConfig({ cwd: nested, env: { FORGE_HOME: forgeHome } }),
    ).rejects.toMatchObject({
      sourcePath: await realpath(sourcePath),
      code: "FORGE_CONFIG_ERROR",
    });
  });

  it("loads enabled plugins only from user configuration", async () => {
    const { root, nested, forgeHome } = await fixture();
    await writeFile(
      path.join(forgeHome, "config.json"),
      JSON.stringify({
        schemaVersion: 1,
        plugins: { enabled: ["custom-tool"] },
      }),
    );

    const loaded = await loadForgeConfig({
      cwd: nested,
      env: { FORGE_HOME: forgeHome },
    });

    expect(loaded.config.plugins.enabled).toEqual(["custom-tool"]);
    expect(loaded.provenance["plugins.enabled"].kind).toBe("user");

    await writeFile(
      path.join(root, ".forge", "config.json"),
      JSON.stringify({
        schemaVersion: 1,
        plugins: { enabled: ["project-plugin"] },
      }),
    );
    await expect(
      loadForgeConfig({ cwd: nested, env: { FORGE_HOME: forgeHome } }),
    ).rejects.toThrow(/plugins may only be set by the user/u);
  });

  it("loads user and root-to-leaf instructions with override preference", async () => {
    const { root, nested, forgeHome } = await fixture();
    await Promise.all([
      writeFile(path.join(forgeHome, "AGENTS.md"), "user instruction"),
      writeFile(path.join(root, "AGENTS.md"), "root instruction"),
      writeFile(path.join(root, "packages", "AGENTS.md"), "ignored regular"),
      writeFile(
        path.join(root, "packages", "AGENTS.override.md"),
        "package override",
      ),
      writeFile(path.join(nested, "AGENTS.md"), "leaf instruction"),
    ]);

    const loaded = await loadForgeConfig({
      cwd: nested,
      env: { FORGE_HOME: forgeHome },
    });
    const instructions = await loadInstructions(loaded);

    expect(instructions.files.map((file) => path.basename(file.path))).toEqual([
      "AGENTS.md",
      "AGENTS.md",
      "AGENTS.override.md",
      "AGENTS.md",
    ]);
    expect(instructions.files.map((file) => file.content)).toEqual([
      "user instruction",
      "root instruction",
      "package override",
      "leaf instruction",
    ]);
    expect(instructions.prompt).not.toContain("ignored regular");
  });
});
