import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { runResourcesCommand } from "./resources-command.js";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe("resources command", () => {
  it("lists provenance and stores automatic-disable state only in user config", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "forge-resources-command-"));
    temporaryDirectories.push(root);
    const forgeHome = path.join(root, "home");
    const skillDirectory = path.join(root, ".agents", "skills", "review");
    await mkdir(path.join(root, ".git"), { recursive: true });
    await mkdir(skillDirectory, { recursive: true });
    const skillPath = path.join(skillDirectory, "SKILL.md");
    const original =
      "---\nname: review\ndescription: Review repository changes\n---\nReview.\n";
    await writeFile(skillPath, original);
    let stdout = "";
    let stderr = "";
    const dependencies = {
      cwd: root,
      env: { FORGE_HOME: forgeHome },
      stdout: { write: (text: string) => (stdout += text) },
      stderr: { write: (text: string) => (stderr += text) },
    };

    expect(await runResourcesCommand("list", undefined, dependencies)).toBe(0);
    expect(stdout).toContain("$review · project · automatic");
    expect(await runResourcesCommand("disable", "review", dependencies)).toBe(
      0,
    );
    expect(
      JSON.parse(await readFile(path.join(forgeHome, "config.json"), "utf8")),
    ).toMatchObject({
      resources: { disabledModelInvocation: ["review"] },
    });
    expect(await readFile(skillPath, "utf8")).toBe(original);
    expect(await runResourcesCommand("enable", "review", dependencies)).toBe(0);
    expect(stderr).toBe("");
  });
});
