import {
  type ApprovalDescriptor,
  type ApprovalResponse,
  describeApproval,
} from "./approval.js";
import type { ModelToolResult } from "./model.js";
import type { ApprovalDecision, ProposedAction } from "./policy.js";
import type { RunAgentOptions, RunEvent, RunStatus } from "./runtime-events.js";
import type { ForgeTool, ToolCall, ToolContext, ToolResult } from "./tools.js";

export type ToolBatchOutcome =
  | {
      readonly kind: "done";
      readonly results: readonly ModelToolResult[];
      readonly toolCalls: number;
      readonly pendingToolOutcomes: readonly ModelToolResult[];
    }
  | {
      readonly kind: "abort";
      readonly status: RunStatus;
      readonly message: string;
      readonly toolCalls: number;
      readonly pendingToolOutcomes: readonly ModelToolResult[];
    };

/** Validate, evaluate policy, obtain approvals, and execute one batch of tool calls. */
export async function executeToolCallBatch(params: {
  readonly calls: readonly ToolCall[];
  readonly options: RunAgentOptions;
  readonly modelSteps: number;
  readonly toolCalls: number;
  readonly deniedCalls: Set<string>;
  readonly selectedSkillIds: Set<string>;
  readonly pendingToolOutcomes: readonly ModelToolResult[];
  readonly emit: (event: RunEvent) => Promise<void>;
}): Promise<ToolBatchOutcome> {
  const { calls, options, modelSteps, deniedCalls, selectedSkillIds, emit } =
    params;
  let { toolCalls } = params;
  const updatedPendingOutcomes: ModelToolResult[] = [
    ...params.pendingToolOutcomes,
  ];
  const nextResults: ModelToolResult[] = [];

  const abort = (status: RunStatus, message: string): ToolBatchOutcome => ({
    kind: "abort",
    status,
    message,
    toolCalls,
    pendingToolOutcomes: updatedPendingOutcomes,
  });

  for (const call of calls) {
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
      decision = await options.policy.evaluate(proposed.action, options.signal);
    } catch {
      if (options.signal.aborted) {
        return abort("cancelled", "The run was cancelled.");
      }
      return abort("failed", "The approval policy failed.");
    }
    await emit({
      type: "tool.decision",
      step: modelSteps,
      call,
      decision,
    });

    if (options.signal.aborted) {
      return abort("cancelled", "The run was cancelled.");
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
        return abort("failed", "The approval descriptor could not be created.");
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
        return abort(
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
            return abort("cancelled", "The run was cancelled.");
          }
          return abort("failed", "The approval channel failed.");
        }
        if (options.signal.aborted) {
          return abort("cancelled", "The run was cancelled.");
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
            return abort(
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
    await emitToolDomainEvents(call, result, selectedSkillIds, emit);
    nextResults.push({
      callId: call.id,
      toolName: call.name,
      result,
    });
    updatedPendingOutcomes.push({
      callId: call.id,
      toolName: call.name,
      result,
    });
  }

  return {
    kind: "done",
    results: nextResults,
    toolCalls,
    pendingToolOutcomes: updatedPendingOutcomes,
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

async function emitToolDomainEvents(
  call: ToolCall,
  result: ToolResult,
  selectedSkillIds: Set<string>,
  emit: (event: RunEvent) => Promise<void>,
): Promise<void> {
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
        (output.invocation === "model" || output.invocation === "explicit-only")
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
}
