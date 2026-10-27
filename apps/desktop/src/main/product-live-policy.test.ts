import { expect, it } from "vitest";
import type { RunPayload } from "../shared/run-protocol.js";
import { allowPilotApproval } from "./product-live-policy.js";
import { CANCEL_COMMAND, pilotScenario } from "./product-live-scenarios.js";

const approval = (
  effect: "write" | "process",
  input: unknown,
): Extract<RunPayload, { type: "approval" }> => ({
  type: "approval",
  approvalId: "one",
  description: "untrusted description",
  descriptor: {
    actionId: "a",
    effect,
    resource: "ignored",
    preview: "ignored",
    input: JSON.stringify(input),
    riskFlags: [],
  },
});
it("grants only the pilot's one target file and exact fixture test command", () => {
  expect(
    allowPilotApproval(
      "E01",
      approval("process", {
        program: "node",
        args: ["--test", "fixture.test.mjs"],
        cwd: ".",
      }),
    ),
  ).toBe(true);
  expect(
    allowPilotApproval("E01", approval("write", { path: "workflow.mjs" })),
  ).toBe(true);
  expect(
    allowPilotApproval(
      "E01",
      approval("process", {
        program: "node",
        args: ["--test", "fixture.test.mjs"],
      }),
    ),
  ).toBe(true);
  expect(
    allowPilotApproval("E01", approval("write", { path: "../workflow.mjs" })),
  ).toBe(false);
  expect(
    allowPilotApproval(
      "E01",
      approval("process", { program: "node", args: ["-e", "arbitrary code"] }),
    ),
  ).toBe(false);
  expect(
    allowPilotApproval(
      "E01",
      approval("process", {
        program: "node",
        args: ["--test", "fixture.test.mjs"],
        cwd: "..",
      }),
    ),
  ).toBe(false);
  expect(
    allowPilotApproval("Q02", approval("write", { path: "workflow.mjs" })),
  ).toBe(false);
  expect(
    allowPilotApproval("F03", approval("write", { path: "workflow.mjs" })),
  ).toBe(false);
  expect(
    allowPilotApproval("E01", {
      type: "approval",
      approvalId: "old",
      description: "run harmless tests",
    }),
  ).toBe(false);
});

it.each(["Q05", "Q06"])(
  "keeps %s read-only despite plausible approval descriptions",
  (task) => {
    expect(
      allowPilotApproval(task, approval("write", { path: "workflow.mjs" })),
    ).toBe(false);
    expect(
      allowPilotApproval(
        task,
        approval("process", {
          program: "node",
          args: ["--test", "fixture.test.mjs"],
          cwd: ".",
        }),
      ),
    ).toBe(false);
  },
);

it("keeps fault probes on their declared command, stage and path", () => {
  const testCommand = approval("process", {
    program: "node",
    args: ["--test", "fixture.test.mjs"],
    cwd: ".",
  });
  expect(allowPilotApproval("D01", testCommand)).toBe(true);
  expect(
    allowPilotApproval("D01", approval("write", { path: "workflow.mjs" })),
  ).toBe(false);
  expect(allowPilotApproval("F01", testCommand)).toBe(false);
  expect(allowPilotApproval("F02", testCommand, "command")).toBe(false);
  const cancel = approval("process", {
    program: "node",
    args: ["-e", CANCEL_COMMAND],
    cwd: ".",
  });
  expect(allowPilotApproval("F02", cancel, "command")).toBe(true);
  expect(allowPilotApproval("F02", cancel, "model")).toBe(false);
  expect(
    allowPilotApproval(
      "F02",
      approval("process", {
        program: "node",
        args: ["-e", CANCEL_COMMAND + ";console.log('extra')"],
        cwd: ".",
      }),
      "command",
    ),
  ).toBe(false);
  expect(
    allowPilotApproval(
      "F02",
      approval("process", {
        program: "node",
        args: ["-e", CANCEL_COMMAND],
        cwd: "..",
      }),
      "command",
    ),
  ).toBe(false);
  expect(() => pilotScenario("F02")).toThrow("cancel-stage");
  expect(() => pilotScenario("D01", "command")).toThrow("other tasks");
  expect(pilotScenario("F02", "command")).toMatchObject({
    limits: { maxSteps: 3, maxToolCalls: 2 },
    expectedWrites: ["cancel-probe-started.json"],
  });
});
