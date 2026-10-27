import { mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { projectActionEvent } from "@forge/application";
import { expect, it } from "vitest";
import type { RunEvent, RunPayload } from "../shared/run-protocol.js";
import {
  autonomousRegressionChecks,
  observeRegressionInputs,
  type RegressionObservation,
} from "./product-regression-checks.js";

const event = (sequence: number, payload: RunPayload): RunEvent => ({
  schemaVersion: 2,
  type: "run-event",
  sequence,
  occurredAt: "2026-10-27T00:00:00Z",
  requestId: "r",
  runId: "run",
  sessionId: "session",
  payload,
});
function command(
  id: string,
  sequence: number,
  exitCode: number,
  file = "regression.test.mjs",
): RunEvent[] {
  const projected = projectActionEvent({
    type: "tool.completed",
    step: 1,
    call: { id, name: "run_command", input: {} },
    result: {
      ok: true,
      truncated: false,
      output: {
        program: "node",
        args: ["--test", file],
        cwd: ".",
        exitCode,
        signal: null,
        timedOut: false,
        stdout: "",
        stderr: "",
      },
    },
  });
  if (!projected) throw new Error("Missing command");
  return [
    event(sequence, {
      type: "action",
      action: {
        actionId: id,
        step: 1,
        tool: "run_command",
        input: "{}",
        status: "running",
      },
    }),
    event(sequence + 1, { type: "action", action: projected }),
  ];
}
const observation = (
  actionId: string,
  sequence: number,
  source = "seed",
  test = "test",
): RegressionObservation => ({
  actionId,
  sequence,
  source: { sha256: source, status: "observed" },
  test: { sha256: test, status: "observed" },
});

it("observes a model-authored regression only with ordered pre-execution file identities", () => {
  const events = [...command("red", 2, 1), ...command("green", 5, 0)];
  const redSnapshot = observation("red", 1);
  const greenSnapshot = observation("green", 4, "fixed");
  const snapshots = [redSnapshot, greenSnapshot];
  const check = (
    es = events,
    os = snapshots,
    source = "fixed",
    test = "test",
  ) => autonomousRegressionChecks(es, os, "seed", source, test);
  expect(check()).toMatchObject({
    autonomousRegressionCycleObserved: true,
    regressionTestBytesPreserved: true,
  });
  expect(check(events, [])).toMatchObject({
    autonomousRegressionCycleObserved: false,
  });
  expect(
    check([...command("red", 2, 0), ...command("green", 5, 0)]),
  ).toMatchObject({ autonomousRegressionCycleObserved: false });
  expect(
    check([...command("green", 2, 0), ...command("red", 5, 1)]),
  ).toMatchObject({ autonomousRegressionCycleObserved: false });
  expect(
    check(events, [observation("red", 1, "already-fixed"), greenSnapshot]),
  ).toMatchObject({ regressionFailedOnUnchangedSource: false });
  expect(check(events, [observation("red", 3), greenSnapshot])).toMatchObject({
    autonomousRegressionCycleObserved: false,
  });
  expect(
    check(
      events,
      [redSnapshot, observation("green", 4, "fixed", "weakened-test")],
      "fixed",
      "weakened-test",
    ),
  ).toMatchObject({ autonomousRegressionCycleObserved: false });
  expect(check(events, snapshots, "later-edit")).toMatchObject({
    autonomousRegressionCycleObserved: false,
  });
  expect(check(events, snapshots, "fixed", "later-test-edit")).toMatchObject({
    autonomousRegressionCycleObserved: false,
  });
  expect(
    check([
      ...command("red", 2, 1, "fixture.test.mjs"),
      ...command("green", 5, 0),
    ]),
  ).toMatchObject({ autonomousRegressionCycleObserved: false });
  expect(
    check([
      event(2, {
        type: "action",
        action: {
          actionId: "red",
          step: 1,
          tool: "run_command",
          input: "{}",
          status: "denied",
        },
      }),
      ...command("green", 5, 0),
    ]),
  ).toMatchObject({ autonomousRegressionCycleObserved: false });
});

it("snapshots bounded regular files without creating tests or following a test symlink", async () => {
  const root = await mkdtemp(join(tmpdir(), "forge-regression-observe-"));
  try {
    await writeFile(join(root, "workflow.mjs"), "source");
    const first = await observeRegressionInputs(root, "a", 1);
    expect(first.source).toMatchObject({
      status: "observed",
      sha256: expect.stringMatching(/^[a-f0-9]{64}$/u),
    });
    expect(first.test).toEqual({ sha256: null, status: "missing" });
    await writeFile(join(root, "regression.test.mjs"), "test");
    const second = await observeRegressionInputs(root, "b", 2);
    expect(second.test.status).toBe("observed");
    expect(await readFile(join(root, "regression.test.mjs"), "utf8")).toBe(
      "test",
    );
    await writeFile(join(root, "regression.test.mjs"), "x".repeat(65_537));
    expect((await observeRegressionInputs(root, "c", 3)).test.status).toBe(
      "unavailable",
    );
    await rm(join(root, "regression.test.mjs"));
    await symlink(
      join(root, "workflow.mjs"),
      join(root, "regression.test.mjs"),
    );
    expect((await observeRegressionInputs(root, "d", 4)).test).toEqual({
      sha256: null,
      status: "unavailable",
    });
    expect(await readFile(join(root, "workflow.mjs"), "utf8")).toBe("source");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
