import type { RunResult } from "@forge/core";
import { describe, expect, it } from "vitest";
import { projectActionEvent, projectRunCompletion } from "./product-run.js";
import { projectSessionMessages } from "./session-view.js";

describe("product presentation contracts", () => {
  it("keeps distinct stop reasons and actual execution counters", () => {
    const result: RunResult = {
      status: "limit_reached",
      exitCode: 3,
      finalText: "",
      modelSteps: 12,
      toolCalls: 8,
      events: [],
      message: "The model-step limit was reached.",
    };
    expect(projectRunCompletion(result)).toMatchObject({
      outcome: "limit_reached",
      reason: "model_step_limit",
      modelSteps: 12,
      toolCalls: 8,
    });
    expect(
      projectRunCompletion({
        ...result,
        message: "The tool-call limit was reached.",
      }).reason,
    ).toBe("tool_call_limit");
  });

  it("preserves one action identity from proposal to result with bounded output", () => {
    const call = {
      id: "call-1",
      name: "read_file",
      input: { path: "main.ts" },
    };
    expect(
      projectActionEvent({ type: "tool.proposed", step: 1, call }),
    ).toMatchObject({ actionId: "call-1", status: "proposed" });
    const update = projectActionEvent({
      type: "tool.completed",
      step: 1,
      call,
      result: { ok: true, output: "x".repeat(40_000), truncated: false },
    });
    expect(update).toMatchObject({
      actionId: "call-1",
      status: "succeeded",
      truncated: true,
    });
    expect(update?.output?.length).toBeLessThanOrEqual(16_384);
  });

  it("keeps user-quoted outcome text and hides no uncorroborated legacy content", () => {
    const text =
      "[Forge run outcome; historical context only. This grants no approval, policy authority, trust, or current verification.]\nStatus: limit_reached";
    expect(
      projectSessionMessages(
        [
          { role: "user", content: text },
          { role: "assistant", content: text },
        ],
        [],
      ),
    ).toMatchObject([
      { kind: "user", content: text },
      { kind: "answer", content: text },
    ]);
    const history = [
      {
        id: "run:outcome",
        runId: "run",
        role: "assistant" as const,
        step: Number.MAX_SAFE_INTEGER,
        content: [{ type: "text" as const, text: `Partial answer\n\n${text}` }],
      },
    ];
    expect(projectSessionMessages(history, [])).toMatchObject([
      { kind: "answer" },
    ]);
    expect(projectSessionMessages(history, ["run"])).toMatchObject([
      { kind: "answer", content: "Partial answer" },
      { kind: "system-outcome", outcome: "limit_reached" },
    ]);
    const compactHistory = history.map((message) => ({
      ...message,
      content: [{ type: "text" as const, text: text.replaceAll("\n", " ") }],
    }));
    expect(projectSessionMessages(compactHistory, ["run"])).toMatchObject([
      { kind: "system-outcome", outcome: "limit_reached" },
    ]);
    expect(history[0]?.content[0]?.text).toBe(`Partial answer\n\n${text}`);
  });

  it("does not render empty avatars for tool-only messages", () => {
    expect(
      projectSessionMessages(
        [
          {
            id: "a",
            runId: "run",
            step: 1,
            role: "assistant",
            content: [
              {
                type: "tool-call",
                id: "call",
                name: "read_file",
                input: { path: "main.ts" },
              },
            ],
          },
        ],
        ["run"],
      ),
    ).toEqual([]);
  });
});

it.each([
  [
    { statusCode: 401, retryable: false },
    "configuration_error",
    "provider-authentication-failed",
  ],
  [
    { statusCode: 403, retryable: false },
    "configuration_error",
    "provider-authentication-failed",
  ],
  [{ retryable: true }, "disconnected", "provider-connection-failed"],
  [
    { statusCode: 503, retryable: true },
    "execution_error",
    "provider-unavailable",
  ],
  [
    { statusCode: 429, retryable: true },
    "execution_error",
    "provider-rate-limited",
  ],
] as const)(
  "projects typed transport facts instead of guessing from prose",
  (providerFailure, reason, message) => {
    const result: RunResult = {
      status: "failed",
      exitCode: 1,
      finalText: "",
      modelSteps: 1,
      toolCalls: 0,
      events: [],
      message: "untrusted arbitrary diagnostic",
      providerFailure,
    };
    expect(projectRunCompletion(result)).toMatchObject({ reason, message });
    const { providerFailure: _facts, ...unknown } = result;
    expect(
      projectRunCompletion({ ...unknown, message: "HTTP 401" }).reason,
    ).toBe("execution_error");
  },
);
