import { loadForgeConfig } from "@forge/config";
import {
  FileTraceStore,
  PersistenceError,
  summarizeTrace,
  type TraceEnvelope,
} from "@forge/persistence";

import type { WritableOutput } from "./ask.js";

export async function runInspectFromCli(
  runId: string,
  env: NodeJS.ProcessEnv = process.env,
): Promise<number> {
  return runInspect(runId, {
    cwd: process.cwd(),
    env,
    stdout: process.stdout,
    stderr: process.stderr,
  });
}

export async function runInspect(
  runId: string,
  dependencies: {
    readonly cwd: string;
    readonly env: NodeJS.ProcessEnv;
    readonly stdout: WritableOutput;
    readonly stderr: WritableOutput;
  },
): Promise<number> {
  try {
    const loaded = await loadForgeConfig({
      cwd: dependencies.cwd,
      env: dependencies.env,
    });
    const events = await new FileTraceStore(loaded.forgeHome).read(runId);
    dependencies.stdout.write(formatInspection(events));
    return 0;
  } catch (error) {
    if (error instanceof PersistenceError) {
      dependencies.stderr.write(`Inspection error: ${error.message}\n`);
      return 2;
    }
    dependencies.stderr.write("Unexpected error while inspecting the run.\n");
    return 1;
  }
}

export function formatInspection(events: readonly TraceEnvelope[]): string {
  const summary = summarizeTrace(events);
  const toolSummary = Object.entries(summary.toolsByName)
    .map(([name, count]) => `${name}=${count}`)
    .join(" ");
  const usage = [
    ["input", summary.usage.inputTokens],
    ["output", summary.usage.outputTokens],
    ["reasoning", summary.usage.reasoningTokens],
    ["cached", summary.usage.cachedInputTokens],
    ["total", summary.usage.totalTokens],
  ]
    .filter((entry): entry is [string, number] => entry[1] !== undefined)
    .map(([name, value]) => `${name}=${value}`)
    .join(" ");
  const budget = summary.context.lastBudget;
  const contextLines = budget
    ? [
        "",
        "Context budget",
        `Model ${budget.provider}/${budget.modelId} window=${budget.contextWindowTokens} source=${budget.contextWindowSource}`,
        `Estimated ${budget.estimatedInputTokens} available=${budget.availableInputTokens} reserve=${budget.effectiveReserveTokens} method=${budget.estimationMethod}`,
        `Categories instructions=${budget.estimates.instructions} request=${budget.estimates.currentRequest} tools=${budget.estimates.toolSchemas} history=${budget.estimates.conversationHistory} continuation=${budget.estimates.continuation} toolResults=${budget.estimates.toolResults}`,
        `Messages retained=${budget.retainedMessageCount} omitted=${budget.omittedMessageCount} warnings=${summary.context.warningCount}`,
        ...(summary.context.providerInputTokens !== undefined
          ? [
              `Provider input=${summary.context.providerInputTokens} absoluteError=${summary.context.absoluteErrorTokens ?? 0}`,
            ]
          : ["Provider input=unreported"]),
      ]
    : ["", "Context budget", "No context preflight was recorded."];
  return [
    `Run ${summary.runId}`,
    ...(summary.sessionId ? [`Session ${summary.sessionId}`] : []),
    `Status ${summary.status}`,
    `Started ${summary.startedAt}`,
    `Duration ${summary.durationMs}ms`,
    `Model steps ${summary.modelSteps}`,
    `Tool calls ${summary.toolCalls}${toolSummary ? ` (${toolSummary})` : ""}`,
    `Usage ${usage}`,
    ...contextLines,
    "",
    "Events",
    ...events.map(
      ({ sequence, timestamp, event }) =>
        `${String(sequence).padStart(3, "0")} ${timestamp} ${describeEvent(event)}`,
    ),
    "",
  ].join("\n");
}

function describeEvent(event: TraceEnvelope["event"]): string {
  switch (event.type) {
    case "run.started":
      return `${event.type} ${JSON.stringify(event.prompt)}`;
    case "model.started":
    case "model.completed":
      return `${event.type} step=${event.step}`;
    case "model.reasoning":
    case "model.text":
      return `${event.type} step=${event.step} ${JSON.stringify(event.text)}`;
    case "model.reasoning-unavailable":
      return `${event.type} step=${event.step} tokens=${event.reasoningTokens}`;
    case "model.warning":
      return `${event.type} ${JSON.stringify(event.message)}`;
    case "context.budgeted":
      return `${event.type} step=${event.step} estimated=${event.budget.estimatedInputTokens} available=${event.budget.availableInputTokens} retained=${event.budget.retainedMessageCount} omitted=${event.budget.omittedMessageCount}`;
    case "context.warning":
    case "context.limit_reached":
      return `${event.type} step=${event.step} ${event.message}`;
    case "context.usage":
      return `${event.type} step=${event.step} estimated=${event.estimatedInputTokens} provider=${event.providerInputTokens} error=${event.absoluteErrorTokens}`;
    case "context.compaction.started":
      return `${event.type} step=${event.step} strategy=${event.strategy} before=${event.estimatedBeforeTokens}`;
    case "context.compaction.completed":
      return `${event.type} step=${event.step} strategy=${event.strategy} reclaimed=${event.reclaimedTokens}`;
    case "context.compaction.failed":
      return `${event.type} step=${event.step} strategy=${event.strategy} ${event.message}`;
    case "tool.proposed":
    case "tool.started":
    case "tool.completed":
    case "tool.failed":
      return `${event.type} ${event.call.name} id=${event.call.id}`;
    case "tool.decision":
      return `${event.type} ${event.call.name} decision=${event.decision.kind}`;
    default:
      return "message" in event && event.message
        ? `${event.type} ${event.message}`
        : event.type;
  }
}
