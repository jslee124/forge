import { describe, expect, it } from "vitest";
import type { RunEvent, RunPayload } from "../../shared/run-protocol.js";
import { activityReducer, initialActivity } from "./run-state.js";

function event(payload: RunPayload, sequence: number): RunEvent {
  return {
    type: "run-event",
    schemaVersion: 2,
    occurredAt: "2026-10-25T00:00:00.000Z",
    sessionId: "session",
    runId: "run",
    requestId: "request",
    sequence,
    payload,
  };
}

describe("semantic run activity", () => {
  it("merges 10,000 reasoning fragments instead of making 10,000 rows", () => {
    let state = initialActivity;
    for (let i = 1; i <= 10_000; i++)
      state = activityReducer(state, {
        type: "event",
        event: event(
          { type: "detail", kind: "reasoning", step: 1, text: "." },
          i,
        ),
      });
    expect(state.items).toHaveLength(1);
    expect(state.items[0]?.text).toHaveLength(10_000);
    state = activityReducer(state, {
      type: "event",
      event: event(
        { type: "detail", kind: "reasoning", step: 2, text: "next" },
        10_001,
      ),
    });
    expect(state.items).toHaveLength(2);
  });

  it("keeps a single action row and retains approval decisions", () => {
    let state = initialActivity;
    for (const [index, status] of [
      "proposed",
      "running",
      "succeeded",
    ].entries())
      state = activityReducer(state, {
        type: "event",
        event: event(
          {
            type: "action",
            action: {
              actionId: "a",
              step: 1,
              tool: "read_file",
              input: "{}",
              status: status as "proposed" | "running" | "succeeded",
            },
          },
          index + 1,
        ),
      });
    state = activityReducer(state, {
      type: "event",
      event: event(
        { type: "approval", approvalId: "a", description: "Read?" },
        4,
      ),
    });
    state = activityReducer(state, {
      type: "event",
      event: event(
        { type: "approval-resolved", approvalId: "a", allow: false },
        5,
      ),
    });
    expect(state.items).toHaveLength(2);
    expect(state.items[0]?.action?.status).toBe("succeeded");
    expect(state.items[1]?.decision).toBe("denied");
  });

  it("exposes text and history truncation and resets without reusing past decisions", () => {
    let state = activityReducer(initialActivity, {
      type: "event",
      event: event(
        { type: "detail", kind: "reasoning", text: "x".repeat(70_000) },
        1,
      ),
    });
    expect(state.items[0]?.truncated).toBe(true);
    for (let i = 2; i <= 502; i++)
      state = activityReducer(state, {
        type: "event",
        event: event({ type: "detail", kind: "error", text: `${i}` }, i),
      });
    expect(state.items).toHaveLength(500);
    expect(state.omitted).toBe(2);
    expect(activityReducer(state, { type: "reset" })).toEqual(initialActivity);
  });
});
