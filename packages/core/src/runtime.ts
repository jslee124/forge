import { randomUUID } from "node:crypto";
import { setImmediate as yieldToEventLoop } from "node:timers/promises";
import type { PromptPrefixObservation } from "./cache.js";
import { DEFAULT_CONTEXT_CONFIGURATION } from "./context.js";
import { ModelProviderError } from "./errors.js";
import {
  type CanonicalConversationMessage,
  type ModelContinuation,
  type ModelToolResult,
  validateCanonicalConversation,
} from "./model.js";
import {
  InvalidActionLoopTracker,
  ReadProgressTracker,
} from "./read-progress.js";
import { prepareModelStepRequest } from "./runtime-budget.js";
import {
  canonicalDeltaWithOutcome,
  canonicalExchange,
  summarizeToolCall,
  truncateRunOutcome,
} from "./runtime-conversation.js";
import {
  DEFAULT_MAX_MODEL_STEPS,
  DEFAULT_MAX_TOOL_CALLS,
  exitCodeForRunStatus,
  type FinalizationReason,
  type RunAgentOptions,
  type RunEvent,
  type RunLimits,
  type RunResult,
  type RunStatus,
  type StepOutcome,
} from "./runtime-events.js";
import {
  cacheObservation,
  consumeModelStep,
  ModelStepFailure,
  RunCancellationError,
  safeErrorMessage,
  toModelToolDefinitions,
} from "./runtime-step.js";
import { executeToolCallBatch } from "./runtime-tools.js";
import type { ToolCall, ToolResult } from "./tools.js";

export { runConversationMessages } from "./runtime-conversation.js";
export {
  DEFAULT_MAX_MODEL_STEPS,
  DEFAULT_MAX_TOOL_CALLS,
  exitCodeForRunStatus,
  type FinalizationReason,
  type RunAgentOptions,
  type RunContextSnapshot,
  type RunEvent,
  type RunLimits,
  type RunResult,
  type RunStatus,
} from "./runtime-events.js";

export async function runAgent(options: RunAgentOptions): Promise<RunResult> {
  const runId = options.runId ?? randomUUID();
  const limits: RunLimits = {
    maxModelSteps: options.limits?.maxModelSteps ?? DEFAULT_MAX_MODEL_STEPS,
    maxToolCalls: options.limits?.maxToolCalls ?? DEFAULT_MAX_TOOL_CALLS,
  };
  // Infinity is only an internal comparison value; persisted/displayed limits
  // retain explicit null to represent an unconfigured ceiling.
  const maxModelSteps = limits.maxModelSteps ?? Number.POSITIVE_INFINITY;
  const maxToolCalls = limits.maxToolCalls ?? Number.POSITIVE_INFINITY;
  const events: RunEvent[] = [];
  const emit = async (event: RunEvent) => {
    events.push(event);
    await options.onEvent?.(event);
  };
  const tools = toModelToolDefinitions(options.tools);
  const reserveFinalStep = options.completionPolicy === "reserve-final-step";
  const evidenceFinalization =
    reserveFinalStep && options.finalizationInput === "evidence";
  let finalizing: FinalizationReason | undefined;
  const readProgress = new ReadProgressTracker();
  const invalidActionProgress = new InvalidActionLoopTracker();
  let repeatedInvalidActions = false;
  let modelSteps = 0;
  let toolCalls = 0;
  const deniedCalls = new Set<string>();
  let continuation: ModelContinuation | undefined;
  let toolResults: readonly ModelToolResult[] | undefined;
  let finalText = "";
  const canonicalDelta: CanonicalConversationMessage[] = [
    {
      id: `${runId}:user`,
      runId,
      role: "user",
      content: [{ type: "text", text: options.prompt }],
    },
  ];
  let pendingExchange: readonly CanonicalConversationMessage[] | undefined;
  let pendingToolOutcomes: readonly ModelToolResult[] = [];
  let overflowRecoveryUsed = false;
  let previousPrefix: PromptPrefixObservation | undefined;
  let activePromptPrefix = options.promptPrefix;
  let autoCompactionPaused = options.contextPressureMode === "paused";
  const selectedSkillIds = new Set(
    (options.initialEvents ?? [])
      .filter(
        (
          event,
        ): event is Extract<RunEvent, { readonly type: "skill.selected" }> =>
          event.type === "skill.selected",
      )
      .map(({ id }) => id),
  );
  const contextConfiguration =
    options.contextConfiguration ?? DEFAULT_CONTEXT_CONFIGURATION;
  const pressureMode =
    options.contextPressureMode ??
    (contextConfiguration.mode === "automatic"
      ? "automatic-default"
      : contextConfiguration.mode);

  for (const event of options.initialEvents ?? []) await emit(event);

  await emit({
    type: "run.started",
    prompt: options.prompt,
    ...(options.images?.length ? { imageCount: options.images.length } : {}),
    ...(options.context ? { context: options.context } : {}),
  });

  const investigationInstructions = reserveFinalStep
    ? [
        options.instructions,
        `Total allowance: ${limits.maxModelSteps ?? "no fixed cap on"} model steps and ${limits.maxToolCalls ?? "no fixed cap on"} tool calls. If an explicit limit or a no-progress condition requires finalization, reserve one tool-free response. Plan investigation within configured limits; finish early when the requested evidence is sufficient. State relevant unknowns; do not claim unexecuted verification or skip necessary verification of changes to finish sooner.`,
      ]
        .filter(Boolean)
        .join("\n\n")
    : options.instructions;

  while (true) {
    // Unlimited fast/local adapters must still admit cancellation and IPC work.
    await yieldToEventLoop();
    if (options.signal.aborted) {
      return finish("cancelled", "The run was cancelled.");
    }
    if (modelSteps >= maxModelSteps) {
      return finish("limit_reached", "The model-step limit was reached.");
    }

    const nextStep = modelSteps + 1;
    if (
      reserveFinalStep &&
      !finalizing &&
      (nextStep >= maxModelSteps || toolCalls >= maxToolCalls)
    ) {
      finalizing =
        toolCalls >= maxToolCalls ? "tool_call_limit" : "model_step_limit";
      await emit({
        type: "run.finalizing",
        step: nextStep,
        reason: finalizing,
        ...(evidenceFinalization ? { inputMode: "evidence" as const } : {}),
      });
    }
    if (finalizing && options.model.supportsToolChoiceNone !== true) {
      return fallback("The adapter cannot request tool-free finalization.");
    }

    const prepared = await prepareModelStepRequest({
      options,
      tools,
      limits,
      maxModelSteps,
      maxToolCalls,
      modelSteps,
      toolCalls,
      nextStep,
      reserveFinalStep,
      evidenceFinalization,
      finalizing,
      investigationInstructions,
      canonicalDelta,
      pendingExchange,
      continuation,
      toolResults,
      contextConfiguration,
      pressureMode,
      activePromptPrefix,
      previousPrefix,
      autoCompactionPaused,
      emit,
    });
    if (prepared.kind === "stop") {
      return prepared.action === "fallback"
        ? fallback(prepared.message)
        : finish("limit_reached", prepared.message);
    }

    activePromptPrefix = prepared.activePromptPrefix;
    previousPrefix = prepared.previousPrefix;
    autoCompactionPaused = prepared.autoCompactionPaused;
    continuation = prepared.continuation;
    const { request, budget } = prepared;

    if (pendingExchange) {
      canonicalDelta.push(...pendingExchange);
      pendingExchange = undefined;
      pendingToolOutcomes = [];
    }
    modelSteps = nextStep;
    await emit({ type: "model.started", step: modelSteps });

    let step: StepOutcome;
    try {
      step = await consumeModelStep(
        options.model,
        request,
        options.signal,
        modelSteps,
        emit,
        Boolean(finalizing),
      );
    } catch (error) {
      if (options.signal.aborted || error instanceof RunCancellationError) {
        return finish("cancelled", "The run was cancelled.");
      }
      const stepFailure = error instanceof ModelStepFailure ? error : undefined;
      const overflowError = stepFailure?.error ?? error;
      const capabilities = options.model.context;
      if (
        !finalizing &&
        !overflowRecoveryUsed &&
        stepFailure &&
        !stepFailure.producedEvidence &&
        capabilities?.isContextOverflow?.(overflowError) &&
        capabilities.projectContinuation &&
        continuation
      ) {
        const projected = await capabilities.projectContinuation(
          continuation,
          0,
        );
        if (
          projected &&
          JSON.stringify(projected.data) !== JSON.stringify(continuation.data)
        ) {
          overflowRecoveryUsed = true;
          continuation = projected;
          await emit({
            type: "context.warning",
            step: modelSteps,
            message:
              "The provider rejected a clean attempt for context overflow. Forge projected completed tool results and will retry the same admitted input once.",
            budget,
          });
          continue;
        }
      }
      const message = safeErrorMessage(overflowError);
      if (finalizing) return fallback(message);
      return finish(
        "failed",
        message,
        overflowError instanceof ModelProviderError
          ? {
              ...(overflowError.statusCode !== undefined
                ? { statusCode: overflowError.statusCode }
                : {}),
              retryable: overflowError.retryable,
            }
          : undefined,
      );
    }

    await emit({
      type: "model.completed",
      step: modelSteps,
      finishReason: step.finishReason,
      usage: step.usage,
    });
    await emit(cacheObservation(modelSteps, step.usage));
    if (step.usage.inputTokens !== undefined) {
      const absoluteErrorTokens = Math.abs(
        step.usage.inputTokens - budget.estimatedInputTokens,
      );
      await emit({
        type: "context.usage",
        step: modelSteps,
        estimatedInputTokens: budget.estimatedInputTokens,
        providerInputTokens: step.usage.inputTokens,
        absoluteErrorTokens,
        relativeError:
          step.usage.inputTokens === 0
            ? 0
            : absoluteErrorTokens / step.usage.inputTokens,
      });
    }

    if (
      finalizing &&
      (step.calls.length > 0 ||
        step.finishReason !== "stop" ||
        !step.text.trim())
    ) {
      if (step.calls.length > 0) {
        const refused = await refuseCalls(
          step.calls,
          "Finalization is tool-free; no operation was executed.",
        );
        canonicalDelta.push(
          ...canonicalExchange(
            runId,
            modelSteps,
            { ...step, text: "" },
            refused,
          ),
        );
      }
      return fallback(
        step.calls.length
          ? "The provider returned tools despite toolChoice=none; all were refused."
          : "The finalization stream did not produce a complete answer.",
      );
    }
    if (step.calls.length === 0) {
      if (finalizing)
        await emit({ type: "model.text", step: modelSteps, text: step.text });
      finalText = step.text;
      if (step.finishReason === "tool-calls") {
        return finish(
          "failed",
          "The model ended with tool-calls but returned no tool call.",
        );
      }
      if (step.finishReason === "error") {
        return finish("failed", "The model step ended with an error.");
      }
      if (step.text !== "") {
        canonicalDelta.push({
          id: `${runId}:assistant:${modelSteps}`,
          runId,
          step: modelSteps,
          role: "assistant",
          content: [{ type: "text", text: step.text }],
        });
      }
      return finalizing
        ? finish("limit_reached", finalizationMessage())
        : finish("completed");
    }

    if (toolCalls + step.calls.length > maxToolCalls) {
      if (!reserveFinalStep)
        return finish("limit_reached", "The tool-call limit was reached.");
      finalizing = "tool_call_limit";
      await emit({
        type: "run.finalizing",
        step: modelSteps + 1,
        reason: finalizing,
        ...(evidenceFinalization ? { inputMode: "evidence" as const } : {}),
      });
      const refused = await refuseCalls(
        step.calls,
        "The remaining tool allowance cannot admit this batch; no operation was executed.",
      );
      pendingExchange = canonicalExchange(runId, modelSteps, step, refused);
      if (!step.continuation)
        return fallback(
          "The adapter did not preserve continuation for the refused batch.",
        );
      continuation = step.continuation;
      toolResults = refused;
      continue;
    }
    if (!step.continuation) {
      return finish(
        "failed",
        "The model adapter did not preserve continuation data for a tool call.",
      );
    }

    continuation = step.continuation;
    const batch = await executeToolCallBatch({
      calls: step.calls,
      options,
      modelSteps,
      toolCalls,
      deniedCalls,
      selectedSkillIds,
      pendingToolOutcomes,
      emit,
    });
    toolCalls = batch.toolCalls;
    pendingToolOutcomes = batch.pendingToolOutcomes;
    if (batch.kind === "abort") {
      return finish(batch.status, batch.message);
    }

    toolResults = batch.results;
    pendingExchange = canonicalExchange(runId, modelSteps, step, batch.results);
    repeatedInvalidActions = invalidActionProgress.observe(
      step.calls,
      batch.results,
    );
    if (
      readProgress.observe(step.calls, batch.results) ||
      repeatedInvalidActions
    ) {
      finalizing = "no_progress";
      if (!reserveFinalStep) return fallback(finalizationMessage());
      await emit({
        type: "run.finalizing",
        step: modelSteps + 1,
        reason: finalizing,
        ...(evidenceFinalization ? { inputMode: "evidence" as const } : {}),
      });
    }
  }

  function finalizationMessage(): string {
    if (finalizing === "no_progress")
      return repeatedInvalidActions
        ? "Execution stopped after repeated identical refused or invalid tool actions."
        : "Investigation stopped after repeated unchanged read-only evidence.";
    return finalizing === "tool_call_limit"
      ? "The tool-call limit was reached."
      : "The model-step limit was reached.";
  }
  async function refuseCalls(
    calls: readonly ToolCall[],
    message: string,
  ): Promise<ModelToolResult[]> {
    const results: ModelToolResult[] = [];
    for (const call of calls) {
      const result: ToolResult = {
        ok: false,
        error: { code: "limit_reached", message, retryable: false },
      };
      await emit({ type: "tool.proposed", step: modelSteps, call });
      await emit({ type: "tool.failed", step: modelSteps, call, result });
      results.push({ callId: call.id, toolName: call.name, result });
    }
    return results;
  }
  async function fallback(diagnostic: string): Promise<RunResult> {
    await emit({
      type: "model.warning",
      step: Math.max(1, modelSteps),
      message: diagnostic,
    });
    const facts = events.flatMap((event) =>
      event.type === "tool.completed"
        ? [`Observed tool success: ${summarizeToolCall(event.call)}`]
        : event.type === "tool.failed"
          ? [
              `Tool not successful: ${summarizeToolCall(event.call)}${event.result.ok ? "" : ` [${event.result.error.code}]`}`,
            ]
          : [],
    );
    finalText = [
      finalizing === "no_progress"
        ? repeatedInvalidActions
          ? "Partial run result. Repeated identical refused or invalid actions were stopped."
          : "Partial run result. Investigation repeated unchanged reads and was stopped."
        : "Partial run result. The total budget does not permit further investigation.",
      ...(facts.length
        ? facts.slice(-20).map((fact) => truncateRunOutcome(fact, 240))
        : ["No successful tool operations were observed."]),
      "The task goal and missing verification remain unconfirmed. Inspect current state before starting a new run.",
    ].join("\n");
    if (pendingExchange) {
      canonicalDelta.push(...pendingExchange);
      pendingExchange = undefined;
      pendingToolOutcomes = [];
    }
    canonicalDelta.push({
      id: `${runId}:fallback:${modelSteps}`,
      runId,
      role: "assistant",
      step: Math.max(1, modelSteps),
      content: [{ type: "text", text: finalText }],
    });
    await emit({
      type: "model.text",
      step: Math.max(1, modelSteps),
      text: `\n\n${finalText}`,
    });
    return finish("limit_reached", finalizationMessage());
  }
  async function finish(
    status: RunStatus,
    message?: string,
    providerFailure?: RunResult["providerFailure"],
  ): Promise<RunResult> {
    const type = `run.${status}` as RunEvent["type"];
    await emit({ type, ...(message ? { message } : {}) } as RunEvent);
    if (reserveFinalStep && pendingExchange) {
      canonicalDelta.push(...pendingExchange);
      pendingExchange = undefined;
      pendingToolOutcomes = [];
    }
    const committed = canonicalDeltaWithOutcome(
      canonicalDelta,
      runId,
      status,
      reserveFinalStep &&
        finalizing &&
        canonicalDelta.at(-1)?.role === "assistant" &&
        JSON.stringify(canonicalDelta.at(-1)?.content) ===
          JSON.stringify([{ type: "text", text: finalText }])
        ? ""
        : finalText,
      message,
      pendingToolOutcomes,
    );
    validateCanonicalConversation(committed);
    return {
      status,
      ...(providerFailure ? { providerFailure } : {}),
      ...(finalizing ? { partial: true, limitReason: finalizing } : {}),
      exitCode: exitCodeForRunStatus(status),
      finalText,
      modelSteps,
      toolCalls,
      events,
      canonicalDelta: committed,
      ...(message ? { message } : {}),
    };
  }
}
