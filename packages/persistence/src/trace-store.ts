import { appendFile, mkdir, readFile, stat } from "node:fs/promises";
import path from "node:path";

import type { ModelUsage, RunEvent, RunStatus } from "@forge/core";

import { redactValue } from "./redaction.js";
import { type TraceEnvelope, traceEnvelopeSchema } from "./schema.js";
import { PersistenceError } from "./session-store.js";

const MAX_TRACE_BYTES = 16 * 1024 * 1024;

export class JsonlTraceWriter {
  readonly #target: string;
  readonly #runId: string;
  readonly #sessionId: string | undefined;
  readonly #secrets: readonly string[];
  #sequence = 0;

  constructor(options: {
    readonly forgeHome: string;
    readonly runId: string;
    readonly sessionId?: string;
    readonly secrets?: readonly string[];
  }) {
    if (!traceEnvelopeSchema.shape.runId.safeParse(options.runId).success) {
      throw new PersistenceError(`Invalid run ID: ${options.runId}`);
    }
    if (
      options.sessionId !== undefined &&
      !traceEnvelopeSchema.shape.sessionId.unwrap().safeParse(options.sessionId)
        .success
    ) {
      throw new PersistenceError(`Invalid session ID: ${options.sessionId}`);
    }
    this.#target = path.join(
      options.forgeHome,
      "runs",
      `${options.runId}.jsonl`,
    );
    this.#runId = options.runId;
    this.#sessionId = options.sessionId;
    this.#secrets = options.secrets ?? [];
  }

  async append(event: RunEvent): Promise<void> {
    await mkdir(path.dirname(this.#target), { recursive: true, mode: 0o700 });
    const envelope: TraceEnvelope = {
      schemaVersion: 1,
      runId: this.#runId,
      ...(this.#sessionId ? { sessionId: this.#sessionId } : {}),
      sequence: this.#sequence,
      timestamp: new Date().toISOString(),
      event,
    };
    this.#sequence += 1;
    const serialized = `${JSON.stringify(redactValue(envelope, this.#secrets))}\n`;
    try {
      await appendFile(this.#target, serialized, {
        encoding: "utf8",
        mode: 0o600,
      });
    } catch (error) {
      throw new PersistenceError(
        `Could not append trace for run ${this.#runId}.`,
        { cause: error },
      );
    }
  }
}

export class FileTraceStore {
  readonly #runsDirectory: string;

  constructor(forgeHome: string) {
    this.#runsDirectory = path.join(forgeHome, "runs");
  }

  async read(runId: string): Promise<readonly TraceEnvelope[]> {
    if (!traceEnvelopeSchema.shape.runId.safeParse(runId).success) {
      throw new PersistenceError(`Invalid run ID: ${runId}`);
    }
    const sourcePath = path.join(this.#runsDirectory, `${runId}.jsonl`);
    let text: string;
    try {
      const metadata = await stat(sourcePath);
      if (metadata.size > MAX_TRACE_BYTES)
        throw new PersistenceError(`Trace ${runId} exceeds the size limit.`);
      text = await readFile(sourcePath, "utf8");
    } catch (error) {
      if (error instanceof PersistenceError) throw error;
      throw new PersistenceError(`Could not load trace ${runId}.`, {
        cause: error,
      });
    }
    const envelopes: TraceEnvelope[] = [];
    try {
      for (const [index, line] of text.split("\n").entries()) {
        if (line.trim() === "") continue;
        const envelope = traceEnvelopeSchema.parse(
          JSON.parse(line),
        ) as TraceEnvelope;
        if (
          envelope.runId !== runId ||
          envelope.sequence !== envelopes.length
        ) {
          throw new Error(`Invalid trace sequence at line ${index + 1}.`);
        }
        envelopes.push(envelope);
      }
    } catch (error) {
      throw new PersistenceError(`Trace ${runId} is invalid or unsupported.`, {
        cause: error,
      });
    }
    if (envelopes.length === 0)
      throw new PersistenceError(`Trace ${runId} is empty.`);
    return envelopes;
  }
}

export interface TraceSummary {
  readonly runId: string;
  readonly sessionId?: string;
  readonly startedAt: string;
  readonly finishedAt: string;
  readonly durationMs: number;
  readonly modelSteps: number;
  readonly toolCalls: number;
  readonly toolsByName: Readonly<Record<string, number>>;
  readonly usage: ModelUsage;
  readonly status: RunStatus | "unknown";
}

export function summarizeTrace(
  envelopes: readonly TraceEnvelope[],
): TraceSummary {
  const first = envelopes[0];
  const last = envelopes.at(-1);
  if (!first || !last)
    throw new PersistenceError("Cannot summarize an empty trace.");
  const tools: Record<string, number> = {};
  const usage = emptyUsage();
  let modelSteps = 0;
  for (const { event } of envelopes) {
    if (event.type === "model.started") modelSteps += 1;
    if (event.type === "tool.proposed")
      tools[event.call.name] = (tools[event.call.name] ?? 0) + 1;
    if (event.type === "model.completed") addUsage(usage, event.usage);
  }
  return {
    runId: first.runId,
    ...(first.sessionId ? { sessionId: first.sessionId } : {}),
    startedAt: first.timestamp,
    finishedAt: last.timestamp,
    durationMs: Math.max(
      0,
      Date.parse(last.timestamp) - Date.parse(first.timestamp),
    ),
    modelSteps,
    toolCalls: Object.values(tools).reduce((sum, count) => sum + count, 0),
    toolsByName: tools,
    usage,
    status: statusFromEvent(last.event),
  };
}

function emptyUsage(): ModelUsage {
  return {
    inputTokens: 0,
    outputTokens: 0,
    reasoningTokens: 0,
    cachedInputTokens: 0,
    cacheWriteTokens: 0,
    totalTokens: 0,
  };
}

function addUsage(
  target: Record<keyof ModelUsage, number | undefined>,
  next: ModelUsage,
): void {
  for (const key of Object.keys(target) as (keyof ModelUsage)[]) {
    const value = next[key];
    if (value !== undefined) target[key] = (target[key] ?? 0) + value;
  }
}

function statusFromEvent(event: RunEvent): RunStatus | "unknown" {
  switch (event.type) {
    case "run.completed":
      return "completed";
    case "run.failed":
      return "failed";
    case "run.cancelled":
      return "cancelled";
    case "run.denied":
      return "denied";
    case "run.limit_reached":
      return "limit_reached";
    default:
      return "unknown";
  }
}
