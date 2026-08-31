import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import type { RunStatus } from "@forge/core";
import type { TraceSummary } from "@forge/persistence";

import type { GradeResult } from "./grader.js";

export interface TrialReport {
  readonly taskId: string;
  readonly trial: number;
  readonly runId: string;
  readonly status: RunStatus;
  readonly exitCode: number;
  readonly passed: boolean;
  readonly grade: GradeResult;
  readonly trace: TraceSummary;
  readonly failedVerificationAttempts: number;
  readonly deniedActions: number;
  readonly reachedLimit: boolean;
  readonly traceFile: string;
}

export interface EvaluationReport {
  readonly schemaVersion: 1;
  readonly generatedAt: string;
  readonly forgeCommit: string;
  readonly workspaceState?: "clean" | "dirty";
  readonly workspaceFingerprint?: string;
  readonly provider: "deepseek";
  readonly modelId: string;
  readonly thinking: "enabled" | "disabled";
  readonly trials: readonly TrialReport[];
}

export async function writeEvaluationReport(
  report: EvaluationReport,
  outputDirectory: string,
): Promise<void> {
  await mkdir(outputDirectory, { recursive: true, mode: 0o700 });
  await Promise.all([
    writeFile(
      path.join(outputDirectory, "report.json"),
      `${JSON.stringify(report, null, 2)}\n`,
      { mode: 0o600 },
    ),
    writeFile(
      path.join(outputDirectory, "report.md"),
      formatEvaluationReport(report),
      { mode: 0o600 },
    ),
  ]);
}

export function formatEvaluationReport(report: EvaluationReport): string {
  const groups = new Map<string, TrialReport[]>();
  for (const trial of report.trials) {
    const current = groups.get(trial.taskId) ?? [];
    current.push(trial);
    groups.set(trial.taskId, current);
  }
  const rows = [...groups.entries()].map(([taskId, trials]) => {
    const passed = trials.filter((trial) => trial.passed).length;
    const average = (selector: (trial: TrialReport) => number) =>
      Math.round(
        trials.reduce((sum, trial) => sum + selector(trial), 0) / trials.length,
      );
    return `| ${taskId} | ${trials.length} | ${passed} | ${formatPercent(passed / trials.length)} | ${average((trial) => trial.trace.durationMs)} | ${average((trial) => trial.trace.modelSteps)} | ${average((trial) => trial.trace.toolCalls)} | ${average((trial) => trial.trace.usage.totalTokens ?? 0)} |`;
  });
  return `# Forge evaluation report

- Generated: ${report.generatedAt}
- Commit: \`${report.forgeCommit}\`
- Workspace: ${report.workspaceState ?? "clean"}${report.workspaceFingerprint ? ` (development fingerprint \`${report.workspaceFingerprint}\`)` : ""}
- Provider: ${report.provider}
- Model: \`${report.modelId}\`
- Thinking: ${report.thinking}

| Task | Trials | Passed | Pass rate | Avg duration ms | Avg model steps | Avg tool calls | Avg tokens |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
${rows.join("\n")}

Failures are retained as evaluation evidence. A run passes only when Forge
finishes successfully and both the fixture-owned and external hidden graders
pass.
`;
}

function formatPercent(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}
