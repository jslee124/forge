import type {
  CanonicalConversationMessage,
  ModelConversationMessage,
  ModelToolResult,
} from "./model.js";
import type { RunResult, RunStatus, StepOutcome } from "./runtime-events.js";
import type { ToolCall } from "./tools.js";

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

export function summarizeToolCall(call: ToolCall): string {
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

export function truncateRunOutcome(
  value: string,
  maxCharacters: number,
): string {
  const normalized = value.replace(/\s+/gu, " ").trim();
  return normalized.length <= maxCharacters
    ? normalized
    : `${normalized.slice(0, Math.max(0, maxCharacters - 1))}…`;
}

export function canonicalExchange(
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

export function canonicalDeltaWithOutcome(
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
