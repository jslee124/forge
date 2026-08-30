import { randomUUID } from "node:crypto";

import {
  type ApprovalDescriptor,
  type ApprovalResponse,
  describeApproval,
  type SessionApprovalStore,
} from "./approval.js";
import {
  observePromptPrefix,
  type PromptPrefixInputs,
  type PromptPrefixObservation,
} from "./cache.js";
import {
  budgetModelRequest,
  type ContextBudgetReport,
  type ContextConfiguration,
  type ContextPressureMode,
  type ContextPressureSnapshot,
  contextPressureSnapshot,
  DEFAULT_CONTEXT_CONFIGURATION,
} from "./context.js";
import type {
  CanonicalConversationMessage,
  ModelAdapter,
  ModelContinuation,
  ModelConversationMessage,
  ModelFinishReason,
  ModelImageInput,
  ModelStreamEvent,
  ModelToolResult,
  ModelUsage,
} from "./model.js";
import { validateCanonicalConversation } from "./model.js";
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
      readonly type: "docs.search";
      readonly query: string;
      readonly resultCount: number;
      readonly locale: "en" | "zh-CN";
      readonly fallback: boolean;
    }
  | {
      readonly type: "docs.read";
      readonly reference: string;
      readonly truncated: boolean;
    }
  | {
      readonly type: "docs.rejected";
      readonly tool: "search_forge_docs" | "read_forge_doc";
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
      readonly type: "context.pressure";
      readonly step: number;
      readonly snapshot: ContextPressureSnapshot;
    }
  | {
      readonly type: "cache.prefix";
      readonly step: number;
      readonly observation: PromptPrefixObservation;
    }
  | {
      readonly type: "cache.observed";
      readonly schemaVersion: 1;
      readonly step: number;
      readonly inputTokens?: number;
      readonly cacheReadTokens?: number;
      readonly cacheWriteTokens?: number;
      readonly uncachedInputTokens?: number;
      readonly hitRatio?: number;
    }
  | {
      readonly type: "approval.scope-decision";
      readonly schemaVersion: 1;
      readonly actionId: string;
      readonly decision: "allow-once" | "allow-session" | "deny";
      readonly scopeId?: string;
      readonly provenance: "user" | "policy";
      readonly persisted: false;
    }
  | {
      readonly type: "update.availability";
      readonly schemaVersion: 1;
      readonly state:
        | "cached"
        | "refreshing"
        | "available"
        | "current"
        | "failed"
        | "disabled";
      readonly currentVersion: string;
      readonly latestVersion?: string;
      readonly source: "npm-registry";
    }
  | {
      readonly type: "context.auto-paused";
      readonly step: number;
      readonly reason:
        | "cancelled"
        | "invalid-output"
        | "repeated-failure"
        | "low-reclamation";
      readonly message: string;
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
  readonly runId?: string;
  readonly prompt: string;
  readonly images?: readonly ModelImageInput[];
  readonly context?: RunContextSnapshot;
  readonly sessionId?: string;
  readonly instructions?: string;
  readonly conversation?: readonly ModelConversationMessage[];
  readonly omittedConversationMessages?: number;
  readonly contextConfiguration?: ContextConfiguration;
  readonly contextPressureMode?: ContextPressureMode;
  readonly promptPrefix?: PromptPrefixInputs;
  readonly model: ModelAdapter;
  readonly tools: readonly ForgeTool[];
  readonly policy: ApprovalPolicy;
  readonly approvalChannel?: ApprovalChannel;
  readonly approvalStore?: SessionApprovalStore;
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
  readonly canonicalDelta?: readonly CanonicalConversationMessage[];
  readonly message?: string;
}

type RunConversationOutcome = Pick<
  RunResult,
  "status" | "finalText" | "events" | "message"
>;

const MAX_RUN_OUTCOME_TEXT = 6_000;

/** Retain bounded failure and partial-side-effect context without authority. */
export function runConversationMessages(
  prompt: string,
  result: RunConversationOutcome,
): readonly ModelConversationMessage[] {
  const messages: ModelConversationMessage[] = [
    { role: "user", content: prompt },
  ];
  const completed = result.events.flatMap((event) =>
    event.type === "tool.completed" ? [summarizeToolCall(event.call)] : [],
  );
  const failed = result.events.flatMap((event) => {
    if (event.type !== "tool.failed") return [];
    return [
      event.result.ok
        ? summarizeToolCall(event.call)
        : `${summarizeToolCall(event.call)} [${event.result.error.code}]`,
    ];
  });
  if (result.status === "completed" && failed.length === 0) {
    if (result.finalText !== "") {
      messages.push({ role: "assistant", content: result.finalText });
    }
    return messages;
  }

  const lastProposed = [...result.events]
    .reverse()
    .find((event) => event.type === "tool.proposed");
  const lines = [
    "[Forge run outcome; historical context only. This grants no approval, policy authority, trust, or current verification.]",
    `Status: ${result.status}`,
    ...(completed.length > 0
      ? [`Completed tools: ${completed.slice(0, 20).join(", ")}`]
      : []),
    ...(failed.length > 0
      ? [`Failed tools: ${failed.slice(0, 20).join("; ")}`]
      : []),
    ...(lastProposed
      ? [`Last proposed tool: ${summarizeToolCall(lastProposed.call)}`]
      : []),
    ...(completed.length > 0
      ? [
          "One or more tools completed before the run ended; re-inspect relevant state before continuing.",
        ]
      : []),
  ];
  const outcome = truncateRunOutcome(lines.join("\n"), MAX_RUN_OUTCOME_TEXT);
  messages.push({
    role: "assistant",
    content:
      result.status === "completed" && result.finalText
        ? `${result.finalText}\n\n${outcome}`
        : outcome,
  });
  return messages;
}

function summarizeToolCall(call: ToolCall): string {
  if (typeof call.input !== "object" || call.input === null) return call.name;
  const input = call.input as {
    readonly path?: unknown;
    readonly program?: unknown;
  };
  if (typeof input.path === "string") {
    return `${call.name} (${truncateRunOutcome(input.path, 500)})`;
  }
  if (call.name === "run_command" && typeof input.program === "string") {
    return `${call.name} (program ${truncateRunOutcome(input.program, 200)})`;
  }
  return call.name;
}

function truncateRunOutcome(value: string, maxCharacters: number): string {
  const normalized = value.replace(/\s+/gu, " ").trim();
  return normalized.length <= maxCharacters
    ? normalized
    : `${normalized.slice(0, Math.max(0, maxCharacters - 1))}…`;
}

interface StepOutcome {
  readonly text: string;
  readonly calls: readonly ToolCall[];
  readonly finishReason: ModelFinishReason;
  readonly usage: ModelUsage;
  readonly continuation?: ModelContinuation;
}

export async function runAgent(options: RunAgentOptions): Promise<RunResult> {
  const runId = options.runId ?? randomUUID();
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
    (contextConfiguration.mode === "compact"
      ? "auto-default"
      : contextConfiguration.mode);

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
    let request: import("./model.js").ModelRequest = {
      prompt: options.prompt,
      ...(options.images?.length ? { images: options.images } : {}),
      ...(options.instructions ? { instructions: options.instructions } : {}),
      ...(options.conversation ? { conversation: options.conversation } : {}),
      tools,
      ...(continuation ? { continuation } : {}),
      ...(toolResults ? { toolResults } : {}),
    };
    if (activePromptPrefix) {
      const observation = observePromptPrefix({
        request,
        inputs: activePromptPrefix,
        capabilities: options.model.promptCache ?? { mode: "unsupported" },
        ...(previousPrefix ? { previous: previousPrefix } : {}),
        ...(options.sessionId ? { sessionId: options.sessionId } : {}),
        ...(options.context?.workspaceRoot
          ? { workspaceRoot: options.context.workspaceRoot }
          : {}),
      });
      previousPrefix = observation;
      await emit({ type: "cache.prefix", step: nextStep, observation });
      if (observation.cacheMode !== "unsupported") {
        request = {
          ...request,
          cacheControl: {
            mode: observation.cacheMode,
            ...(observation.cacheKey ? { key: observation.cacheKey } : {}),
            stablePrefixHash: observation.stablePrefixHash,
          },
        };
      }
    }
    let budget = await budgetModelRequest({
      model: options.model,
      request,
      configuration: contextConfiguration,
      ...(options.omittedConversationMessages !== undefined
        ? { omittedMessageCount: options.omittedConversationMessages }
        : {}),
    });
    let pressure = contextPressureSnapshot(
      budget,
      autoCompactionPaused ? "paused" : pressureMode,
    );
    await emit({
      type: "context.pressure",
      step: nextStep,
      snapshot: pressure,
    });
    const capabilities = options.model.context;
    const activationThreshold =
      contextConfiguration.activationThreshold ?? 0.78;
    if (
      contextConfiguration.mode === "compact" &&
      !autoCompactionPaused &&
      pressure.ratio >= activationThreshold &&
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
        const minimumUsefulReclamation = Math.max(
          contextConfiguration.minimumReclaimTokens ?? 8_000,
          Math.ceil(
            budget.estimatedInputTokens *
              (contextConfiguration.minimumReclaimRatio ?? 0.2),
          ),
        );
        if (reclaimedTokens >= minimumUsefulReclamation) {
          request = projectedRequest;
          continuation = projected;
          if (activePromptPrefix) {
            activePromptPrefix = {
              ...activePromptPrefix,
              checkpointGeneration: `${activePromptPrefix.checkpointGeneration}:adapter-${nextStep}`,
            };
            const compactedPrefix = observePromptPrefix({
              request,
              inputs: activePromptPrefix,
              capabilities: options.model.promptCache ?? {
                mode: "unsupported",
              },
              ...(previousPrefix ? { previous: previousPrefix } : {}),
              ...(options.sessionId ? { sessionId: options.sessionId } : {}),
              ...(options.context?.workspaceRoot
                ? { workspaceRoot: options.context.workspaceRoot }
                : {}),
            });
            previousPrefix = compactedPrefix;
            await emit({
              type: "cache.prefix",
              step: nextStep,
              observation: compactedPrefix,
            });
            if (compactedPrefix.cacheMode !== "unsupported") {
              request = {
                ...request,
                cacheControl: {
                  mode: compactedPrefix.cacheMode,
                  ...(compactedPrefix.cacheKey
                    ? { key: compactedPrefix.cacheKey }
                    : {}),
                  stablePrefixHash: compactedPrefix.stablePrefixHash,
                },
              };
            }
          }
          await emit({
            type: "context.compaction.completed",
            step: nextStep,
            strategy: "adapter-continuation",
            estimatedBeforeTokens: budget.estimatedInputTokens,
            estimatedAfterTokens: projectedBudget.estimatedInputTokens,
            reclaimedTokens,
          });
          budget = projectedBudget;
          pressure = contextPressureSnapshot(
            projectedBudget,
            pressureMode,
            "compacted",
          );
          await emit({
            type: "context.pressure",
            step: nextStep,
            snapshot: pressure,
          });
        } else {
          await emit({
            type: "context.compaction.failed",
            step: nextStep,
            strategy: "adapter-continuation",
            message: `Continuation projection reclaimed only ${reclaimedTokens} tokens; minimum useful reclamation is ${minimumUsefulReclamation}.`,
          });
          autoCompactionPaused = true;
          await emit({
            type: "context.auto-paused",
            step: nextStep,
            reason: "low-reclamation",
            message:
              "Automatic compaction paused because projection reclaimed too little context.",
          });
        }
      } else {
        await emit({
          type: "context.compaction.failed",
          step: nextStep,
          strategy: "adapter-continuation",
          message: "The adapter could not safely project its continuation.",
        });
        autoCompactionPaused = true;
        await emit({
          type: "context.auto-paused",
          step: nextStep,
          reason: "invalid-output",
          message:
            "Automatic compaction paused because the adapter returned no safe projection.",
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
      if (step.text !== "") {
        canonicalDelta.push({
          id: `${runId}:assistant:${modelSteps}`,
          runId,
          step: modelSteps,
          role: "assistant",
          content: [{ type: "text", text: step.text }],
        });
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

      const deniedCallKey = `${call.name}:${JSON.stringify(call.input)}`;
      if (deniedCalls.has(deniedCallKey)) {
        const result: ToolResult = {
          ok: false,
          error: {
            code: "approval_denied",
            message:
              "This exact action was already denied during the current run. Do not retry it unchanged.",
            retryable: false,
          },
        };
        await emit({ type: "tool.failed", step: modelSteps, call, result });
        nextResults.push({ callId: call.id, toolName: call.name, result });
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
        deniedCalls.add(deniedCallKey);
        const result: ToolResult = {
          ok: false,
          error: {
            code: "approval_denied",
            message: `Policy denied this action: ${decision.reason}`,
            retryable: false,
          },
        };
        await emit({ type: "tool.failed", step: modelSteps, call, result });
        nextResults.push({ callId: call.id, toolName: call.name, result });
        continue;
      }
      if (decision.kind === "confirm") {
        let descriptor: ApprovalDescriptor;
        try {
          descriptor = await describeApproval(
            proposed.action,
            options.toolContext,
          );
        } catch {
          return finish(
            "failed",
            "The approval descriptor could not be created.",
          );
        }
        const matchedGrant = options.approvalStore?.match(descriptor);
        if (matchedGrant) {
          await emit({
            type: "approval.scope-decision",
            schemaVersion: 1,
            actionId: call.id,
            decision: "allow-session",
            scopeId: matchedGrant.id,
            provenance: "policy",
            persisted: false,
          });
        } else if (!options.approvalChannel) {
          return finish(
            "denied",
            "The action requires approval, but no approval channel is available.",
          );
        } else {
          let response: ApprovalResponse;
          try {
            const received = options.approvalChannel.requestStructured
              ? await options.approvalChannel.requestStructured(
                  proposed.action,
                  options.signal,
                  options.toolContext,
                  descriptor,
                )
              : await options.approvalChannel.request(
                  proposed.action,
                  options.signal,
                  options.toolContext,
                );
            response =
              typeof received === "boolean"
                ? { kind: received ? "allow-once" : "deny" }
                : received;
          } catch {
            if (options.signal.aborted) {
              return finish("cancelled", "The run was cancelled.");
            }
            return finish("failed", "The approval channel failed.");
          }
          if (options.signal.aborted) {
            return finish("cancelled", "The run was cancelled.");
          }
          if (response.kind === "preflight-failed") {
            await emit({
              type: "tool.failed",
              step: modelSteps,
              call,
              result: response.result,
            });
            nextResults.push({
              callId: call.id,
              toolName: call.name,
              result: response.result,
            });
            continue;
          }
          if (response.kind === "deny") {
            const feedback = response.feedback?.trim().slice(0, 2_000);
            await emit({
              type: "approval.scope-decision",
              schemaVersion: 1,
              actionId: call.id,
              decision: "deny",
              provenance: "user",
              persisted: false,
            });
            deniedCalls.add(deniedCallKey);
            const result: ToolResult = {
              ok: false,
              error: {
                code: "approval_denied",
                message: feedback
                  ? `The user denied this action: ${feedback}`
                  : "The user denied this action. Do not retry it unchanged; explain the limitation or choose a safer alternative.",
                retryable: Boolean(feedback),
              },
            };
            await emit({ type: "tool.failed", step: modelSteps, call, result });
            nextResults.push({ callId: call.id, toolName: call.name, result });
            continue;
          }
          if (response.kind === "allow-session") {
            const scope = descriptor.allowedScopes[0];
            if (!scope || !options.approvalStore) {
              return finish(
                "denied",
                "A session grant is not permitted for this action.",
              );
            }
            const grant = options.approvalStore.grant(scope);
            await emit({
              type: "approval.scope-decision",
              schemaVersion: 1,
              actionId: call.id,
              decision: "allow-session",
              scopeId: grant.id,
              provenance: "user",
              persisted: false,
            });
          } else {
            await emit({
              type: "approval.scope-decision",
              schemaVersion: 1,
              actionId: call.id,
              decision: "allow-once",
              provenance: "user",
              persisted: false,
            });
          }
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
      if (call.name === "search_forge_docs") {
        if (result.ok) {
          const output = result.output as {
            readonly query?: unknown;
            readonly preferredLocale?: unknown;
            readonly fallback?: unknown;
            readonly results?: unknown;
          };
          if (
            typeof output.query === "string" &&
            (output.preferredLocale === "en" ||
              output.preferredLocale === "zh-CN") &&
            Array.isArray(output.results)
          ) {
            await emit({
              type: "docs.search",
              query: output.query,
              resultCount: output.results.length,
              locale: output.preferredLocale,
              fallback: typeof output.fallback === "string",
            });
          }
        } else {
          await emit({
            type: "docs.rejected",
            tool: "search_forge_docs",
            code: result.error.code,
            message: result.error.message,
          });
        }
      }
      if (call.name === "read_forge_doc") {
        if (result.ok) {
          const output = result.output as {
            readonly reference?: unknown;
            readonly truncated?: unknown;
          };
          if (typeof output.reference === "string") {
            await emit({
              type: "docs.read",
              reference: output.reference,
              truncated: output.truncated === true,
            });
          }
        } else {
          await emit({
            type: "docs.rejected",
            tool: "read_forge_doc",
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
      pendingToolOutcomes = [
        ...pendingToolOutcomes,
        { callId: call.id, toolName: call.name, result },
      ];
    }

    toolResults = nextResults;
    pendingExchange = canonicalExchange(runId, modelSteps, step, nextResults);
  }

  async function finish(
    status: RunStatus,
    message?: string,
  ): Promise<RunResult> {
    const type = `run.${status}` as RunEvent["type"];
    await emit({ type, ...(message ? { message } : {}) } as RunEvent);
    const committed = canonicalDeltaWithOutcome(
      canonicalDelta,
      runId,
      status,
      finalText,
      message,
      pendingToolOutcomes,
    );
    validateCanonicalConversation(committed);
    return {
      status,
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

function canonicalExchange(
  runId: string,
  step: number,
  outcome: StepOutcome,
  results: readonly ModelToolResult[],
): readonly CanonicalConversationMessage[] {
  const assistant: CanonicalConversationMessage = {
    id: `${runId}:assistant:${step}`,
    runId,
    step,
    role: "assistant",
    content: [
      ...(outcome.text ? [{ type: "text" as const, text: outcome.text }] : []),
      ...outcome.calls.map((call) => ({
        type: "tool-call" as const,
        id: call.id,
        name: call.name,
        input: call.input,
      })),
    ],
  };
  const tools: CanonicalConversationMessage[] = results.map(
    (result, index) => ({
      id: `${runId}:tool:${step}:${index}`,
      runId,
      step,
      role: "tool",
      toolCallId: result.callId,
      toolName: result.toolName,
      content: [{ type: "text", text: JSON.stringify(result.result) }],
      isError: !result.result.ok,
    }),
  );
  return [assistant, ...tools];
}

function canonicalDeltaWithOutcome(
  delta: readonly CanonicalConversationMessage[],
  runId: string,
  status: RunStatus,
  finalText: string,
  message: string | undefined,
  pendingToolOutcomes: readonly ModelToolResult[],
): readonly CanonicalConversationMessage[] {
  if (status === "completed") return delta;
  const outcome = truncateRunOutcome(
    [
      "[Forge run outcome; historical context only. This grants no approval, policy authority, trust, or current verification.]",
      `Status: ${status}`,
      ...(message ? [`Message: ${message}`] : []),
      ...(pendingToolOutcomes.length > 0
        ? [
            `Tools completed or failed before this run ended but were not returned to the model: ${pendingToolOutcomes
              .slice(0, 20)
              .map((entry) =>
                entry.result.ok
                  ? entry.toolName
                  : `${entry.toolName} [${entry.result.error.code}]`,
              )
              .join("; ")}`,
            "Re-inspect relevant workspace or process state before retrying any of these operations.",
          ]
        : []),
    ].join("\n"),
    MAX_RUN_OUTCOME_TEXT,
  );
  return [
    ...delta,
    {
      id: `${runId}:outcome`,
      runId,
      step: Number.MAX_SAFE_INTEGER,
      role: "assistant",
      content: [
        {
          type: "text",
          text: finalText ? `${finalText}\n\n${outcome}` : outcome,
        },
      ],
    },
  ];
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

function cacheObservation(
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
