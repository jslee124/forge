import type {
  ModelAdapter,
  ModelRequest,
  ModelStreamEvent,
  ModelUsage,
} from "./model.js";
import type { RunEvent, StepOutcome } from "./runtime-events.js";
import type { ForgeTool, ModelToolDefinition, ToolCall } from "./tools.js";

export class RunCancellationError extends Error {}

export class ModelStepFailure extends Error {
  constructor(
    readonly error: unknown,
    readonly producedEvidence: boolean,
  ) {
    super("The model step failed.", { cause: error });
  }
}

export async function consumeModelStep(
  model: ModelAdapter,
  request: ModelRequest,
  signal: AbortSignal,
  step: number,
  emit: (event: RunEvent) => Promise<void>,
  bufferText = false,
): Promise<StepOutcome> {
  const calls: ToolCall[] = [];
  let text = "";
  let producedEvidence = false;
  let receivedReasoningText = false;
  let finishEvent:
    | Extract<ModelStreamEvent, { readonly type: "finish" }>
    | undefined;

  try {
    for await (const event of model.stream(request, signal)) {
      switch (event.type) {
        case "reasoning.delta":
          producedEvidence = true;
          if (event.text.length > 0) receivedReasoningText = true;
          await emit({ type: "model.reasoning", step, text: event.text });
          break;
        case "text.delta":
          producedEvidence = true;
          text += event.text;
          if (bufferText && text.length > 1_000_000)
            throw new Error(
              "Finalization output exceeds the bounded answer limit.",
            );
          if (!bufferText)
            await emit({ type: "model.text", step, text: event.text });
          break;
        case "warning":
          await emit({ type: "model.warning", step, message: event.message });
          break;
        case "tool.call":
          producedEvidence = true;
          calls.push(event.call);
          break;
        case "finish":
          finishEvent = event;
          break;
        case "abort":
          throw new RunCancellationError();
      }
    }
  } catch (error) {
    if (error instanceof RunCancellationError) throw error;
    throw new ModelStepFailure(error, producedEvidence);
  }

  if (signal.aborted) {
    throw new RunCancellationError();
  }
  if (!finishEvent) {
    throw new Error("The model stream ended without a finish event.");
  }
  if (
    !receivedReasoningText &&
    finishEvent.usage.reasoningTokens !== undefined &&
    finishEvent.usage.reasoningTokens > 0
  ) {
    await emit({
      type: "model.reasoning-unavailable",
      step,
      reasoningTokens: finishEvent.usage.reasoningTokens,
    });
  }

  return {
    text,
    calls,
    finishReason: finishEvent.finishReason,
    usage: finishEvent.usage,
    ...(finishEvent.continuation
      ? { continuation: finishEvent.continuation }
      : {}),
  };
}

export function toModelToolDefinitions(
  tools: readonly ForgeTool[],
): readonly ModelToolDefinition[] {
  return tools.map(({ name, description, inputSchema }) => ({
    name,
    description,
    inputSchema,
  }));
}

export function cacheObservation(
  step: number,
  usage: ModelUsage,
): Extract<RunEvent, { readonly type: "cache.observed" }> {
  const inputTokens = usage.inputTokens;
  const cacheReadTokens = usage.cachedInputTokens;
  const cacheWriteTokens = usage.cacheWriteTokens;
  const uncachedInputTokens =
    inputTokens !== undefined && cacheReadTokens !== undefined
      ? Math.max(0, inputTokens - cacheReadTokens)
      : undefined;
  const hitRatio =
    inputTokens !== undefined &&
    cacheReadTokens !== undefined &&
    inputTokens > 0
      ? Math.min(1, cacheReadTokens / inputTokens)
      : inputTokens === 0 && cacheReadTokens === 0
        ? 0
        : undefined;
  return {
    type: "cache.observed",
    schemaVersion: 1,
    step,
    ...(inputTokens !== undefined ? { inputTokens } : {}),
    ...(cacheReadTokens !== undefined ? { cacheReadTokens } : {}),
    ...(cacheWriteTokens !== undefined ? { cacheWriteTokens } : {}),
    ...(uncachedInputTokens !== undefined ? { uncachedInputTokens } : {}),
    ...(hitRatio !== undefined ? { hitRatio } : {}),
  };
}

export function safeErrorMessage(error: unknown): string {
  if (error instanceof RunCancellationError) {
    return "The run was cancelled.";
  }
  if (error instanceof Error && error.message) {
    return error.message;
  }
  return "The model step failed unexpectedly.";
}
