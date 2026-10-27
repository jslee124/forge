import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { savePilotFailure } from "./product-attempt-evidence.js";

it("retains host observations without overwriting original artifacts or inventing a terminal run", async () => {
  const root = await mkdtemp(join(tmpdir(), "forge-attempt-evidence-"));
  try {
    await writeFile(join(root, "pilot-result.json"), "original failed report");
    const result = await savePilotFailure(root, {
      task: "F02",
      error: "disconnected",
      events: [{ payload: { type: "complete", outcome: "interrupted" } }],
      decisions: [{ allow: true }],
      controlErrors: [],
      cancellation: { pid: 42 },
    });
    expect(result["observed-events.json"]).toBe("saved");
    const original = await readFile(join(root, "observed-events.json"), "utf8");
    expect(
      JSON.parse(await readFile(join(root, "control-failure.json"), "utf8")),
    ).toMatchObject({
      task: "F02",
      kind: "host observations at failure; not persisted run completion",
      error: "disconnected",
    });
    expect(
      (
        await savePilotFailure(root, {
          task: "F02",
          error: "second attempt",
          events: [],
          decisions: [],
          controlErrors: [],
        })
      )["observed-events.json"],
    ).toBe("original retained");
    expect(await readFile(join(root, "observed-events.json"), "utf8")).toBe(
      original,
    );
    expect(await readFile(join(root, "pilot-result.json"), "utf8")).toBe(
      "original failed report",
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
