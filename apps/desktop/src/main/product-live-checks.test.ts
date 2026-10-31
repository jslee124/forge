import { projectActionEvent } from "@forge/application";
import { expect, it } from "vitest";
import type { RunEvent, RunPayload } from "../shared/run-protocol.js";
import {
  pilotFaultChecks,
  recordedCommandFailureThenSuccess,
} from "./product-live-checks.js";

const event = (sequence: number, payload: RunPayload): RunEvent => ({
  type: "run-event",
  schemaVersion: 2,
  occurredAt: "2026-10-27T00:00:00Z",
  requestId: "r",
  runId: "run",
  sessionId: "session",
  sequence,
  payload,
});
const action = (
  sequence: number,
  step: number,
  status: "denied" | "running" | "proposed",
  tool = "run_command",
) =>
  event(sequence, {
    type: "action",
    action: { actionId: `a${sequence}`, step, status, tool, input: "{}" },
  });

it("matches quoted command facts and requires ordered observed failure then success", () => {
  const args = ["--test", "path.test.mjs"];
  const command = (sequence: number, exitCode: number, commandArgs = args) => {
    const projected = projectActionEvent({
      type: "tool.completed",
      step: sequence,
      call: { id: `a${sequence}`, name: "run_command", input: {} },
      result: {
        ok: true,
        truncated: false,
        output: {
          program: "node",
          args: commandArgs,
          cwd: ".",
          exitCode,
          signal: null,
          timedOut: false,
          stdout: "",
          stderr: "",
        },
      },
    });
    if (!projected) throw new Error("Missing projected command");
    return event(sequence, { type: "action", action: projected });
  };
  const failed = command(1, 1),
    passed = command(2, 0);
  expect(
    recordedCommandFailureThenSuccess([failed, passed], "node", args),
  ).toBe(true);
  expect(
    recordedCommandFailureThenSuccess([passed, failed], "node", args),
  ).toBe(false);
  expect(recordedCommandFailureThenSuccess([passed], "node", args)).toBe(false);
  expect(
    recordedCommandFailureThenSuccess(
      [failed, command(2, 0, ["--test", "fixture.test.mjs"])],
      "node",
      args,
    ),
  ).toBe(false);
  expect(
    recordedCommandFailureThenSuccess(
      [action(1, 1, "denied"), passed],
      "node",
      args,
    ),
  ).toBe(false);
});
it("does not count an unexercised denial or cancellation as passing", () => {
  expect(pilotFaultChecks("F01", []).denialObserved).toBe(false);
  expect(pilotFaultChecks("F01", []).deniedCommandNeverStarted).toBe(false);
  expect(
    pilotFaultChecks(
      "F02",
      [event(1, { type: "complete", outcome: "cancelled" })],
      { stage: "model" },
    ).cancelledAtTargetStage,
  ).toBe(false);
});
it("distinguishes refusal, later-step retries and actually started commands", () => {
  const denied = [action(1, 1, "proposed"), action(2, 1, "denied")];
  expect(pilotFaultChecks("F01", denied)).toMatchObject({
    denialObserved: true,
    deniedCommandNeverStarted: true,
    noProcessRetryAfterDenialFeedback: true,
  });
  expect(
    pilotFaultChecks("F01", [...denied, action(3, 2, "proposed")])
      .noProcessRetryAfterDenialFeedback,
  ).toBe(false);
  expect(
    pilotFaultChecks("F01", [...denied, action(3, 2, "running")])
      .deniedCommandNeverStarted,
  ).toBe(false);
});
it("requires a bounded cancellation and owned command exit, and catches later tools", () => {
  const events = [
    action(1, 1, "running"),
    event(2, { type: "complete", outcome: "cancelled" }),
  ];
  const cancellation = {
    stage: "command" as const,
    sequence: 1,
    requestedAt: 100,
    completedAt: 400,
    pid: 10,
    pidExited: true,
    finishedMarkerAbsent: true,
  };
  expect(pilotFaultChecks("F02", events, cancellation)).toMatchObject({
    cancelledAtTargetStage: true,
    cancellationWithinFiveSeconds: true,
    noToolsStartedAfterStop: true,
    commandProcessExited: true,
  });
  expect(
    pilotFaultChecks("F02", events, { ...cancellation, completedAt: 6000 })
      .cancellationWithinFiveSeconds,
  ).toBe(false);
  expect(
    pilotFaultChecks(
      "F02",
      [...events, action(3, 2, "running", "read_file")],
      cancellation,
    ).noToolsStartedAfterStop,
  ).toBe(false);
  expect(
    pilotFaultChecks("F02", events, { ...cancellation, pidExited: false })
      .commandProcessExited,
  ).toBe(false);
});
it("requires actual nonzero command facts rather than narrative or final status", () => {
  expect(
    pilotFaultChecks("D01", [event(1, { type: "text", text: "Tests failed" })])
      .diagnosisFailedCommandRecorded,
  ).toBe(false);
  expect(
    pilotFaultChecks("D01", [
      event(1, {
        type: "action",
        action: {
          actionId: "a",
          step: 1,
          tool: "run_command",
          status: "succeeded",
          input: "{}",
          facts: {
            kind: "command",
            command: "node --test fixture.test.mjs",
            cwd: ".",
            exitCode: 1,
            signal: null,
            timedOut: false,
            truncated: false,
          },
        },
      }),
    ]).diagnosisFailedCommandRecorded,
  ).toBe(true);
});
