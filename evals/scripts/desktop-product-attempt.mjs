import { createHash } from "node:crypto";
import { readdir, readFile, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";

/** Read-only forensic inventory; never reconciles a running record into success. */
export async function collectAttemptEvidence(home, directory) {
  const files = [];
  let modelStarts = 0;
  let malformedTraceLines = 0;
  let skippedTraceFiles = 0;
  const entries = async (path) =>
    readdir(path, { withFileTypes: true }).catch((error) => {
      if (error.code !== "ENOENT") throw error;
      return [];
    });
  async function retain(relative, trace = false) {
    const path = join(home, relative);
    const size = (await stat(path)).size;
    if (size > 8 * 1024 * 1024) {
      files.push({
        path: relative,
        bytes: size,
        notRead: "8 MiB diagnostic limit",
      });
      if (trace) skippedTraceFiles++;
      return;
    }
    const bytes = await readFile(path);
    const sha256 = createHash("sha256").update(bytes).digest("hex");
    const item = { path: relative, bytes: bytes.length, sha256 };
    if (trace) {
      for (const line of bytes.toString("utf8").split("\n").filter(Boolean)) {
        try {
          if (JSON.parse(line).event?.type === "model.started") modelStarts++;
        } catch {
          malformedTraceLines++;
        }
      }
    }
    files.push(item);
  }
  for (const entry of await entries(join(home, "runs")))
    if (entry.isFile() && /^[a-zA-Z0-9_-]+\.jsonl$/.test(entry.name))
      await retain(join("runs", entry.name), true);
  for (const session of await entries(join(home, "run-records"))) {
    if (!session.isDirectory() || !/^[a-zA-Z0-9_-]+$/.test(session.name))
      continue;
    for (const run of await entries(join(home, "run-records", session.name))) {
      if (!run.isDirectory() || !/^[a-zA-Z0-9_-]+$/.test(run.name)) continue;
      for (const file of await entries(
        join(home, "run-records", session.name, run.name),
      ))
        if (
          file.isFile() &&
          ["summary.json", "events.jsonl"].includes(file.name)
        )
          await retain(join("run-records", session.name, run.name, file.name));
    }
  }
  const result = {
    kind: "read-only raw artifact inventory; no completion inferred",
    modelStartsObserved: modelStarts,
    malformedTraceLines,
    skippedTraceFiles,
    traceCoverage:
      malformedTraceLines || skippedTraceFiles
        ? "partial"
        : "complete for discovered files",
    files,
  };
  await writeFile(
    join(directory, "attempt-records.json"),
    `${JSON.stringify(result, null, 2)}\n`,
    { mode: 0o600, flag: "wx" },
  );
  return result;
}
