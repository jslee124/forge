import { realpath } from "node:fs/promises";
import path from "node:path";

import type { WorkspaceContext } from "@forge/core";

export class WorkspaceResolutionError extends Error {
  readonly code = "WORKSPACE_RESOLUTION_ERROR";

  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "WorkspaceResolutionError";
  }
}

export async function resolveWorkspace(
  root: string,
  cwd: string = root,
): Promise<WorkspaceContext> {
  try {
    const canonicalRoot = await realpath(path.resolve(root));
    const canonicalCwd = await realpath(path.resolve(cwd));

    if (!isPathInside(canonicalRoot, canonicalCwd)) {
      throw new WorkspaceResolutionError(
        "The working directory must be inside the selected workspace.",
      );
    }

    return { root: canonicalRoot, cwd: canonicalCwd };
  } catch (error) {
    if (error instanceof WorkspaceResolutionError) {
      throw error;
    }

    throw new WorkspaceResolutionError(
      "Could not resolve the selected workspace or working directory.",
      { cause: error },
    );
  }
}

export function isPathInside(root: string, target: string): boolean {
  const relative = path.relative(root, target);
  return (
    relative === "" ||
    (!relative.startsWith(`..${path.sep}`) &&
      relative !== ".." &&
      !path.isAbsolute(relative))
  );
}
