import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import { FORGE_VERSION } from "@forge/core";
import { describe, expect, it } from "vitest";

import { createProgram } from "./program.js";

const cliPath = fileURLToPath(new URL("../dist/index.js", import.meta.url));

describe("Forge CLI", () => {
  it("exposes its name and version", () => {
    const program = createProgram();

    expect(program.name()).toBe("forge");
    expect(program.version()).toBe(FORGE_VERSION);
  });

  it("runs the compiled version command", () => {
    const output = execFileSync(process.execPath, [cliPath, "--version"], {
      encoding: "utf8",
    });

    expect(output.trim()).toBe(FORGE_VERSION);
  });
});
