import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { FileProductRunStore } from "@forge/persistence";
import { expect, it } from "vitest";
import {
  ProductRunRecorder,
  projectRecordedActivity,
} from "./product-run-history.js";

it("bounds synchronous observer pressure while preserving awaited control facts", async () => {
  const home = await mkdtemp(join(tmpdir(), "forge-record-observers-"));
  try {
    const store = new FileProductRunStore(home);
    const writer = await store.create({
      sessionId: "session",
      runId: "run",
      engine: "codex",
      prompt: "stress",
    });
    const recorder = new ProductRunRecorder(writer);
    for (let index = 0; index < 10_000; index++)
      recorder.observe({
        type: "detail",
        kind: "reasoning",
        text: "reasoning",
        step: 1,
      });
    await recorder.record({
      type: "approval",
      approvalId: "decision",
      description: "review required",
    });
    await recorder.record({
      type: "decision",
      approvalId: "decision",
      allow: false,
    });
    const completion = await recorder.result({
      outcome: "denied",
      message: "x".repeat(20_000),
    });
    await recorder.finish(completion);
    const record = await store.read("session", "run");
    expect(record.summary.omittedEvents).toBeGreaterThan(0);
    expect(record.summary.omittedCharacters).toBeGreaterThan(0);
    expect(projectRecordedActivity(record).items.at(-1)?.decision).toBe(
      "denied",
    );
    expect(record.events.at(-1)?.payload.type).toBe("result");
  } finally {
    await rm(home, { recursive: true, force: true });
  }
});
