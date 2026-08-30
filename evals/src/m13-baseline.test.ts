import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

describe("Milestone 13 v0.3.2 baseline report", () => {
  it("records every required metric and preserves unavailable cache values", async () => {
    const path = fileURLToPath(
      new URL("../reports/v0.3.2/M13_BASELINE.json", import.meta.url),
    );
    const report = JSON.parse(await readFile(path, "utf8")) as {
      readonly forgeVersion: string;
      readonly environment: {
        readonly startupMedianMs: number;
        readonly startupUpdateCheckBlockingLatencyMs: number;
      };
      readonly modes: readonly Record<string, unknown>[];
    };
    expect(report.forgeVersion).toBe("0.3.2");
    expect(report.environment.startupMedianMs).toBeGreaterThan(0);
    expect(report.environment.startupUpdateCheckBlockingLatencyMs).toBe(0);
    expect(report.modes).toHaveLength(3);
    for (const mode of report.modes) {
      expect(mode).toEqual(
        expect.objectContaining({
          taskCompletion: 1,
          contextEstimateTokens: expect.any(Number),
          providerInputTokens: expect.any(Number),
          cacheReadTokens: null,
          cacheWriteTokens: null,
          approvalCount: 0,
          approvalWaitMs: 0,
          compactionCount: expect.any(Number),
        }),
      );
    }
  });
});
