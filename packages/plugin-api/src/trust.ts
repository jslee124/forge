import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";

import { z } from "zod";

import { PluginError } from "./discovery.js";

const trustSchema = z
  .object({
    schemaVersion: z.literal(1),
    trustedProjects: z.array(z.string()).default([]),
  })
  .strict();

export interface PluginTrustStore {
  readonly schemaVersion: 1;
  readonly trustedProjects: readonly string[];
}

export async function loadPluginTrust(
  forgeHome: string,
): Promise<PluginTrustStore> {
  const sourcePath = trustPath(forgeHome);
  try {
    return trustSchema.parse(JSON.parse(await readFile(sourcePath, "utf8")));
  } catch (error) {
    if (isNotFound(error)) return { schemaVersion: 1, trustedProjects: [] };
    throw new PluginError(
      `Could not read plugin trust store ${sourcePath}.`,
      sourcePath,
      { cause: error },
    );
  }
}

export async function isProjectTrusted(
  forgeHome: string,
  workspaceRoot: string,
): Promise<boolean> {
  const canonicalRoot = await import("node:fs/promises").then(({ realpath }) =>
    realpath(workspaceRoot),
  );
  const trust = await loadPluginTrust(forgeHome);
  return trust.trustedProjects.includes(canonicalRoot);
}

export async function trustProject(
  forgeHome: string,
  workspaceRoot: string,
): Promise<void> {
  const canonicalRoot = await import("node:fs/promises").then(({ realpath }) =>
    realpath(workspaceRoot),
  );
  const current = await loadPluginTrust(forgeHome);
  if (current.trustedProjects.includes(canonicalRoot)) return;
  await writeTrust(
    forgeHome,
    [...current.trustedProjects, canonicalRoot].sort(),
  );
}

export async function untrustProject(
  forgeHome: string,
  workspaceRoot: string,
): Promise<void> {
  const canonicalRoot = await import("node:fs/promises").then(({ realpath }) =>
    realpath(workspaceRoot),
  );
  const current = await loadPluginTrust(forgeHome);
  await writeTrust(
    forgeHome,
    current.trustedProjects.filter((candidate) => candidate !== canonicalRoot),
  );
}

async function writeTrust(
  forgeHome: string,
  trustedProjects: readonly string[],
): Promise<void> {
  await mkdir(forgeHome, { recursive: true, mode: 0o700 });
  const destination = trustPath(forgeHome);
  const temporary = `${destination}.${process.pid}.tmp`;
  await writeFile(
    temporary,
    `${JSON.stringify({ schemaVersion: 1, trustedProjects }, null, 2)}\n`,
    { mode: 0o600 },
  );
  await rename(temporary, destination);
}

function trustPath(forgeHome: string): string {
  return path.join(forgeHome, "plugin-trust.json");
}

function isNotFound(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === "ENOENT"
  );
}
