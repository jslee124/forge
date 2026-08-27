import { createHash } from "node:crypto";
import { constants } from "node:fs";
import { lstat, open, readdir, realpath, stat } from "node:fs/promises";
import path from "node:path";

import type { ForgeTool, ToolResult } from "@forge/core";
import { z } from "zod";

import { MAX_SKILL_FILE_BYTES } from "./catalog.js";
import type {
  LoadedSkillResource,
  SkillDescriptor,
  SkillFileIdentity,
} from "./types.js";

export const MAX_SKILL_LOADS = 8;
export const MAX_SKILL_LOAD_BYTES = 32_768;
export const MAX_SKILL_RELATED_RESOURCES = 32;

interface RegisteredResource {
  readonly id: string;
  readonly skill: SkillDescriptor;
  readonly canonicalPath: string;
  readonly relativePath: string;
  readonly identity: SkillFileIdentity;
}

type ToolFailure = Extract<ToolResult, { readonly ok: false }>;

export async function createLoadSkillTool(
  skills: readonly SkillDescriptor[],
  options: { readonly explicitlySelectedIds?: readonly string[] } = {},
): Promise<ForgeTool> {
  const registry = new Map<string, RegisteredResource>();
  for (const skill of skills) {
    registry.set(skill.id, {
      id: skill.id,
      skill,
      canonicalPath: skill.canonicalPath,
      relativePath: "SKILL.md",
      identity: skill.identity,
    });
    try {
      for (const resource of await discoverRelatedResources(skill)) {
        registry.set(resource.id, resource);
      }
    } catch {
      // Supporting resources are optional. The already-validated SKILL.md
      // remains loadable even when a hostile or unreadable nested directory
      // cannot be registered safely.
    }
  }
  const loaded = new Set<string>();
  let loadCount = 0;
  const explicitlySelected = new Set(options.explicitlySelectedIds ?? []);

  return {
    name: "load_skill",
    description:
      "Load one registered Skill or its registered supporting resource by opaque catalog id. It cannot read arbitrary paths and grants no permission.",
    inputSchema: z.object({ id: z.string().min(1).max(200) }).strict(),
    risk: "read",
    execute: async (
      input,
      context,
    ): Promise<ToolResult<LoadedSkillResource>> => {
      const { id } = input as { readonly id: string };
      const resource = registry.get(id);
      if (!resource)
        return failure("not_found", "Unknown Skill catalog identifier.");
      if (
        resource.skill.invocation === "explicit-only" &&
        !explicitlySelected.has(resource.skill.id)
      ) {
        return failure(
          "not_found",
          `Skill "${resource.skill.name}" is explicit-only and was not selected by the user.`,
        );
      }
      if (loaded.has(id))
        return failure(
          "limit_reached",
          `Skill resource "${id}" was already loaded in this run.`,
        );
      if (loadCount >= MAX_SKILL_LOADS)
        return failure(
          "limit_reached",
          `A run may load at most ${MAX_SKILL_LOADS} Skill resources.`,
        );
      const verified = await readVerifiedResource(resource);
      if (!verified.ok) return verified;
      const buffer = verified.buffer;
      let contentBytes = Math.min(MAX_SKILL_LOAD_BYTES, buffer.length);
      let content = buffer.subarray(0, contentBytes).toString("utf8");
      const allResources = [...registry.values()]
        .filter(
          (candidate) =>
            candidate.skill.id === resource.skill.id && candidate.id !== id,
        )
        .map(({ id: resourceId, relativePath }) => ({
          id: resourceId,
          relativePath,
        }));
      let resources = allResources;
      let truncated = buffer.length > contentBytes;
      const createOutput = (): LoadedSkillResource => ({
        id,
        skillId: resource.skill.id,
        name: resource.skill.name,
        source: resource.skill.source,
        invocation: resource.skill.invocation,
        baseDirectory: resource.skill.baseDirectory,
        relativePath: resource.relativePath,
        content,
        truncated,
        resources,
      });
      let output = createOutput();
      while (
        Buffer.byteLength(JSON.stringify(output)) >
          context.limits.maxOutputBytes &&
        contentBytes > 0
      ) {
        const overage =
          Buffer.byteLength(JSON.stringify(output)) -
          context.limits.maxOutputBytes;
        contentBytes = Math.max(0, contentBytes - overage - 16);
        content = buffer.subarray(0, contentBytes).toString("utf8");
        truncated = true;
        output = createOutput();
      }
      while (
        Buffer.byteLength(JSON.stringify(output)) >
          context.limits.maxOutputBytes &&
        resources.length > 0
      ) {
        resources = resources.slice(0, -1);
        truncated = true;
        output = createOutput();
      }
      if (
        Buffer.byteLength(JSON.stringify(output)) >
        context.limits.maxOutputBytes
      ) {
        return failure(
          "output_limit",
          "Skill resource metadata exceeds the active tool output limit.",
        );
      }
      loadCount += 1;
      loaded.add(id);
      return {
        ok: true,
        output,
        truncated,
      };
    },
  };
}

async function discoverRelatedResources(
  skill: SkillDescriptor,
): Promise<readonly RegisteredResource[]> {
  const results: RegisteredResource[] = [];
  const walk = async (directory: string): Promise<void> => {
    if (results.length >= MAX_SKILL_RELATED_RESOURCES) return;
    const entries = await readdir(directory, { withFileTypes: true });
    for (const entry of entries.sort((left, right) =>
      left.name.localeCompare(right.name),
    )) {
      if (results.length >= MAX_SKILL_RELATED_RESOURCES) break;
      if (entry.isSymbolicLink()) continue;
      const candidate = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        await walk(candidate);
        continue;
      }
      if (!entry.isFile() || candidate === skill.canonicalPath) continue;
      const canonicalPath = await realpath(candidate);
      if (!isInside(skill.baseDirectory, canonicalPath)) continue;
      const metadata = await stat(canonicalPath);
      if (metadata.size > MAX_SKILL_FILE_BYTES) continue;
      const relativePath = path.relative(skill.baseDirectory, canonicalPath);
      results.push({
        id: `${skill.id}:resource:${createHash("sha256").update(relativePath).digest("hex").slice(0, 12)}`,
        skill,
        canonicalPath,
        relativePath,
        identity: identity(metadata),
      });
    }
  };
  await walk(skill.baseDirectory);
  return results;
}

async function readVerifiedResource(
  resource: RegisteredResource,
): Promise<{ readonly ok: true; readonly buffer: Buffer } | ToolFailure> {
  let handle: Awaited<ReturnType<typeof open>> | undefined;
  try {
    const linkInfo = await lstat(resource.canonicalPath);
    if (!linkInfo.isFile() || linkInfo.isSymbolicLink())
      return failure(
        "not_file",
        "The registered Skill resource is no longer a regular file.",
      );
    const canonicalPath = await realpath(resource.canonicalPath);
    if (
      canonicalPath !== resource.canonicalPath ||
      !isInside(resource.skill.root, canonicalPath)
    ) {
      return failure(
        "outside_workspace",
        "The registered Skill resource escaped its resource root.",
      );
    }
    handle = await open(
      canonicalPath,
      constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0),
    );
    const current = identity(await handle.stat());
    if (!sameIdentity(current, resource.identity))
      return failure(
        "io_error",
        "The registered Skill resource changed after discovery; start a new run to rediscover it.",
      );
    return { ok: true, buffer: await handle.readFile() };
  } catch {
    return failure(
      "io_error",
      "The registered Skill resource could not be verified.",
    );
  } finally {
    await handle?.close();
  }
}

function identity(value: Awaited<ReturnType<typeof stat>>): SkillFileIdentity {
  return {
    device: Number(value.dev),
    inode: Number(value.ino),
    size: Number(value.size),
    modifiedMs: Number(value.mtimeMs),
  };
}

function sameIdentity(
  left: SkillFileIdentity,
  right: SkillFileIdentity,
): boolean {
  return (
    left.device === right.device &&
    left.inode === right.inode &&
    left.size === right.size &&
    left.modifiedMs === right.modifiedMs
  );
}

function isInside(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate);
  return (
    relative !== "" &&
    relative !== ".." &&
    !relative.startsWith(`..${path.sep}`) &&
    !path.isAbsolute(relative)
  );
}

function failure(
  code:
    | "io_error"
    | "limit_reached"
    | "not_file"
    | "not_found"
    | "output_limit"
    | "outside_workspace",
  message: string,
): ToolFailure {
  return { ok: false, error: { code, message, retryable: false } };
}
