import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { FORGE_VERSION } from "@forge/core";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  createUpdateService,
  detectInstallProvenance,
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
        provenance: "npm",
        install: async (packageName, version, env) => {
          const { PATH } = env;
          received = `${packageName}@${version}:${PATH}`;
          return 0;
        },
      },
    );

    expect(exitCode).toBe(0);
    expect(received).toBe(`${FORGE_NPM_PACKAGE}@9.1.0-beta.1:/test/bin`);
    expect(stdout.value).toContain("restart Forge");
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
    await Promise.all(backgroundTasks.splice(0));
    await maybeNotifyUpdate({
      env: { FORGE_HOME: forgeHome, FORGE_DISABLE_UPDATE_CHECK: "1" },
      stderr,
      isTTY: true,
      fetch,
      now: () => new Date(now.getTime() + 120_000),
      schedule: (task) => backgroundTasks.push(task),
    });

    expect(fetches).toBe(1);
    expect(stderr.value.match(/Forge 9\.0\.0 is available/gu)).toHaveLength(2);
    expect(backgroundTasks).toHaveLength(0);
    const cache = JSON.parse(
      await readFile(path.join(forgeHome, "update-check.json"), "utf8"),
    );
    expect(cache).toEqual({
      schemaVersion: 2,
      checkedAt: now.toISOString(),
      latestVersion: "9.0.0",
    });
  });

  it("publishes late refreshing and available states and persists dismissal", async () => {
    const forgeHome = await makeTemporaryDirectory();
    let resolveFetch: ((response: Response) => void) | undefined;
    const fetch = (() =>
      new Promise<Response>((resolve) => {
        resolveFetch = resolve;
      })) as typeof globalThis.fetch;
    const service = createUpdateService({
      env: { FORGE_HOME: forgeHome },
      isTTY: true,
      fetch,
      now: () => new Date("2026-08-28T00:00:00.000Z"),
    });
    const states: string[] = [];
    service.subscribe((state) => states.push(state.state));
    const started = service.start();
    await vi.waitFor(() => expect(states).toContain("refreshing"));
    resolveFetch?.(Response.json({ version: "9.0.0" }));
    await started;
    expect(service.snapshot()).toMatchObject({
      state: "available",
      latestVersion: "9.0.0",
      dismissed: false,
    });

    await service.dismiss("9.0.0");
    expect(service.snapshot().dismissed).toBe(true);
    const restored = createUpdateService({
      env: { FORGE_HOME: forgeHome },
      isTTY: true,
      fetch: registryFetch("10.0.0"),
      now: () => new Date("2026-08-28T00:01:00.000Z"),
    });
    await restored.start();
    expect(restored.snapshot()).toMatchObject({
      state: "available",
      latestVersion: "9.0.0",
      dismissed: true,
    });
  });

  it("bounds malformed results and disables startup checks in CI", async () => {
    const forgeHome = await makeTemporaryDirectory();
    let fetches = 0;
    const malformed = createUpdateService({
      env: { FORGE_HOME: forgeHome },
      isTTY: true,
      fetch: registryFetch("latest"),
    });
    await malformed.start();
    expect(malformed.snapshot()).toMatchObject({ state: "failed" });

    const disabled = createUpdateService({
      env: { FORGE_HOME: forgeHome, CI: "true" },
      isTTY: true,
      fetch: (async () => {
        fetches += 1;
        return Response.json({ version: "9.0.0" });
      }) as typeof globalThis.fetch,
    });
    await disabled.start();
    expect(disabled.snapshot().state).toBe("disabled");
    expect(fetches).toBe(0);
  });

  it("bounds a startup registry timeout", async () => {
    const forgeHome = await makeTemporaryDirectory();
    let markStarted: (() => void) | undefined;
    const fetchStarted = new Promise<void>((resolve) => {
      markStarted = resolve;
    });
    vi.useFakeTimers();
    try {
      const service = createUpdateService({
        env: { FORGE_HOME: forgeHome },
        isTTY: true,
        fetch: ((_url, init) =>
          new Promise<Response>((_resolve, reject) => {
            markStarted?.();
            init?.signal?.addEventListener(
              "abort",
              () => reject(new DOMException("aborted", "AbortError")),
              { once: true },
            );
          })) as typeof globalThis.fetch,
      });
      const started = service.start();
      await fetchStarted;
      await vi.advanceTimersByTimeAsync(3_001);
      await started;
      expect(service.snapshot()).toMatchObject({
        state: "failed",
        message: "npm registry request timed out",
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it("detects npm and pnpm provenance and refuses unknown installation", async () => {
    expect(
      detectInstallProvenance({ npm_config_user_agent: "pnpm/10" }, ""),
    ).toBe("pnpm");
    expect(
      detectInstallProvenance(
        {},
        "/usr/local/lib/node_modules/forge/dist/index.js",
      ),
    ).toBe("npm");
    let installed = false;
    const stdout = captureOutput();
    const stderr = captureOutput();
    const exitCode = await runUpdateCommand(
      "install",
      { target: "latest" },
      {},
      {
        stdout,
        stderr,
        fetch: registryFetch("9.0.0"),
        provenance: "unknown",
        install: async () => {
          installed = true;
          return 0;
        },
      },
    );
    expect(exitCode).toBe(2);
    expect(installed).toBe(false);
    expect(stderr.value).toContain("could not identify");
  });

  it("does not modify protected Forge home data during check, dismissal, or failed install", async () => {
    const forgeHome = await makeTemporaryDirectory();
    const protectedFiles = [
      "auth.json",
      "config.json",
      "sessions/session.json",
      "traces/run.jsonl",
      "plugins/example/plugin.json",
    ];
    for (const relativePath of protectedFiles) {
      const target = path.join(forgeHome, relativePath);
      await mkdir(path.dirname(target), { recursive: true });
      await writeFile(target, `protected:${relativePath}`);
    }
    const service = createUpdateService({
      env: { FORGE_HOME: forgeHome },
      isTTY: true,
      fetch: registryFetch("9.0.0"),
    });
    await service.start();
    await service.dismiss("9.0.0");
    await runUpdateCommand(
      "install",
      { target: "9.0.0" },
      { FORGE_HOME: forgeHome },
      {
        stdout: captureOutput(),
        stderr: captureOutput(),
        fetch: registryFetch("9.0.0"),
        provenance: "npm",
        install: async () => 7,
      },
    );
    await runUpdateCommand(
      "install",
      { target: "9.0.0" },
      { FORGE_HOME: forgeHome },
      {
        stdout: captureOutput(),
        stderr: captureOutput(),
        fetch: registryFetch("9.0.0"),
        provenance: "pnpm",
        install: async () => 0,
      },
    );
    for (const relativePath of protectedFiles) {
      expect(await readFile(path.join(forgeHome, relativePath), "utf8")).toBe(
        `protected:${relativePath}`,
      );
    }
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
