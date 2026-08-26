import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { FORGE_VERSION } from "@forge/core";
import { afterEach, describe, expect, it } from "vitest";

import {
  FORGE_NPM_PACKAGE,
  maybeNotifyUpdate,
  runUpdateCommand,
} from "./update.js";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe("Forge npm updates", () => {
  it("reports a newer stable version without installing it", async () => {
    const stdout = captureOutput();
    const stderr = captureOutput();
    let installed = false;

    const exitCode = await runUpdateCommand(
      "check",
      { target: "latest" },
      {},
      {
        stdout,
        stderr,
        fetch: registryFetch("9.0.0"),
        install: async () => {
          installed = true;
          return 0;
        },
      },
    );

    expect(exitCode).toBe(0);
    expect(stdout.value).toContain(`${FORGE_VERSION} -> 9.0.0`);
    expect(stderr.value).toBe("");
    expect(installed).toBe(false);
  });

  it("resolves a target to an exact version before invoking npm", async () => {
    const stdout = captureOutput();
    const stderr = captureOutput();
    let received: string | undefined;

    const exitCode = await runUpdateCommand(
      "install",
      { target: "next" },
      { PATH: "/test/bin" },
      {
        stdout,
        stderr,
        fetch: registryFetch("9.1.0-beta.1"),
        install: async (packageName, version, env) => {
          const { PATH } = env;
          received = `${packageName}@${version}:${PATH}`;
          return 0;
        },
      },
    );

    expect(exitCode).toBe(0);
    expect(received).toBe(`${FORGE_NPM_PACKAGE}@9.1.0-beta.1:/test/bin`);
    expect(stdout.value).toContain("Restart Forge");
    expect(stderr.value).toBe("");
  });

  it("rejects malformed registry versions and unsafe targets", async () => {
    const stdout = captureOutput();
    const stderr = captureOutput();

    const malformed = await runUpdateCommand(
      "check",
      { target: "latest" },
      {},
      { stdout, stderr, fetch: registryFetch("latest") },
    );
    const unsafe = await runUpdateCommand(
      "install",
      { target: "latest;whoami" },
      {},
      { stdout, stderr, fetch: registryFetch("9.0.0") },
    );

    expect(malformed).toBe(2);
    expect(unsafe).toBe(2);
    expect(stderr.value).toContain("invalid package version");
    expect(stderr.value).toContain("invalid npm version or dist-tag");
  });

  it("caches advisory startup checks and honors the opt-out", async () => {
    const forgeHome = await makeTemporaryDirectory();
    const stderr = captureOutput();
    let fetches = 0;
    const fetch = async () => {
      fetches += 1;
      return Response.json({ version: "9.0.0" });
    };
    const now = new Date("2026-08-25T12:00:00.000Z");
    const backgroundTasks: Promise<void>[] = [];

    await maybeNotifyUpdate({
      env: { FORGE_HOME: forgeHome },
      stderr,
      isTTY: true,
      fetch,
      now: () => now,
      schedule: (task) => backgroundTasks.push(task),
    });
    expect(stderr.value).toBe("");
    await Promise.all(backgroundTasks.splice(0));
    await maybeNotifyUpdate({
      env: { FORGE_HOME: forgeHome },
      stderr,
      isTTY: true,
      fetch,
      now: () => new Date(now.getTime() + 60_000),
      schedule: (task) => backgroundTasks.push(task),
    });
    await maybeNotifyUpdate({
      env: { FORGE_HOME: forgeHome, FORGE_DISABLE_UPDATE_CHECK: "1" },
      stderr,
      isTTY: true,
      fetch,
      now: () => new Date(now.getTime() + 120_000),
      schedule: (task) => backgroundTasks.push(task),
    });

    expect(fetches).toBe(1);
    expect(stderr.value.match(/Forge 9\.0\.0 is available/gu)).toHaveLength(1);
    expect(backgroundTasks).toHaveLength(0);
    const cache = JSON.parse(
      await readFile(path.join(forgeHome, "update-check.json"), "utf8"),
    );
    expect(cache).toEqual({
      schemaVersion: 1,
      checkedAt: now.toISOString(),
      latestVersion: "9.0.0",
    });
  });
});

function registryFetch(version: string): typeof globalThis.fetch {
  return (async () => Response.json({ version })) as typeof globalThis.fetch;
}

function captureOutput(): { value: string; write(text: string): void } {
  return {
    value: "",
    write(text: string) {
      this.value += text;
    },
  };
}

async function makeTemporaryDirectory(): Promise<string> {
  const directory = await mkdtemp(path.join(os.tmpdir(), "forge-update-test-"));
  temporaryDirectories.push(directory);
  return directory;
}
