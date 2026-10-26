import { expect, it } from "vitest";
import type { RunPayload } from "../shared/run-protocol.js";
import { allowPilotApproval } from "./product-live-policy.js";

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
