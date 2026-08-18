import { access, readFile } from "node:fs/promises";
import path from "node:path";

export const MAX_INSTRUCTION_FILE_BYTES = 32_768;
export const MAX_TOTAL_INSTRUCTION_BYTES = 131_072;

export interface LoadedInstruction {
  readonly path: string;
  readonly scope: "user" | "project";
  readonly content: string;
  readonly truncated: boolean;
}

export interface InstructionSet {
  readonly files: readonly LoadedInstruction[];
  readonly warnings: readonly string[];
  readonly prompt: string;
}

export async function loadInstructions(options: {
  readonly forgeHome: string;
  readonly workspaceRoot: string;
  readonly workingDirectory: string;
}): Promise<InstructionSet> {
  const candidates: { path: string; scope: "user" | "project" }[] = [
    { path: path.join(options.forgeHome, "AGENTS.md"), scope: "user" },
  ];
  for (const directory of projectDirectories(
    options.workspaceRoot,
    options.workingDirectory,
  )) {
    const overridePath = path.join(directory, "AGENTS.override.md");
    const regularPath = path.join(directory, "AGENTS.md");
    candidates.push({
      path: (await exists(overridePath)) ? overridePath : regularPath,
      scope: "project",
    });
  }

  const files: LoadedInstruction[] = [];
  const warnings: string[] = [];
  let remaining = MAX_TOTAL_INSTRUCTION_BYTES;
  for (const candidate of candidates) {
    const loaded = await loadOne(candidate.path, candidate.scope, remaining);
    if (!loaded) continue;
    if (loaded.ignored) {
      warnings.push(
        `Ignored ${candidate.path}: total instruction limit reached.`,
      );
      continue;
    }
    files.push(loaded.file);
    remaining -= Buffer.byteLength(loaded.file.content);
    if (loaded.file.truncated)
      warnings.push(
        `Truncated ${candidate.path} to the instruction size limit.`,
      );
  }
  return { files, warnings, prompt: formatInstructionPrompt(files) };
}

export function formatInstructionPrompt(
  files: readonly LoadedInstruction[],
): string {
  return files
    .map((file) => `Instructions from ${file.path}:\n${file.content}`)
    .join("\n\n");
}

function projectDirectories(root: string, cwd: string): string[] {
  const relative = path.relative(root, cwd);
  if (relative === "") return [root];
  if (
    relative === ".." ||
    relative.startsWith(`..${path.sep}`) ||
    path.isAbsolute(relative)
  ) {
    throw new Error("The working directory must be inside the workspace root.");
  }
  const directories = [root];
  let current = root;
  for (const segment of relative.split(path.sep)) {
    current = path.join(current, segment);
    directories.push(current);
  }
  return directories;
}

async function loadOne(
  sourcePath: string,
  scope: "user" | "project",
  remaining: number,
): Promise<
  | { readonly file: LoadedInstruction; readonly ignored: false }
  | { readonly ignored: true }
  | undefined
> {
  let buffer: Buffer;
  try {
    buffer = await readFile(sourcePath);
  } catch (error) {
    if (
      typeof error === "object" &&
      error !== null &&
      "code" in error &&
      error.code === "ENOENT"
    )
      return undefined;
    throw error;
  }
  if (buffer.toString("utf8").trim() === "") return undefined;
  if (remaining <= 0) return { ignored: true };
  const allowed = Math.min(MAX_INSTRUCTION_FILE_BYTES, remaining);
  const truncated = buffer.length > allowed;
  const content = buffer.subarray(0, allowed).toString("utf8");
  return {
    file: { path: sourcePath, scope, content, truncated },
    ignored: false,
  };
}

async function exists(sourcePath: string): Promise<boolean> {
  try {
    await access(sourcePath);
    return true;
  } catch (error) {
    if (
      typeof error === "object" &&
      error !== null &&
      "code" in error &&
      error.code === "ENOENT"
    )
      return false;
    throw error;
  }
}
