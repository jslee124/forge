import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

describe("Milestone 13.3-13.5 release-gate report", () => {
  it("records cross-feature safety, mode comparison, and the live-call boundary", async () => {
    const reportPath = fileURLToPath(
      new URL("../reports/v0.3.3/M13_RELEASE_GATES.json", import.meta.url),
    );
    const report = JSON.parse(await readFile(reportPath, "utf8")) as {
      readonly forgeVersion: string;
      readonly defaultContextMode: string;
      readonly liveProvider: {
        readonly optInRequired: boolean;
        readonly executed: boolean;
        readonly paidCalls: number;
      };
      readonly modes: readonly Record<string, unknown>[];
      readonly gates: Readonly<Record<string, string>>;
    };

    expect(report.forgeVersion).toBe("0.3.3");
    expect(report.defaultContextMode).toBe("warn");
    expect(report.liveProvider).toEqual(
      expect.objectContaining({
        optInRequired: true,
        executed: false,
        paidCalls: 0,
      }),
    );
    expect(report.modes.map(({ mode }) => mode)).toEqual([
      "warn",
      "compact-session",
      "compact-user-default-fixture",
    ]);
    for (const mode of report.modes) {
      expect(mode).toEqual(
        expect.objectContaining({
          taskSuccess: 1,
          constraintRetention: 1,
          editedFileRetention: 1,
          unresolvedWorkRetention: 1,
          hostileApprovalRejected: 1,
          resumeSafety: 1,
          cacheReadTokens: null,
          cacheWriteTokens: null,
        }),
      );
    }
    expect(report.gates).toMatchObject({
      contextSafety: "pass",
      permissionNearMatch: "pass",
      cacheAccounting: "pass",
      updateUserDataProtection: "pass",
      narrowWideTui: "pass",
      automaticDefaultQuality: "not-promoted",
    });
  });
});
