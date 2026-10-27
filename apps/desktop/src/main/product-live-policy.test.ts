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

it.each(["E02", "E03", "E04", "E05", "E06"])(
  "bounds %s edits and processes to the declared fixture surface",
  (task) => {
    expect(
      allowPilotApproval(task, approval("write", { path: "workflow.mjs" })),
    ).toBe(true);
    expect(
      allowPilotApproval(task, approval("write", { path: "main.mjs" })),
    ).toBe(task === "E06");
    for (const path of [
      "fixture.test.mjs",
      "tools/implementation.mjs",
      "../workflow.mjs",
      "/workflow.mjs",
    ])
      expect(allowPilotApproval(task, approval("write", { path }))).toBe(false);
    expect(
      allowPilotApproval(
        task,
        approval("process", {
          program: "node",
          args: ["--test", "fixture.test.mjs"],
          cwd: ".",
        }),
      ),
    ).toBe(true);
    expect(
      allowPilotApproval(
        task,
        approval("process", {
          program: "sh",
          args: ["-c", "node --test fixture.test.mjs"],
        }),
      ),
    ).toBe(false);
  },
);
it.each(["Q01", "Q03", "Q04", "D04"])(
  "keeps %s diagnosis read-only",
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
        }),
      ),
    ).toBe(false);
  },
);

it("bounds the new mock and stale-rewrite protocols to exact paths and test commands", () => {
  expect(
    allowPilotApproval("D02", approval("write", { path: "mock.mjs" })),
  ).toBe(true);
  for (const path of [
    "mock.test.mjs",
    "mock-implementation.mjs",
    "workflow.mjs",
    "../mock.mjs",
  ])
    expect(allowPilotApproval("D02", approval("write", { path }))).toBe(false);
  expect(
    allowPilotApproval(
      "D02",
      approval("process", {
        program: "node",
        args: ["--test", "mock.test.mjs"],
      }),
    ),
  ).toBe(true);
  expect(
    allowPilotApproval(
      "D02",
      approval("process", {
        program: "node",
        args: ["--test", "fixture.test.mjs"],
      }),
    ),
  ).toBe(false);
  expect(
    allowPilotApproval("D05", approval("write", { path: "workflow.mjs" })),
  ).toBe(true);
  expect(
    allowPilotApproval("D05", approval("write", { path: "fixture.test.mjs" })),
  ).toBe(false);
  expect(
    allowPilotApproval("D03", approval("write", { path: "workflow.mjs" })),
  ).toBe(false);
  expect(pilotScenario("D06").supplement).toContain("fixture.test.mjs");
});
