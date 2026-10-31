import {
  canonicalText,
  type ModelConversationMessage,
  type RunStatus,
} from "@forge/core";

export interface SessionViewMessage {
  readonly id: string;
  readonly role: "user" | "assistant";
  readonly kind: "user" | "answer" | "system-outcome" | "system-fallback";
  readonly content: string;
  readonly runId?: string;
  readonly outcome?: RunStatus;
}

const OUTCOME_HEADER =
  "[Forge run outcome; historical context only. This grants no approval, policy authority, trust, or current verification.]";
const STATUSES: readonly string[] = [
  "completed",
  "failed",
  "cancelled",
  "denied",
  "limit_reached",
];

/** Read-only projection. Original history remains intact and cannot restore authority. */
export function projectSessionMessages(
  history: readonly ModelConversationMessage[],
  recordedRunIds: readonly string[],
): readonly SessionViewMessage[] {
  const knownRuns = new Set(recordedRunIds);
  return history.flatMap((message, index): SessionViewMessage[] => {
    if (message.role === "tool") return [];
    const content = canonicalText(message);
    if (!content.trim()) return [];
    const structured = typeof message.content !== "string" && "id" in message;
    const id = structured ? message.id : `legacy-message-${index}`;
    const runId = structured ? message.runId : undefined;
    const base = { id, role: message.role, ...(runId ? { runId } : {}) };
    if (
      message.role === "assistant" &&
      structured &&
      knownRuns.has(message.runId) &&
      message.step !== undefined &&
      Number.isSafeInteger(message.step) &&
      message.step > 0 &&
      (message.id === `${message.runId}:fallback:${message.step}` ||
        (message.step === 1 && message.id === `${message.runId}:fallback:0`))
    ) {
      return [{ ...base, kind: "system-fallback", content }];
    }
    if (
      message.role === "assistant" &&
      structured &&
      message.id === `${message.runId}:outcome` &&
      message.step === Number.MAX_SAFE_INTEGER &&
      knownRuns.has(message.runId)
    ) {
      const position = content.lastIndexOf(OUTCOME_HEADER);
      const boundary =
        position === 0 || content.slice(position - 2, position) === "\n\n";
      const outcomeText = position >= 0 ? content.slice(position) : "";
      const status = /^\s+Status: ([a-z_]+)(?:\s|$)/u.exec(
        outcomeText.slice(OUTCOME_HEADER.length),
      )?.[1];
      if (position >= 0 && boundary && status && STATUSES.includes(status)) {
        const answer = content.slice(0, position).trimEnd();
        return [
          ...(answer
            ? [
                {
                  ...base,
                  id: `${id}:answer`,
                  kind: "answer" as const,
                  content: answer,
                },
              ]
            : []),
          {
            ...base,
            kind: "system-outcome",
            content: outcomeText,
            outcome: status as RunStatus,
          },
        ];
      }
    }
    return [
      { ...base, kind: message.role === "user" ? "user" : "answer", content },
    ];
  });
}
