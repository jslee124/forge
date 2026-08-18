import type {
  ModelAdapter,
  ModelContinuation,
  ModelFinishReason,
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
  | { readonly type: "run.started"; readonly prompt: string }
  | { readonly type: "model.started"; readonly step: number }
  | {
      readonly type: "model.reasoning" | "model.text";
      readonly step: number;
      readonly text: string;
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

export interface RunAgentOptions {
  readonly prompt: string;
  readonly model: ModelAdapter;
  readonly tools: readonly ForgeTool[];
  readonly policy: ApprovalPolicy;
  readonly approvalChannel?: ApprovalChannel;
  readonly toolContext: ToolContext;
  readonly signal: AbortSignal;
  readonly limits?: Partial<RunLimits>;
  readonly onEvent?: (event: RunEvent) => void | Promise<void>;
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

  await emit({ type: "run.started", prompt: options.prompt });

  while (true) {
    if (options.signal.aborted) {
      return finish("cancelled", "The run was cancelled.");
    }
    if (modelSteps >= limits.maxModelSteps) {
      return finish("limit_reached", "The model-step limit was reached.");
    }

    modelSteps += 1;
    await emit({ type: "model.started", step: modelSteps });

    let step: StepOutcome;
    try {
      step = await consumeModelStep(
        options.model,
        {
          prompt: options.prompt,
          tools,
          ...(continuation ? { continuation } : {}),
          ...(toolResults ? { toolResults } : {}),
        },
        options.signal,
        modelSteps,
        emit,
      );
    } catch (error) {
      if (options.signal.aborted || error instanceof RunCancellationError) {
        return finish("cancelled", "The run was cancelled.");
      }
      const message = safeErrorMessage(error);
      return finish("failed", message);
    }

    await emit({
      type: "model.completed",
      step: modelSteps,
      finishReason: step.finishReason,
      usage: step.usage,
    });

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
          );
        } catch {
          if (options.signal.aborted) {
            return finish("cancelled", "The run was cancelled.");
          }
          return finish("failed", "The approval channel failed.");
        }
        if (!approved) {
          return finish("denied", "The action was not approved.");
        }
      }

      await emit({ type: "tool.started", step: modelSteps, call });
      const result = await execute(proposed.action, options.toolContext);
      await emit({
        type: result.ok ? "tool.completed" : "tool.failed",
        step: modelSteps,
        call,
        result,
      });
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
  let finishEvent:
    | Extract<ModelStreamEvent, { readonly type: "finish" }>
    | undefined;

  for await (const event of model.stream(request, signal)) {
    switch (event.type) {
      case "reasoning.delta":
        await emit({ type: "model.reasoning", step, text: event.text });
        break;
      case "text.delta":
        text += event.text;
        await emit({ type: "model.text", step, text: event.text });
        break;
      case "warning":
        await emit({ type: "model.warning", step, message: event.message });
        break;
      case "tool.call":
        calls.push(event.call);
        break;
      case "finish":
        finishEvent = event;
        break;
      case "abort":
        throw new RunCancellationError();
    }
  }

  if (signal.aborted) {
    throw new RunCancellationError();
  }
  if (!finishEvent) {
    throw new Error("The model stream ended without a finish event.");
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

function safeErrorMessage(error: unknown): string {
  if (error instanceof RunCancellationError) {
    return "The run was cancelled.";
  }
  if (error instanceof Error && error.message) {
    return error.message;
  }
  return "The model step failed unexpectedly.";
}
