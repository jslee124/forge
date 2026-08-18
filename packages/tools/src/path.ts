import { realpath } from "node:fs/promises";
import path from "node:path";

import type { ToolResult, WorkspaceContext } from "@forge/core";

import { isPathInside } from "./workspace.js";

export type ResolvedToolPathResult =
  | { readonly ok: true; readonly path: string }
  | Extract<ToolResult, { readonly ok: false }>;

export async function resolveToolPath(
  requestedPath: string,
  workspace: WorkspaceContext,
): Promise<ResolvedToolPathResult> {
  const lexicalPath = path.resolve(workspace.cwd, requestedPath);

  if (!isPathInside(workspace.root, lexicalPath)) {
    return failure(
      "outside_workspace",
      "The requested path is outside the selected workspace.",
    );
  }

  try {
    const canonicalPath = await realpath(lexicalPath);

    if (!isPathInside(workspace.root, canonicalPath)) {
      return failure(
        "outside_workspace",
        "The requested path resolves outside the selected workspace.",
      );
    }

    return { ok: true, path: canonicalPath };
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") {
      return failure("not_found", "The requested path does not exist.");
    }

    return failure("io_error", "The requested path could not be resolved.");
  }
}

export async function resolveNewToolPath(
  requestedPath: string,
  workspace: WorkspaceContext,
): Promise<ResolvedToolPathResult> {
  const lexicalPath = path.resolve(workspace.cwd, requestedPath);
  if (!isPathInside(workspace.root, lexicalPath)) {
    return failure(
      "outside_workspace",
      "The requested path is outside the selected workspace.",
    );
  }

  try {
    const canonicalParent = await realpath(path.dirname(lexicalPath));
    if (!isPathInside(workspace.root, canonicalParent)) {
      return failure(
        "outside_workspace",
        "The requested path resolves outside the selected workspace.",
      );
    }
    return {
      ok: true,
      path: path.join(canonicalParent, path.basename(lexicalPath)),
    };
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") {
      return failure("not_found", "The parent directory does not exist.");
    }
    return failure("io_error", "The requested path could not be resolved.");
  }
}

export function relativeWorkspacePath(
  workspace: WorkspaceContext,
  target: string,
): string {
  const relative = path.relative(workspace.root, target);
  return relative === "" ? "." : relative.split(path.sep).join("/");
}

export function failure(
  code: Extract<ToolResult, { readonly ok: false }>["error"]["code"],
  message: string,
  retryable = false,
): Extract<ToolResult, { readonly ok: false }> {
  return { ok: false, error: { code, message, retryable } };
}

export function cancelled(): Extract<ToolResult, { readonly ok: false }> {
  return failure("cancelled", "The tool call was cancelled.");
}

export function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}
