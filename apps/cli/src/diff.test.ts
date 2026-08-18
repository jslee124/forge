import { describe, expect, it } from "vitest";

import { formatDiffPanel, summarizeUnifiedDiff } from "./diff.js";

const DIFF = [
  "--- a/answer.ts",
  "+++ b/answer.ts",
  "@@ -1,2 +1,2 @@",
  "-export const answer = 42;",
  "+export const answer = 43;",
  " context",
].join("\n");

describe("diff presentation", () => {
  it("summarizes and numbers a unified diff without relying on color", () => {
    expect(summarizeUnifiedDiff(DIFF)).toEqual({
      operation: "modify",
      path: "answer.ts",
      additions: 1,
      deletions: 1,
    });
    const panel = formatDiffPanel(DIFF, false);
    expect(panel).toContain("MODIFY answer.ts  +1 -1");
    expect(panel).toContain("   1      │ -export const answer = 42;");
    expect(panel).toContain("        1 │ +export const answer = 43;");
    expect(panel).not.toContain("\u001B[");
  });

  it("adds ANSI color while preserving diff markers", () => {
    const panel = formatDiffPanel(DIFF, true);
    expect(panel).toContain("\u001B[31m-export const answer = 42;");
    expect(panel).toContain("\u001B[32m+export const answer = 43;");
  });

  it("labels file creation with accurate added-line counts", () => {
    const diff = [
      "--- /dev/null",
      "+++ b/hello.md",
      "@@ -0,0 +1,1 @@",
      "+hello, world",
      "",
    ].join("\n");
    expect(summarizeUnifiedDiff(diff)).toEqual({
      operation: "create",
      path: "hello.md",
      additions: 1,
      deletions: 0,
    });
  });
});
