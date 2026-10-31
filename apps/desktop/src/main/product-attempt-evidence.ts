import { writeFile } from "node:fs/promises";
import { join } from "node:path";

/** Supplementary observations, never a synthesized successful run report. */
export async function savePilotFailure(
  directory: string,
  failure: {
    task: string;
    error: string;
    events: readonly unknown[];
    decisions: readonly unknown[];
    controlErrors: readonly string[];
    cancellation?: unknown;
    externalEdit?: unknown;
  },
) {
  const result: Record<string, string> = {};
  for (const [name, data] of [
    ["observed-events.json", failure.events],
    [
      "control-failure.json",
      {
        ...failure,
        events: undefined,
        kind: "host observations at failure; not persisted run completion",
        capturedAt: new Date().toISOString(),
      },
    ],
  ] as const) {
    try {
      await writeFile(
        join(directory, name),
        `${JSON.stringify(data, null, 2)}\n`,
        { flag: "wx", mode: 0o600 },
      );
      result[name] = "saved";
    } catch (error) {
      result[name] =
        (error as NodeJS.ErrnoException).code === "EEXIST"
          ? "original retained"
          : "write failed";
    }
  }
  return result;
}
