import {
  budgetModelRequest,
  type ContextBudgetReport,
  type ContextConfiguration,
  DEFAULT_CONTEXT_CONFIGURATION,
} from "./context.js";
import type {
  ModelAdapter,
  ModelContinuation,
  ModelConversationMessage,
  ModelFinishReason,
  ModelImageInput,
  ModelStreamEvent,
  ModelToolResult,
  ModelUsage,
} from "./model.js";
import type {
  ApprovalChannel,
  ApprovalDecision,
  ApprovalPolicy,
  ProposedAction,
} from "./policy.js";
import type {
  ForgeTool,
  ModelToolDefinition,
  ToolCall,
  ToolContext,
  ToolResult,
} from "./tools.js";

export const DEFAULT_MAX_MODEL_STEPS = 12;
export const DEFAULT_MAX_TOOL_CALLS = 40;

export type RunStatus =
  | "completed"
  | "failed"
  | "cancelled"
  | "denied"
  | "limit_reached";

export type RunEvent =
  | {
      readonly type: "skill.discovery";
      readonly catalogCount: number;
      readonly diagnosticCount: number;
      readonly diagnostics: readonly {
        readonly code: string;
        readonly source: "builtin" | "user" | "project";
        readonly sourcePath: string;
        readonly message: string;
      }[];
    }
  | {
      readonly type: "skill.selected";
      readonly id: string;
      readonly name: string;
      readonly source: "builtin" | "user" | "project";
      readonly reason: "automatic" | "explicit";
      readonly invocation: "model" | "explicit-only";
    }
  | {
      readonly type: "skill.loaded";
      readonly id: string;
      readonly name: string;
      readonly source: "builtin" | "user" | "project";
      readonly relativePath: string;
      readonly truncated: boolean;
    }
  | {
      readonly type: "skill.rejected";
      readonly id?: string;
      readonly code: string;
      readonly message: string;
    }
  | {
      readonly type: "run.started";
      readonly prompt: string;
      readonly imageCount?: number;
      readonly context?: RunContextSnapshot;
    }
  | { readonly type: "model.started"; readonly step: number }
  | {
      readonly type: "context.budgeted";
      readonly step: number;
      readonly budget: ContextBudgetReport;
    }
  | {
      readonly type: "context.warning" | "context.limit_reached";
      readonly step: number;
      readonly message: string;
      readonly budget: ContextBudgetReport;
    }
  | {
      readonly type: "context.usage";
      readonly step: number;
      readonly estimatedInputTokens: number;
      readonly providerInputTokens: number;
      readonly absoluteErrorTokens: number;
      readonly relativeError: number;
    }
  | {
      readonly type: "context.compaction.started";
      readonly step: number;
      readonly strategy: "adapter-continuation";
      readonly estimatedBeforeTokens: number;
    }
  | {
      readonly type: "context.compaction.completed";
      readonly step: number;
      readonly strategy: "adapter-continuation";
      readonly estimatedBeforeTokens: number;
      readonly estimatedAfterTokens: number;
      readonly reclaimedTokens: number;
    }
  | {
      readonly type: "context.compaction.failed";
      readonly step: number;
      readonly strategy: "adapter-continuation";
      readonly message: string;
    }
  | {
      readonly type: "model.reasoning" | "model.text";
      readonly step: number;
      readonly text: string;
    }
  | {
      readonly type: "model.reasoning-unavailable";
      readonly step: number;
      readonly reasoningTokens: number;
    }
  | {
      readonly type: "model.warning";
      readonly step: number;
      readonly message: string;
    }
  | {
      readonly type: "model.completed";
      readonly step: number;
      readonly finishReason: ModelFinishReason;
      readonly usage: ModelUsage;
    }
  | {
      readonly type: "tool.proposed";
      readonly step: number;
      readonly call: ToolCall;
    }
  | {
      readonly type: "tool.decision";
      readonly step: number;
      readonly call: ToolCall;
      readonly decision: ApprovalDecision;
    }
  | {
      readonly type: "tool.started";
      readonly step: number;
      readonly call: ToolCall;
    }
  | {
      readonly type: "tool.completed" | "tool.failed";
      readonly step: number;
      readonly call: ToolCall;
      readonly result: ToolResult;
    }
  | {
      readonly type:
        | "run.completed"
        | "run.failed"
        | "run.cancelled"
        | "run.denied"
        | "run.limit_reached";
      readonly message?: string;
    };

export interface RunLimits {
  readonly maxModelSteps: number;
  readonly maxToolCalls: number;
}

export interface RunContextSnapshot {
  readonly workspaceRoot: string;
  readonly workingDirectory: string;
  readonly modelId: string;
  readonly permissionProfile: string;
  readonly instructionPaths: readonly string[];
}

export interface RunAgentOptions {
  readonly prompt: string;
  readonly images?: readonly ModelImageInput[];
  readonly context?: RunContextSnapshot;
  readonly instructions?: string;
  readonly conversation?: readonly ModelConversationMessage[];
  readonly omittedConversationMessages?: number;
  readonly contextConfiguration?: ContextConfiguration;
  readonly model: ModelAdapter;
  readonly tools: readonly ForgeTool[];
  readonly policy: ApprovalPolicy;
  readonly approvalChannel?: ApprovalChannel;
  readonly toolContext: ToolContext;
  readonly signal: AbortSignal;
  readonly limits?: Partial<RunLimits>;
  readonly onEvent?: (event: RunEvent) => void | Promise<void>;
  readonly initialEvents?: readonly RunEvent[];
}

export interface RunResult {
  readonly status: RunStatus;
  readonly exitCode: number;
  readonly finalText: string;
  readonly modelSteps: number;
  readonly toolCalls: number;
  readonly events: readonly RunEvent[];
  readonly message?: string;
}

interface StepOutcome {
  readonly text: string;
  readonly calls: readonly ToolCall[];
  readonly finishReason: ModelFinishReason;
  readonly usage: ModelUsage;
  readonly continuation?: ModelContinuation;
}

export async function runAgent(options: RunAgentOptions): Promise<RunResult> {
  const limits: RunLimits = {
    maxModelSteps: options.limits?.maxModelSteps ?? DEFAULT_MAX_MODEL_STEPS,
    maxToolCalls: options.limits?.maxToolCalls ?? DEFAULT_MAX_TOOL_CALLS,
  };
  const events: RunEvent[] = [];
  const emit = async (event: RunEvent) => {
    events.push(event);
    await options.onEvent?.(event);
  };
  const tools = toModelToolDefinitions(options.tools);
  let modelSteps = 0;
  let toolCalls = 0;
  let continuation: ModelContinuation | undefined;
  let toolResults: readonly ModelToolResult[] | undefined;
  let finalText = "";
  let overflowRecoveryUsed = false;
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

  for (const event of options.initialEvents ?? []) await emit(event);

  await emit({
    type: "run.started",
    prompt: options.prompt,
    ...(options.images?.length ? { imageCount: options.images.length } : {}),
    ...(options.context ? { context: options.context } : {}),
  });

  while (true) {
    if (options.signal.aborted) {
      return finish("cancelled", "The run was cancelled.");
    }
    if (modelSteps >= limits.maxModelSteps) {
      return finish("limit_reached", "The model-step limit was reached.");
    }

    const nextStep = modelSteps + 1;
    let request = {
      prompt: options.prompt,
      ...(options.images?.length ? { images: options.images } : {}),
      ...(options.instructions ? { instructions: options.instructions } : {}),
      ...(options.conversation ? { conversation: options.conversation } : {}),
      tools,
      ...(continuation ? { continuation } : {}),
      ...(toolResults ? { toolResults } : {}),
    };
    let budget = await budgetModelRequest({
      model: options.model,
      request,
      configuration: contextConfiguration,
      ...(options.omittedConversationMessages !== undefined
        ? { omittedMessageCount: options.omittedConversationMessages }
        : {}),
    });
    const capabilities = options.model.context;
    if (
      contextConfiguration.mode === "compact" &&
      !budget.fits &&
      continuation &&
      capabilities?.projectContinuation
    ) {
      await emit({
        type: "context.compaction.started",
        step: nextStep,
        strategy: "adapter-continuation",
        estimatedBeforeTokens: budget.estimatedInputTokens,
      });
      const projected = await capabilities.projectContinuation(
        continuation,
        Math.max(0, budget.availableInputTokens - budget.mandatoryTokens),
      );
      if (projected) {
        const projectedRequest = { ...request, continuation: projected };
        const projectedBudget = await budgetModelRequest({
          model: options.model,
          request: projectedRequest,
          configuration: contextConfiguration,
          ...(options.omittedConversationMessages !== undefined
            ? { omittedMessageCount: options.omittedConversationMessages }
            : {}),
        });
        const reclaimedTokens = Math.max(
          0,
          budget.estimatedInputTokens - projectedBudget.estimatedInputTokens,
        );
        if (reclaimedTokens >= 128) {
          request = projectedRequest;
          continuation = projected;
          await emit({
            type: "context.compaction.completed",
            step: nextStep,
            strategy: "adapter-continuation",
            estimatedBeforeTokens: budget.estimatedInputTokens,
            estimatedAfterTokens: projectedBudget.estimatedInputTokens,
            reclaimedTokens,
          });
          budget = projectedBudget;
        } else {
          await emit({
            type: "context.compaction.failed",
            step: nextStep,
            strategy: "adapter-continuation",
            message: `Continuation projection reclaimed only ${reclaimedTokens} tokens; minimum useful reclamation is 128.`,
          });
        }
      } else {
        await emit({
          type: "context.compaction.failed",
          step: nextStep,
          strategy: "adapter-continuation",
          message: "The adapter could not safely project its continuation.",
        });
      }
    }
    await emit({ type: "context.budgeted", step: nextStep, budget });
    if (!budget.mandatoryFits) {
      const message = contextLimitMessage(budget, "mandatory context");
      await emit({
        type: "context.limit_reached",
        step: nextStep,
        message,
        budget,
      });
      return finish("limit_reached", message);
    }
    if (!budget.fits) {
      const message = contextLimitMessage(budget, "complete request");
      await emit({ type: "context.warning", step: nextStep, message, budget });
      if (contextConfiguration.mode === "compact") {
        await emit({
          type: "context.limit_reached",
          step: nextStep,
          message,
          budget,
        });
        return finish("limit_reached", message);
      }
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
      );
    } catch (error) {
      if (options.signal.aborted || error instanceof RunCancellationError) {
        return finish("cancelled", "The run was cancelled.");
      }
      const stepFailure = error instanceof ModelStepFailure ? error : undefined;
      const overflowError = stepFailure?.error ?? error;
      const capabilities = options.model.context;
      if (
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
      return finish("failed", message);
    }

    await emit({
      type: "model.completed",
      step: modelSteps,
      finishReason: step.finishReason,
      usage: step.usage,
    });
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

    if (step.calls.length === 0) {
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
      return finish("completed");
    }

    if (toolCalls + step.calls.length > limits.maxToolCalls) {
      return finish("limit_reached", "The tool-call limit was reached.");
    }
    if (!step.continuation) {
      return finish(
        "failed",
        "The model adapter did not preserve continuation data for a tool call.",
      );
    }

    continuation = step.continuation;
    const nextResults: ModelToolResult[] = [];

    for (const call of step.calls) {
      toolCalls += 1;
      await emit({ type: "tool.proposed", step: modelSteps, call });
      const proposed = propose(call, options.tools);

      if (!proposed.ok) {
        await emit({
          type: "tool.failed",
          step: modelSteps,
          call,
          result: proposed.result,
        });
        nextResults.push({
          callId: call.id,
          toolName: call.name,
          result: proposed.result,
        });
        if (call.name === "load_skill" && !proposed.result.ok) {
          await emit({
            type: "skill.rejected",
            code: proposed.result.error.code,
            message: proposed.result.error.message,
          });
        }
        continue;
      }

      let decision: ApprovalDecision;
      try {
        decision = await options.policy.evaluate(
          proposed.action,
          options.signal,
        );
      } catch {
        if (options.signal.aborted) {
          return finish("cancelled", "The run was cancelled.");
        }
        return finish("failed", "The approval policy failed.");
      }
      await emit({
        type: "tool.decision",
        step: modelSteps,
        call,
        decision,
      });

      if (options.signal.aborted) {
        return finish("cancelled", "The run was cancelled.");
      }
      if (decision.kind === "deny") {
        return finish("denied", decision.reason);
      }
      if (decision.kind === "confirm") {
        if (!options.approvalChannel) {
          return finish(
            "denied",
            "The action requires approval, but no approval channel is available.",
          );
        }
        let approved: boolean;
        try {
          approved = await options.approvalChannel.request(
            proposed.action,
            options.signal,
            options.toolContext,
          );
        } catch {
          if (options.signal.aborted) {
            return finish("cancelled", "The run was cancelled.");
          }
          return finish("failed", "The approval channel failed.");
        }
        if (options.signal.aborted) {
          return finish("cancelled", "The run was cancelled.");
        }
        if (!approved) {
          return finish("denied", "The action was not approved.");
        }
      }

      await emit({ type: "tool.started", step: modelSteps, call });
      const result = await execute(proposed.action, options.toolContext);
      if (result.ok && decision.kind === "confirm") {
        options.policy.recordApproval?.(proposed.action);
      }
      await emit({
        type: result.ok ? "tool.completed" : "tool.failed",
        step: modelSteps,
        call,
        result,
      });
      if (call.name === "load_skill") {
        if (result.ok) {
          const output = result.output as {
            readonly id?: unknown;
            readonly name?: unknown;
            readonly source?: unknown;
            readonly invocation?: unknown;
            readonly relativePath?: unknown;
            readonly truncated?: unknown;
          };
          if (
            typeof output.id === "string" &&
            typeof output.name === "string" &&
            (output.source === "builtin" ||
              output.source === "user" ||
              output.source === "project") &&
            typeof output.relativePath === "string" &&
            (output.invocation === "model" ||
              output.invocation === "explicit-only")
          ) {
            if (!selectedSkillIds.has(output.id)) {
              selectedSkillIds.add(output.id);
              await emit({
                type: "skill.selected",
                id: output.id,
                name: output.name,
                source: output.source,
                reason: "automatic",
                invocation: output.invocation,
              });
            }
            await emit({
              type: "skill.loaded",
              id: output.id,
              name: output.name,
              source: output.source,
              relativePath: output.relativePath,
              truncated: output.truncated === true,
            });
          }
        } else {
          const id =
            typeof call.input === "object" &&
            call.input !== null &&
            "id" in call.input &&
            typeof call.input.id === "string"
              ? call.input.id
              : undefined;
          await emit({
            type: "skill.rejected",
            ...(id ? { id } : {}),
            code: result.error.code,
            message: result.error.message,
          });
        }
      }
      nextResults.push({
        callId: call.id,
        toolName: call.name,
        result,
      });
    }

    toolResults = nextResults;
  }

  async function finish(
    status: RunStatus,
    message?: string,
  ): Promise<RunResult> {
    const type = `run.${status}` as RunEvent["type"];
    await emit({ type, ...(message ? { message } : {}) } as RunEvent);
    return {
      status,
      exitCode: exitCodeForRunStatus(status),
      finalText,
      modelSteps,
      toolCalls,
      events,
      ...(message ? { message } : {}),
    };
  }
}

function contextLimitMessage(
  budget: ContextBudgetReport,
  category: string,
): string {
  const estimated =
    category === "mandatory context"
      ? budget.mandatoryTokens
      : budget.estimatedInputTokens;
  return `The ${category} is estimated at ${estimated} tokens, but ${budget.availableInputTokens} input tokens are available for ${budget.modelId} after a single ${budget.effectiveReserveTokens}-token output/safety reserve. Reduce instructions, tools, or history, or select a model with a larger context window.`;
}

export function exitCodeForRunStatus(status: RunStatus): number {
  switch (status) {
    case "completed":
      return 0;
    case "failed":
      return 1;
    case "limit_reached":
      return 3;
    case "denied":
      return 4;
    case "cancelled":
      return 130;
  }
}

async function consumeModelStep(
  model: ModelAdapter,
  request: Parameters<ModelAdapter["stream"]>[0],
  signal: AbortSignal,
  step: number,
  emit: (event: RunEvent) => Promise<void>,
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

function propose(
  call: ToolCall,
  tools: readonly ForgeTool[],
):
  | { readonly ok: true; readonly action: ProposedAction }
  | { readonly ok: false; readonly result: ToolResult } {
  const tool = tools.find((candidate) => candidate.name === call.name);
  if (!tool) {
    return toolFailure("unknown_tool", `Unknown tool "${call.name}".`);
  }
  const parsed = tool.inputSchema.safeParse(call.input);
  if (!parsed.success) {
    return toolFailure(
      "invalid_input",
      `Invalid input for tool "${call.name}".`,
    );
  }
  return { ok: true, action: { call, tool, input: parsed.data } };
}

async function execute(
  action: ProposedAction,
  context: ToolContext,
): Promise<ToolResult> {
  try {
    return await action.tool.execute(action.input, context);
  } catch {
    return {
      ok: false,
      error: {
        code: "io_error",
        message: "The tool failed unexpectedly.",
        retryable: true,
      },
    };
  }
}

function toolFailure(
  code: "invalid_input" | "unknown_tool",
  message: string,
): { readonly ok: false; readonly result: ToolResult } {
  return {
    ok: false,
    result: { ok: false, error: { code, message, retryable: false } },
  };
}

function toModelToolDefinitions(
  tools: readonly ForgeTool[],
): readonly ModelToolDefinition[] {
  return tools.map(({ name, description, inputSchema }) => ({
    name,
    description,
    inputSchema,
  }));
}

class RunCancellationError extends Error {}

class ModelStepFailure extends Error {
  constructor(
    readonly error: unknown,
    readonly producedEvidence: boolean,
  ) {
    super("The model step failed.", { cause: error });
  }
}

function safeErrorMessage(error: unknown): string {
  if (error instanceof RunCancellationError) {
    return "The run was cancelled.";
  }
  if (error instanceof Error && error.message) {
    return error.message;
  }
  return "The model step failed unexpectedly.";
}
