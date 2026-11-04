import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";

const exec = promisify(execFile);
/** Retain the original directory outside Git; its workspace lease still prevents concurrent writes. */
export async function createSessionWorkspace(options: {
  cwd: string;
  forgeHome: string;
}): Promise<string> {
  let root: string;
  try {
    root = (
      await exec("git", ["-C", options.cwd, "rev-parse", "--show-toplevel"], {
        timeout: 10_000,
      })
    ).stdout.trim();
  } catch {
    return options.cwd;
  }
  const suffix = randomUUID();
  const parent = join(options.forgeHome, "worktrees");
  const target = join(parent, suffix);
  await mkdir(parent, { recursive: true, mode: 0o700 });
  // Start at HEAD, preserving the user's uncommitted/ignored files in the original directory.
  await exec(
    "git",
    [
      "-C",
      root,
      "worktree",
      "add",
      "-b",
      `codex/session-${suffix}`,
      target,
      "HEAD",
    ],
    { timeout: 30_000 },
  );
  return target;
}
