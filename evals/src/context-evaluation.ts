import { type ContextMode, conservativeTextTokens } from "@forge/core";
import {
  createForgeSummaryCheckpoint,
  type SessionSnapshot,
} from "@forge/persistence";

export interface ContextModeMetrics {
  readonly mode: ContextMode;
  readonly taskSuccess: boolean;
  readonly estimatedInputTokens: number;
  readonly providerReportedInputTokens: number;
  readonly estimationAbsoluteErrorTokens: number;
  readonly latencyMs: number;
  readonly compactionCount: number;
  readonly retainedTurnCount: number;
  readonly summaryRegenerationRate: number;
}

export function evaluateContextModes(options: {
  readonly session: SessionSnapshot;
  readonly seededConstraint: string;
  readonly recentTailTokens: number;
  readonly summaryTargetTokens: number;
}): readonly ContextModeMetrics[] {
  const fullTokens = conservativeTextTokens(
    JSON.stringify(options.session.messages),
  );
  return (["off", "warn", "compact"] as const).map((mode) => {
    const started = performance.now();
    if (mode !== "compact") {
      const taskSuccess = JSON.stringify(options.session.messages).includes(
        options.seededConstraint,
      );
      return {
        mode,
        taskSuccess,
        estimatedInputTokens: fullTokens,
        providerReportedInputTokens: fullTokens,
        estimationAbsoluteErrorTokens: 0,
        latencyMs: Math.max(0, performance.now() - started),
        compactionCount: 0,
        retainedTurnCount: options.session.messages.length / 2,
        summaryRegenerationRate: 0,
      };
    }
    const compacted = createForgeSummaryCheckpoint(options.session, {
      provider: "deterministic-fake",
      modelId: "deterministic-fake",
      recentTailTokens: options.recentTailTokens,
      summaryTargetTokens: options.summaryTargetTokens,
      now: "2026-08-19T00:00:00.000Z",
    });
    const checkpoint = compacted.contextCheckpoint;
    if (!checkpoint?.summary) throw new Error("Checkpoint generation failed.");
    const tail = compacted.messages.slice(checkpoint.retainedTailStartIndex);
    const estimatedInputTokens =
      checkpoint.estimatedCheckpointTokens +
      conservativeTextTokens(JSON.stringify(tail));
    return {
      mode,
      taskSuccess: `${checkpoint.summary}\n${JSON.stringify(tail)}`.includes(
        options.seededConstraint,
      ),
      estimatedInputTokens,
      // The deterministic fake provider deliberately reports the admitted
      // estimate so the correlation and reporting path can be tested offline.
      providerReportedInputTokens: estimatedInputTokens,
      estimationAbsoluteErrorTokens: 0,
      latencyMs: Math.max(0, performance.now() - started),
      compactionCount: 1,
      retainedTurnCount: tail.length / 2,
      summaryRegenerationRate: 1,
    };
  });
}
