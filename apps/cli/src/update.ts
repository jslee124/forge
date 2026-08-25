import { spawn } from "node:child_process";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";

import { resolveForgeHome } from "@forge/auth";
import { FORGE_VERSION } from "@forge/core";

export const FORGE_NPM_PACKAGE = "@jslee124/forge";

const NPM_REGISTRY = "https://registry.npmjs.org/";
const CHECK_INTERVAL_MS = 24 * 60 * 60 * 1_000;
const FOREGROUND_TIMEOUT_MS = 5_000;
const STARTUP_TIMEOUT_MS = 3_000;

interface WritableOutput {
  write(text: string): unknown;
}

interface RegistryVersion {
  readonly version: string;
}

interface UpdateCache {
  readonly schemaVersion: 1;
  readonly checkedAt: string;
  readonly latestVersion: string;
}

export interface UpdateCommandDependencies {
  readonly stdout: WritableOutput;
  readonly stderr: WritableOutput;
  readonly fetch?: typeof globalThis.fetch;
  readonly install?: (
    packageName: string,
    version: string,
    env: NodeJS.ProcessEnv,
  ) => Promise<number>;
}

export interface UpdateNotificationDependencies {
  readonly env: NodeJS.ProcessEnv;
  readonly stderr: WritableOutput;
  readonly isTTY: boolean;
  readonly fetch?: typeof globalThis.fetch;
  readonly now?: () => Date;
  readonly schedule?: (task: Promise<void>) => void;
}

export async function runUpdateCommand(
  mode: "check" | "install",
  options: { readonly target?: string },
  env: NodeJS.ProcessEnv,
  dependencies: UpdateCommandDependencies,
): Promise<number> {
  const target = options.target?.trim() || "latest";
  if (!isSafeTarget(target)) {
    dependencies.stderr.write(
      `Update error: invalid npm version or dist-tag "${target}".\n`,
    );
    return 2;
  }

  let resolvedVersion: string;
  try {
    resolvedVersion = await fetchRegistryVersion(
      target,
      dependencies.fetch ?? globalThis.fetch,
      FOREGROUND_TIMEOUT_MS,
    );
  } catch (error) {
    dependencies.stderr.write(
      `Update error: ${error instanceof Error ? error.message : "could not query npm"}.\n`,
    );
    return 2;
  }

  const comparison = compareSemver(resolvedVersion, FORGE_VERSION);
  if (mode === "check") {
    dependencies.stdout.write(
      comparison > 0
        ? `Update available: ${FORGE_VERSION} -> ${resolvedVersion}. Run \`forge update\`.\n`
        : `Forge ${FORGE_VERSION} is up to date for npm target "${target}".\n`,
    );
    return 0;
  }

  if (target === "latest" && comparison <= 0) {
    dependencies.stdout.write(
      `Forge ${FORGE_VERSION} is already up to date.\n`,
    );
    return 0;
  }

  const install = dependencies.install ?? installNpmVersion;
  const exitCode = await install(FORGE_NPM_PACKAGE, resolvedVersion, env);
  if (exitCode !== 0) {
    dependencies.stderr.write(
      `Update error: npm exited with code ${exitCode}; Forge ${FORGE_VERSION} remains the running version.\n`,
    );
    return exitCode;
  }
  dependencies.stdout.write(
    `Installed ${FORGE_NPM_PACKAGE}@${resolvedVersion}. Restart Forge to use it.\n`,
  );
  return 0;
}

export async function maybeNotifyUpdate(
  dependencies: UpdateNotificationDependencies,
): Promise<void> {
  const { CI, FORGE_DISABLE_UPDATE_CHECK } = dependencies.env;
  if (
    !dependencies.isTTY ||
    CI !== undefined ||
    FORGE_DISABLE_UPDATE_CHECK === "1"
  ) {
    return;
  }

  const now = (dependencies.now ?? (() => new Date()))();
  const forgeHome = resolveForgeHome(dependencies.env);
  const cachePath = path.join(forgeHome, "update-check.json");
  const cached = await readUpdateCache(cachePath);
  if (cached) writeUpdateNotice(cached.latestVersion, dependencies.stderr);
  if (
    cached &&
    now.getTime() - Date.parse(cached.checkedAt) < CHECK_INTERVAL_MS
  ) {
    return;
  }

  const refresh = refreshUpdateCache(
    cachePath,
    now,
    dependencies.fetch ?? globalThis.fetch,
  ).catch(() => undefined);
  (dependencies.schedule ?? ((task) => void task))(refresh);
}

async function refreshUpdateCache(
  cachePath: string,
  now: Date,
  fetchImplementation: typeof globalThis.fetch,
): Promise<void> {
  const latestVersion = await fetchRegistryVersion(
    "latest",
    fetchImplementation,
    STARTUP_TIMEOUT_MS,
  );
  await writeUpdateCache(cachePath, {
    schemaVersion: 1,
    checkedAt: now.toISOString(),
    latestVersion,
  });
}

async function fetchRegistryVersion(
  target: string,
  fetchImplementation: typeof globalThis.fetch,
  timeoutMs: number,
): Promise<string> {
  if (typeof fetchImplementation !== "function") {
    throw new Error("this Node.js runtime does not provide fetch");
  }
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  timeout.unref();
  const encodedPackage = encodeURIComponent(FORGE_NPM_PACKAGE);
  const url = new URL(
    `${encodedPackage}/${encodeURIComponent(target)}`,
    NPM_REGISTRY,
  );
  try {
    const response = await fetchImplementation(url, {
      headers: {
        accept: "application/json",
        "user-agent": `forge/${FORGE_VERSION}`,
      },
      redirect: "error",
      signal: controller.signal,
    });
    if (!response.ok) {
      throw new Error(`npm registry returned HTTP ${response.status}`);
    }
    const value = (await response.json()) as Partial<RegistryVersion>;
    if (typeof value.version !== "string" || !parseSemver(value.version)) {
      throw new Error("npm registry returned an invalid package version");
    }
    return value.version;
  } finally {
    clearTimeout(timeout);
  }
}

function installNpmVersion(
  packageName: string,
  version: string,
  env: NodeJS.ProcessEnv,
): Promise<number> {
  const command = process.platform === "win32" ? "npm.cmd" : "npm";
  return new Promise((resolve) => {
    const child = spawn(
      command,
      ["install", "--global", "--ignore-scripts", `${packageName}@${version}`],
      { env, shell: false, stdio: "inherit" },
    );
    child.once("error", () => resolve(127));
    child.once("exit", (code) => resolve(code ?? 1));
  });
}

async function readUpdateCache(
  cachePath: string,
): Promise<UpdateCache | undefined> {
  try {
    const value = JSON.parse(
      await readFile(cachePath, "utf8"),
    ) as Partial<UpdateCache>;
    if (
      value.schemaVersion !== 1 ||
      typeof value.checkedAt !== "string" ||
      !Number.isFinite(Date.parse(value.checkedAt)) ||
      typeof value.latestVersion !== "string" ||
      !parseSemver(value.latestVersion)
    ) {
      return undefined;
    }
    return value as UpdateCache;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    return undefined;
  }
}

async function writeUpdateCache(
  cachePath: string,
  cache: UpdateCache,
): Promise<void> {
  await mkdir(path.dirname(cachePath), { recursive: true, mode: 0o700 });
  const temporaryPath = `${cachePath}.${process.pid}.tmp`;
  await writeFile(temporaryPath, `${JSON.stringify(cache, null, 2)}\n`, {
    mode: 0o600,
  });
  await rename(temporaryPath, cachePath);
}

function writeUpdateNotice(version: string, stderr: WritableOutput): void {
  if (compareSemver(version, FORGE_VERSION) <= 0) return;
  stderr.write(
    `Forge ${version} is available (current ${FORGE_VERSION}). Run \`forge update\` to install it.\n`,
  );
}

function isSafeTarget(target: string): boolean {
  return (
    parseSemver(target) !== undefined ||
    /^[a-z][a-z0-9._-]{0,31}$/u.test(target)
  );
}

function compareSemver(left: string, right: string): number {
  const parsedLeft = parseSemver(left);
  const parsedRight = parseSemver(right);
  if (!parsedLeft || !parsedRight) throw new Error("Invalid semantic version.");
  for (const key of ["major", "minor", "patch"] as const) {
    if (parsedLeft[key] !== parsedRight[key]) {
      return parsedLeft[key] > parsedRight[key] ? 1 : -1;
    }
  }
  if (parsedLeft.prerelease === parsedRight.prerelease) return 0;
  if (parsedLeft.prerelease === undefined) return 1;
  if (parsedRight.prerelease === undefined) return -1;
  return comparePrerelease(parsedLeft.prerelease, parsedRight.prerelease);
}

function comparePrerelease(left: string, right: string): number {
  const leftParts = left.split(".");
  const rightParts = right.split(".");
  const length = Math.max(leftParts.length, rightParts.length);
  for (let index = 0; index < length; index += 1) {
    const leftPart = leftParts[index];
    const rightPart = rightParts[index];
    if (leftPart === rightPart) continue;
    if (leftPart === undefined) return -1;
    if (rightPart === undefined) return 1;
    const leftNumeric = /^\d+$/u.test(leftPart);
    const rightNumeric = /^\d+$/u.test(rightPart);
    if (leftNumeric && rightNumeric) {
      return Number(leftPart) > Number(rightPart) ? 1 : -1;
    }
    if (leftNumeric !== rightNumeric) return leftNumeric ? -1 : 1;
    return leftPart > rightPart ? 1 : -1;
  }
  return 0;
}

function parseSemver(version: string):
  | {
      readonly major: number;
      readonly minor: number;
      readonly patch: number;
      readonly prerelease: string | undefined;
    }
  | undefined {
  const match =
    /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/u.exec(
      version,
    );
  if (!match) return undefined;
  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
    prerelease: match[4],
  };
}
