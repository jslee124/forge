import {
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  changeProjectPluginTrust,
  detectStartupResources,
} from "./startup-resources.js";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe("interactive startup resource discovery", () => {
  it("shows enabled user plugins, project trust state, and portable skills without importing entries", async () => {
    const workspaceRoot = await mkdtemp(
      path.join(tmpdir(), "forge-startup-resources-"),
    );
    temporaryDirectories.push(workspaceRoot);
    const forgeHome = path.join(workspaceRoot, "forge-home");
    const marker = path.join(workspaceRoot, "plugin-executed.txt");
    await mkdir(path.join(workspaceRoot, ".git"), { recursive: true });
    await createPlugin(
      path.join(forgeHome, "plugins", "user-tool"),
      "user-tool",
      marker,
    );
    await createPlugin(
      path.join(workspaceRoot, ".forge", "plugins", "project-tool"),
      "project-tool",
      marker,
    );
    const skillDirectory = path.join(
      workspaceRoot,
      ".agents",
      "skills",
      "review",
    );
    await mkdir(skillDirectory, { recursive: true });
    await writeFile(
      path.join(skillDirectory, "SKILL.md"),
      "---\nname: review\ndescription: Review repository changes\n---\nReview changes.\n",
    );

    const untrusted = await detectStartupResources({
      forgeHome,
      workspaceRoot,
      enabledUserPlugins: ["user-tool"],
    });

    expect(untrusted).toEqual({
      plugins: [
        {
          name: "user-tool",
          version: "1.0.0",
          scope: "user",
          state: "enabled",
          capabilities: [],
        },
        {
          name: "project-tool",
          version: "1.0.0",
          scope: "project",
          state: "untrusted",
          capabilities: [],
        },
      ],
      skills: [
        {
          name: "forge-plugin-creator",
          path: expect.stringContaining(
            "resources/skills/forge-plugin-creator/SKILL.md",
          ),
          source: "builtin",
          invocation: "model",
        },
        {
          name: "review",
          path: await realpath(path.join(skillDirectory, "SKILL.md")),
          source: "project",
          invocation: "model",
        },
      ],
    });
    await expect(readFile(marker)).rejects.toMatchObject({
      code: "ENOENT",
    });

    const trusted = await changeProjectPluginTrust({
      cwd: workspaceRoot,
      env: { FORGE_HOME: forgeHome },
      trusted: true,
    });
    expect(
      trusted.plugins.find(({ name }) => name === "project-tool")?.state,
    ).toBe("trusted");
    const revoked = await changeProjectPluginTrust({
      cwd: workspaceRoot,
      env: { FORGE_HOME: forgeHome },
      trusted: false,
    });
    expect(
      revoked.plugins.find(({ name }) => name === "project-tool")?.state,
    ).toBe("untrusted");
    await expect(readFile(marker)).rejects.toMatchObject({ code: "ENOENT" });
  });
});

async function createPlugin(
  directory: string,
  name: string,
  marker: string,
): Promise<void> {
  await mkdir(directory, { recursive: true });
  await writeFile(
    path.join(directory, "plugin.json"),
    JSON.stringify({
      schemaVersion: 1,
      apiVersion: "1",
      name,
      version: "1.0.0",
      entry: "./index.mjs",
      capabilities: [],
    }),
  );
  await writeFile(
    path.join(directory, "index.mjs"),
    `import { writeFileSync } from "node:fs"; writeFileSync(${JSON.stringify(marker)}, "executed"); export default () => {};\n`,
  );
}
