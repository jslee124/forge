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

import { runPluginsCommand } from "./plugins-command.js";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe("plugins command", () => {
  it("records project trust against the canonical root from a subdirectory", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "forge-plugin-command-"));
    temporaryDirectories.push(root);
    const nested = path.join(root, "src", "nested");
    const forgeHome = path.join(root, "home");
    const plugin = path.join(root, ".forge", "plugins", "example");
    await mkdir(path.join(root, ".git"), { recursive: true });
    await mkdir(nested, { recursive: true });
    await mkdir(plugin, { recursive: true });
    await writeFile(
      path.join(plugin, "plugin.json"),
      JSON.stringify({
        schemaVersion: 1,
        apiVersion: "1",
        name: "example",
        version: "1.0.0",
        entry: "./index.mjs",
        capabilities: [],
      }),
    );
    await writeFile(
      path.join(plugin, "index.mjs"),
      "export default () => {};\n",
    );
    let stdout = "";
    let stderr = "";

    const exitCode = await runPluginsCommand(
      "trust",
      { yes: true },
      {
        cwd: nested,
        env: { FORGE_HOME: forgeHome },
        stdout: { write: (text) => (stdout += text) },
        stderr: { write: (text) => (stderr += text) },
        isTTY: false,
      },
    );

    expect(exitCode).toBe(0);
    expect(stderr).toBe("");
    expect(stdout).toContain(root);
    const trust = JSON.parse(
      await readFile(path.join(forgeHome, "plugin-trust.json"), "utf8"),
    ) as { readonly trustedProjects: readonly string[] };
    expect(trust.trustedProjects).toEqual([await realpath(root)]);
  });
});
