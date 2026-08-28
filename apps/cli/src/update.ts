import { spawn } from "node:child_process";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";

import { resolveForgeHome } from "@forge/auth";
import { FORGE_VERSION } from "@forge/core";

export const FORGE_NPM_PACKAGE = "@jslee124/forge";
export const FORGE_RELEASES_URL = "https://github.com/jslee124/forge/releases";

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
  readonly schemaVersion: 2;
  readonly checkedAt?: string;
  readonly latestVersion?: string;
  readonly dismissedVersion?: string;
}

export type UpdateStateKind =
  | "cached"
  | "refreshing"
  | "available"
  | "current"
  | "failed"
  | "disabled";

export interface UpdateState {
  readonly state: UpdateStateKind;
  readonly currentVersion: string;
  readonly latestVersion?: string;
  readonly source: "npm-registry";
  readonly checkedAt?: string;
  readonly dismissed: boolean;
  readonly message?: string;
}

export type InstallProvenance = "npm" | "pnpm" | "unknown";

export interface UpdateService {
  snapshot(): UpdateState;
  subscribe(listener: (state: UpdateState) => void): () => void;
  start(): Promise<void>;
  dismiss(version: string): Promise<void>;
}

export interface UpdateCommandDependencies {
  readonly stdout: WritableOutput;
  readonly stderr: WritableOutput;
  readonly fetch?: typeof globalThis.fetch;
  readonly provenance?: InstallProvenance;
  readonly executablePath?: string;
  readonly install?: (
    packageName: string,
    version: string,
    env: NodeJS.ProcessEnv,
    provenance: Exclude<InstallProvenance, "unknown">,
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

export interface UpdateServiceOptions {
  readonly env: NodeJS.ProcessEnv;
  readonly isTTY: boolean;
  readonly fetch?: typeof globalThis.fetch;
  readonly now?: () => Date;
}

export function createUpdateService(
  options: UpdateServiceOptions,
): UpdateService {
  const listeners = new Set<(state: UpdateState) => void>();
  const cachePath = path.join(
    resolveForgeHome(options.env),
    "update-check.json",
  );
  let cache: UpdateCache = { schemaVersion: 2 };
  let state = updateState("cached", cache);
  let started: Promise<void> | undefined;

  const publish = (next: UpdateState): void => {
    state = next;
    for (const listener of listeners) listener(next);
  };

  const start = async (): Promise<void> => {
    const variables = options.env as {
      readonly CI?: string;
      readonly FORGE_DISABLE_UPDATE_CHECK?: string;
    };
    const disabled =
      !options.isTTY ||
      variables.CI !== undefined ||
      variables.FORGE_DISABLE_UPDATE_CHECK === "1";
    if (disabled) {
      publish(updateState("disabled", cache));
      return;
    }
    cache = await readUpdateCache(cachePath);
    if (cache.latestVersion) publish(updateState("cached", cache));
    const now = (options.now ?? (() => new Date()))();
    if (
      cache.checkedAt &&
      now.getTime() - Date.parse(cache.checkedAt) < CHECK_INTERVAL_MS
    ) {
      publish(freshState(cache));
      return;
    }
    publish(updateState("refreshing", cache));
    try {
      const latestVersion = await fetchRegistryVersion(
        "latest",
        options.fetch ?? globalThis.fetch,
        STARTUP_TIMEOUT_MS,
      );
      cache = {
        ...cache,
        schemaVersion: 2,
        checkedAt: now.toISOString(),
        latestVersion,
      };
      await writeUpdateCache(cachePath, cache);
      publish(freshState(cache));
    } catch (error) {
      publish({
        ...updateState("failed", cache),
        message: boundedError(error),
      });
    }
  };

  return {
    snapshot: () => state,
    subscribe: (listener) => {
      listeners.add(listener);
      listener(state);
      return () => listeners.delete(listener);
    },
    start: () => {
      started ??= start();
      return started;
    },
    dismiss: async (version) => {
      if (!parseSemver(version)) return;
      cache = { ...cache, schemaVersion: 2, dismissedVersion: version };
      await writeUpdateCache(cachePath, cache);
      publish(freshState(cache));
    },
  };
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
    dependencies.stderr.write(`Update error: ${boundedError(error)}.\n`);
    return 2;
  }

  const comparison = compareSemver(resolvedVersion, FORGE_VERSION);
  if (mode === "check") {
    dependencies.stdout.write(
      comparison > 0
        ? `Update available: ${FORGE_VERSION} -> ${resolvedVersion}. Run \`forge update\`. Release notes: ${FORGE_RELEASES_URL}/tag/v${resolvedVersion}\n`
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

  const provenance =
    dependencies.provenance ??
    detectInstallProvenance(
      env,
      dependencies.executablePath ?? process.argv[1],
    );
  if (provenance === "unknown") {
    dependencies.stderr.write(
      `Update ${resolvedVersion} is available, but Forge could not identify an npm or pnpm global installation. Install it with the package manager you originally used. Release notes: ${FORGE_RELEASES_URL}/tag/v${resolvedVersion}\n`,
    );
    return 2;
  }
  const install = dependencies.install ?? installPackageVersion;
  const exitCode = await install(
    FORGE_NPM_PACKAGE,
    resolvedVersion,
    env,
    provenance,
  );
  if (exitCode !== 0) {
    dependencies.stderr.write(
      `Update error: ${provenance} exited with code ${exitCode}; Forge ${FORGE_VERSION} remains the running version.\n`,
    );
    return exitCode;
  }
  dependencies.stdout.write(
    `Installed ${FORGE_NPM_PACKAGE}@${resolvedVersion} with ${provenance}. The running process still uses ${FORGE_VERSION}; restart Forge to use the update.\n`,
  );
  return 0;
}

export async function maybeNotifyUpdate(
  dependencies: UpdateNotificationDependencies,
): Promise<void> {
  const variables = dependencies.env as {
    readonly CI?: string;
    readonly FORGE_DISABLE_UPDATE_CHECK?: string;
  };
  if (
    !dependencies.isTTY ||
    variables.CI !== undefined ||
    variables.FORGE_DISABLE_UPDATE_CHECK === "1"
  ) {
    return;
  }
  const service = createUpdateService(dependencies);
  let displayed: string | undefined;
  const unsubscribe = service.subscribe((state) => {
    if (
      state.state === "available" &&
      !state.dismissed &&
      state.latestVersion &&
      displayed !== state.latestVersion
    ) {
      displayed = state.latestVersion;
      dependencies.stderr.write(
        `Forge ${state.latestVersion} is available (current ${FORGE_VERSION}). Run \`forge update\` to install it.\n`,
      );
    }
  });
  const task = service.start().finally(unsubscribe);
  (dependencies.schedule ?? ((pending) => void pending))(task);
}

export function detectInstallProvenance(
  env: NodeJS.ProcessEnv,
  executablePath = process.argv[1] ?? "",
): InstallProvenance {
  const variables = env as { readonly npm_config_user_agent?: string };
  const userAgent = variables.npm_config_user_agent?.toLocaleLowerCase() ?? "";
  const location = executablePath.toLocaleLowerCase();
  if (userAgent.startsWith("pnpm/") || location.includes("/.pnpm/"))
    return "pnpm";
  if (
    userAgent.startsWith("npm/") ||
    location.includes("/lib/node_modules/") ||
    location.includes("\\node_modules\\")
  ) {
    return "npm";
  }
  return "unknown";
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
    if (!response.ok)
      throw new Error(`npm registry returned HTTP ${response.status}`);
    const value = (await response.json()) as Partial<RegistryVersion>;
    if (typeof value.version !== "string" || !parseSemver(value.version)) {
      throw new Error("npm registry returned an invalid package version");
    }
    return value.version;
  } finally {
    clearTimeout(timeout);
  }
}

function installPackageVersion(
  packageName: string,
  version: string,
  env: NodeJS.ProcessEnv,
  provenance: Exclude<InstallProvenance, "unknown">,
): Promise<number> {
  const command =
    process.platform === "win32" ? `${provenance}.cmd` : provenance;
  const args =
    provenance === "pnpm"
      ? ["add", "--global", "--ignore-scripts", `${packageName}@${version}`]
      : [
          "install",
          "--global",
          "--ignore-scripts",
          `${packageName}@${version}`,
        ];
  return new Promise((resolve) => {
    const child = spawn(command, args, { env, shell: false, stdio: "inherit" });
    child.once("error", () => resolve(127));
    child.once("exit", (code) => resolve(code ?? 1));
  });
}

async function readUpdateCache(cachePath: string): Promise<UpdateCache> {
  try {
    const value = JSON.parse(
      await readFile(cachePath, "utf8"),
    ) as Partial<UpdateCache>;
    const latestVersion =
      typeof value.latestVersion === "string" &&
      parseSemver(value.latestVersion)
        ? value.latestVersion
        : undefined;
    const checkedAt =
      typeof value.checkedAt === "string" &&
      Number.isFinite(Date.parse(value.checkedAt))
        ? value.checkedAt
        : undefined;
    const dismissedVersion =
      typeof value.dismissedVersion === "string" &&
      parseSemver(value.dismissedVersion)
        ? value.dismissedVersion
        : undefined;
    return {
      schemaVersion: 2,
      ...(checkedAt ? { checkedAt } : {}),
      ...(latestVersion ? { latestVersion } : {}),
      ...(dismissedVersion ? { dismissedVersion } : {}),
    };
  } catch {
    return { schemaVersion: 2 };
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

function freshState(cache: UpdateCache): UpdateState {
  if (!cache.latestVersion) return updateState("failed", cache);
  return updateState(
    compareSemver(cache.latestVersion, FORGE_VERSION) > 0
      ? "available"
      : "current",
    cache,
  );
}

function updateState(state: UpdateStateKind, cache: UpdateCache): UpdateState {
  return {
    state,
    currentVersion: FORGE_VERSION,
    source: "npm-registry",
    ...(cache.latestVersion ? { latestVersion: cache.latestVersion } : {}),
    ...(cache.checkedAt ? { checkedAt: cache.checkedAt } : {}),
    dismissed:
      cache.latestVersion !== undefined &&
      cache.dismissedVersion === cache.latestVersion,
  };
}

function boundedError(error: unknown): string {
  if (error instanceof DOMException && error.name === "AbortError") {
    return "npm registry request timed out";
  }
  return (error instanceof Error ? error.message : "could not query npm").slice(
    0,
    500,
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
    if (parsedLeft[key] !== parsedRight[key])
      return parsedLeft[key] > parsedRight[key] ? 1 : -1;
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
    if (leftNumeric && rightNumeric)
      return Number(leftPart) > Number(rightPart) ? 1 : -1;
    if (leftNumeric !== rightNumeric) return leftNumeric ? -1 : 1;
    return leftPart > rightPart ? 1 : -1;
  }
  return 0;
}

function parseSemver(value: string):
  | {
      readonly major: number;
      readonly minor: number;
      readonly patch: number;
      readonly prerelease?: string;
    }
  | undefined {
  const match =
    /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/u.exec(
      value,
    );
  if (!match) return undefined;
  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
    ...(match[4] ? { prerelease: match[4] } : {}),
  };
}
