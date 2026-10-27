import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

// Planning can precede Electron packaging. Missing source inputs remain errors;
// absent build artifacts are explicit and cannot authorize a live matrix.
export async function snapshotMatrixInputs(root, sourceFiles, buildFiles) {
  const builds = new Set(buildFiles);
  const entries = await Promise.all(
    [...sourceFiles, ...buildFiles].map(async (name) => {
      try {
        const content = await readFile(join(root, name));
        return [name, createHash("sha256").update(content).digest("hex")];
      } catch (error) {
        if (builds.has(name) && error.code === "ENOENT") return [name, null];
        throw error;
      }
    }),
  );
  return {
    sha256: Object.fromEntries(entries),
    missingBuildArtifacts: entries
      .filter(([, hash]) => hash === null)
      .map(([name]) => name),
  };
}
