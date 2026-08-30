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
  const cache = summary.cache;
  const cacheLines = [
    "",
    "Prompt cache",
    `Aggregate input=${formatOptional(cache.inputTokens)} read=${formatOptional(cache.cacheReadTokens)} write=${formatOptional(cache.cacheWriteTokens)} uncached=${formatOptional(cache.uncachedInputTokens)} hitRatio=${formatRatio(cache.hitRatio)}`,
    ...cache.steps.map(
      (step) =>
        `Step ${step.step} input=${formatOptional(step.inputTokens)} read=${formatOptional(step.cacheReadTokens)} write=${formatOptional(step.cacheWriteTokens)} uncached=${formatOptional(step.uncachedInputTokens)} hitRatio=${formatRatio(step.hitRatio)}`,
    ),
    ...(cache.lastPrefix
      ? [
          `Prefix ${cache.lastPrefix.stablePrefixHash} mode=${cache.lastPrefix.cacheMode} invalidatedBy=${cache.lastPrefix.invalidatedBy.join(",") || "none"}`,
          `Hashes instructions=${cache.lastPrefix.instructionHash} resources=${cache.lastPrefix.resourceCatalogHash} tools=${cache.lastPrefix.toolSchemaHash}`,
        ]
      : ["Prefix unavailable"]),
  ];
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
    ...cacheLines,
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
    case "skill.discovery":
      return `${event.type} catalog=${event.catalogCount} diagnostics=${event.diagnosticCount}`;
    case "skill.selected":
      return `${event.type} $${event.name} id=${event.id} source=${event.source} reason=${event.reason} invocation=${event.invocation}`;
    case "skill.loaded":
      return `${event.type} $${event.name} id=${event.id} source=${event.source} resource=${event.relativePath} truncated=${event.truncated}`;
    case "skill.rejected":
      return `${event.type}${event.id ? ` id=${event.id}` : ""} code=${event.code} ${event.message}`;
    case "docs.search":
      return `${event.type} locale=${event.locale} results=${event.resultCount} fallback=${event.fallback} query=${JSON.stringify(event.query)}`;
    case "docs.read":
      return `${event.type} reference=${event.reference} truncated=${event.truncated}`;
    case "docs.rejected":
      return `${event.type} tool=${event.tool} code=${event.code} ${event.message}`;
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
    case "context.pressure":
      return `${event.type} step=${event.step} ratio=${Math.round(event.snapshot.ratio * 100)}% confidence=${event.snapshot.confidence} mode=${event.snapshot.mode} state=${event.snapshot.state}`;
    case "cache.prefix":
      return `${event.type} step=${event.step} hash=${event.observation.stablePrefixHash} mode=${event.observation.cacheMode} invalidatedBy=${event.observation.invalidatedBy.join(",") || "none"}`;
    case "cache.observed":
      return `${event.type} step=${event.step} input=${formatOptional(event.inputTokens)} read=${formatOptional(event.cacheReadTokens)} write=${formatOptional(event.cacheWriteTokens)} uncached=${formatOptional(event.uncachedInputTokens)} hitRatio=${formatRatio(event.hitRatio)}`;
    case "approval.scope-decision":
      return `${event.type} action=${event.actionId} decision=${event.decision} scope=${event.scopeId ?? "none"} persisted=false provenance=${event.provenance}`;
    case "update.availability":
      return `${event.type} state=${event.state} current=${event.currentVersion}${event.latestVersion ? ` latest=${event.latestVersion}` : ""}`;
    case "context.auto-paused":
      return `${event.type} step=${event.step} reason=${event.reason} ${event.message}`;
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

function formatOptional(value: number | undefined): string {
  return value === undefined ? "unavailable" : String(value);
}

function formatRatio(value: number | undefined): string {
  return value === undefined ? "unavailable" : `${(value * 100).toFixed(1)}%`;
}
