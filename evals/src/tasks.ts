import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

import { z } from "zod";

import { repositoryRoot } from "./paths.js";

const taskManifestSchema = z
  .object({
    schemaVersion: z.literal(1),
    id: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/u),
    fixture: z.string().regex(/^fixtures\/[a-z0-9-]+$/u),
    prompt: z.string().min(1),
    verification: z
      .object({
        program: z.string().min(1),
        args: z.array(z.string()).max(20),
        cwd: z.literal("."),
      })
      .strict(),
    hiddenGrader: z.string().regex(/^[a-z0-9-]+\.mjs$/u),
  })
  .strict();

export type TaskManifest = z.infer<typeof taskManifestSchema>;

export async function loadTaskManifests(
  root = repositoryRoot(),
): Promise<readonly TaskManifest[]> {
  const directory = path.join(root, "evals", "tasks");
  const entries = (await readdir(directory))
    .filter((entry) => entry.endsWith(".json"))
    .sort();
  const tasks = await Promise.all(
    entries.map(async (entry) => {
      const source = await readFile(path.join(directory, entry), "utf8");
      return taskManifestSchema.parse(JSON.parse(source));
    }),
  );
  const ids = new Set(tasks.map(({ id }) => id));
  if (ids.size !== tasks.length) throw new Error("Task IDs must be unique.");
  return tasks;
}

export async function loadTask(
  taskId: string,
  root = repositoryRoot(),
): Promise<TaskManifest> {
  const tasks = await loadTaskManifests(root);
  const task = tasks.find(({ id }) => id === taskId);
  if (!task) throw new Error(`Unknown evaluation task: ${taskId}`);
  return task;
}
