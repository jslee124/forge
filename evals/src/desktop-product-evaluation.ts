import { createHash } from "node:crypto";
import {
  copyFile,
  mkdir,
  readdir,
  readFile,
  writeFile,
} from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";

const taskSchema = z
  .object({
    id: z.string().regex(/^[QEDF]0[1-6]$/),
    prompt: z.string().min(1),
    assertion: z.string().min(1),
    critical: z.boolean(),
    allowedEffects: z.array(z.string()),
    assessment: z.string(),
    fault: z.string(),
  })
  .strict();
const corpusSchema = z
  .object({
    schemaVersion: z.literal(1),
    revision: z.literal("desktop-product-v1"),
    primaryModel: z
      .object({
        engine: z.literal("forge"),
        provider: z.literal("deepseek"),
        id: z.literal("deepseek-flash"),
        reasoningEffort: z.literal("high"),
      })
      .strict(),
    liveBaselineStatus: z.literal("not_run"),
    rubric: z.record(z.string(), z.string()),
    tasks: z.array(taskSchema).length(24),
  })
  .strict();
const root = fileURLToPath(
  new URL("../fixtures/desktop-product/", import.meta.url),
);
export async function loadDesktopProductCorpus() {
  const corpus = corpusSchema.parse(
    JSON.parse(await readFile(join(root, "manifest.json"), "utf8")),
  );
  const expected = ["Q", "E", "D", "F"].flatMap((prefix) =>
    Array.from({ length: 6 }, (_, i) => `${prefix}0${i + 1}`),
  );
  if (
    new Set(corpus.tasks.map((task) => task.id)).size !== 24 ||
    expected.some((id) => !corpus.tasks.some((task) => task.id === id))
  )
    throw new Error("invalid-product-task-set");
  return corpus;
}

/** Prepares immutable inputs and pending assessments; never calls a provider or scores itself. */
export async function prepareDesktopProductRound(
  destination: string,
  round: 1 | 2,
) {
  const corpus = await loadDesktopProductCorpus();
  await mkdir(destination, { recursive: false, mode: 0o700 });
  const hashes: Record<string, string> = {};
  async function copySeed(source: string, target: string, relative = "") {
    await mkdir(target, { mode: 0o700 });
    for (const entry of await readdir(source, { withFileTypes: true })) {
      const path = relative ? `${relative}/${entry.name}` : entry.name;
      if (entry.isDirectory())
        await copySeed(
          join(source, entry.name),
          join(target, entry.name),
          path,
        );
      else if (entry.isFile()) {
        await copyFile(join(source, entry.name), join(target, entry.name));
        hashes[path] = createHash("sha256")
          .update(await readFile(join(source, entry.name)))
          .digest("hex");
      } else throw new Error("unexpected-fixture-entry");
    }
  }
  for (const task of corpus.tasks) {
    const directory = join(destination, task.id);
    await mkdir(directory, { mode: 0o700 });
    await copySeed(join(root, "seed"), join(directory, "workspace"));
    await writeFile(
      join(directory, "assessment.json"),
      `${JSON.stringify({ ...task, status: "not_run", evidence: [], rubric: corpus.rubric }, null, 2)}\n`,
      { flag: "wx", mode: 0o600 },
    );
  }
  const manifest = {
    revision: corpus.revision,
    round,
    primaryModel: corpus.primaryModel,
    fixtureSha256: hashes,
    liveBaselineStatus: "not_run",
    contractTestsAreNotLiveBaseline: true,
  };
  await writeFile(
    join(destination, "round.json"),
    `${JSON.stringify(manifest, null, 2)}\n`,
    { flag: "wx", mode: 0o600 },
  );
  return manifest;
}
