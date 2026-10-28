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

it("enables only the declared read-only path test in faults-v2", () => {
  const command = approval("process", {
    program: "node",
    args: ["--test", "path.test.mjs"],
    cwd: ".",
  });
  expect(allowPilotApproval("E04", command)).toBe(false);
  expect(
    allowPilotApproval("E04", command, undefined, "desktop-product-faults-v1"),
  ).toBe(false);
  expect(
    allowPilotApproval("E04", command, undefined, "desktop-product-faults-v2"),
  ).toBe(true);
  for (const task of ["E01", "D02", "Q02"])
    expect(
      allowPilotApproval(task, command, undefined, "desktop-product-faults-v2"),
    ).toBe(false);
  for (const input of [
    { program: "node", args: ["--test", "path.test.mjs"], cwd: ".." },
    { program: "node", args: ["--test", "../path.test.mjs"] },
    { program: "node", args: ["--test", "path.test.mjs", "--eval", "code"] },
    { program: "node", args: ["-e", "code"] },
  ])
    expect(
      allowPilotApproval(
        "E04",
        approval("process", input),
        undefined,
        "desktop-product-faults-v2",
      ),
    ).toBe(false);
  expect(
    allowPilotApproval(
      "E04",
      approval("write", { path: "path.test.mjs" }),
      undefined,
      "desktop-product-faults-v2",
    ),
  ).toBe(false);
  expect(
    pilotScenario("E04", undefined, "desktop-product-faults-v2"),
  ).toMatchObject({
    limits: { maxSteps: 6, maxToolCalls: 16 },
    expectedWrites: ["workflow.mjs"],
  });
  expect(pilotScenario("E04").supplement).toBe("");
});

it("permits only a dedicated model-authored test in the autonomous protocol", () => {
  const protocol = "desktop-product-faults-v3";
  const command = approval("process", {
    program: "node",
    args: ["--test", "regression.test.mjs"],
    cwd: ".",
  });
  expect(allowPilotApproval("E04", command, undefined, protocol)).toBe(true);
  expect(
    allowPilotApproval(
      "E04",
      approval("write", { path: "regression.test.mjs" }),
      undefined,
      protocol,
    ),
  ).toBe(true);
  for (const old of [
    undefined,
    "desktop-product-faults-v1",
    "desktop-product-faults-v2",
  ])
    expect(allowPilotApproval("E04", command, undefined, old)).toBe(false);
  for (const path of [
    "fixture.test.mjs",
    "path.test.mjs",
    "../regression.test.mjs",
    "/regression.test.mjs",
    "main.mjs",
  ])
    expect(
      allowPilotApproval(
        "E04",
        approval("write", { path }),
        undefined,
        protocol,
      ),
    ).toBe(false);
  for (const task of ["Q02", "E01", "D02"])
    expect(
      allowPilotApproval(
        task,
        approval("write", { path: "regression.test.mjs" }),
        undefined,
        protocol,
      ),
    ).toBe(false);
  for (const input of [
    { program: "node", args: ["-e", "code"] },
    { program: "node", args: ["--test", "regression.test.mjs"], cwd: ".." },
    { program: "node", args: ["--test", "fixture.test.mjs"] },
    { program: "node", args: ["--test", "regression.test.mjs", "extra.mjs"] },
    { program: "sh", args: ["-c", "node --test regression.test.mjs"] },
  ])
    expect(
      allowPilotApproval(
        "E04",
        approval("process", input),
        undefined,
        protocol,
      ),
    ).toBe(false);
  expect(pilotScenario("E04", undefined, protocol)).toMatchObject({
    limits: { maxSteps: 6, maxToolCalls: 16 },
    expectedWrites: ["workflow.mjs", "regression.test.mjs"],
  });
});

it("keeps product-default diagnostics uncapped without changing bounded or fault profiles", () => {
  for (const task of ["E01", "E04", "D05"]) {
    const scenario = pilotScenario(
      task,
      undefined,
      "desktop-product-faults-v3",
      "product-defaults",
    );
    expect(scenario.limits).toEqual({ maxSteps: null, maxToolCalls: null });
    expect(scenario.expectedWrites).toEqual(
      pilotScenario(task, undefined, "desktop-product-faults-v3")
        .expectedWrites,
    );
    expect(scenario.supplement).not.toContain("六步预算");
  }
  expect(pilotScenario("E04").limits).toEqual({
    maxSteps: 6,
    maxToolCalls: 16,
  });
  expect(() =>
    pilotScenario("F03", undefined, undefined, "product-defaults"),
  ).toThrow("only supports");
  expect(() => pilotScenario("E01", undefined, undefined, "other")).toThrow(
    "Unknown pilot execution profile",
  );
});

it.each(["E02", "E05"])(
  "allows %s autonomous tests only in faults-v4 with exact scoped actions",
  (task) => {
    const protocol = "desktop-product-faults-v4";
    expect(
      pilotScenario(task, undefined, protocol, "product-defaults"),
    ).toMatchObject({
      limits: { maxSteps: null, maxToolCalls: null },
      expectedWrites: ["workflow.mjs", "regression.test.mjs"],
    });
    expect(
      allowPilotApproval(
        task,
        approval("write", { path: "regression.test.mjs" }),
        undefined,
        protocol,
      ),
    ).toBe(true);
    expect(
      allowPilotApproval(
        task,
        approval("process", {
          program: "node",
          args: ["--test", "regression.test.mjs"],
          cwd: ".",
        }),
        undefined,
        protocol,
      ),
    ).toBe(true);
    for (const old of [undefined, "desktop-product-faults-v3"])
      expect(
        allowPilotApproval(
          task,
          approval("write", { path: "regression.test.mjs" }),
          undefined,
          old,
        ),
      ).toBe(false);
    for (const input of [
      { program: "node", args: ["-e", "code"] },
      { program: "node", args: ["--test", "regression.test.mjs"], cwd: ".." },
    ])
      expect(
        allowPilotApproval(
          task,
          approval("process", input),
          undefined,
          protocol,
        ),
      ).toBe(false);
    for (const path of [
      "fixture.test.mjs",
      "../regression.test.mjs",
      "other.mjs",
    ])
      expect(
        allowPilotApproval(
          task,
          approval("write", { path }),
          undefined,
          protocol,
        ),
      ).toBe(false);
  },
);
