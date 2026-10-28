import type { RunPayload } from "../shared/run-protocol.js";

import {
  CANCEL_COMMAND,
  usesAutonomousRegression,
} from "./product-live-scenarios.js";

/** Deliberately narrow pilot policy; approval observations never authorize arbitrary processes. */
export function allowPilotApproval(
  task: string,
  approval: Extract<RunPayload, { type: "approval" }>,
  cancelStage?: string,
  faultProtocol?: string,
): boolean {
  if (
    !(
      /^E0[1-6]$/.test(task) ||
      ["D01", "D02", "D05", "D06", "F02"].includes(task)
    ) ||
    !approval.descriptor
  )
    return false;
  try {
    const input = JSON.parse(approval.descriptor.input) as {
      path?: unknown;
      program?: unknown;
      args?: unknown;
      cwd?: unknown;
    };
    if (approval.descriptor.effect === "write")
      return task === "D02"
        ? input.path === "mock.mjs"
        : task === "D05"
          ? input.path === "workflow.mjs"
          : /^E0[1-6]$/.test(task) &&
            (input.path === "workflow.mjs" ||
              (usesAutonomousRegression(task, faultProtocol) &&
                input.path === "regression.test.mjs") ||
              (task === "E06" && input.path === "main.mjs"));
    if (approval.descriptor.effect !== "process") return false;
    if (task === "F02")
      return (
        cancelStage === "command" &&
        input.program === "node" &&
        (input.cwd === undefined || input.cwd === ".") &&
        Array.isArray(input.args) &&
        input.args.length === 2 &&
        input.args[0] === "-e" &&
        input.args[1] === CANCEL_COMMAND
      );
    return (
      input.program === "node" &&
      (input.cwd === undefined || input.cwd === ".") &&
      Array.isArray(input.args) &&
      input.args.length === 2 &&
      input.args[0] === "--test" &&
      input.args[1] ===
        (task === "D02"
          ? "mock.test.mjs"
          : usesAutonomousRegression(task, faultProtocol)
            ? "regression.test.mjs"
            : task === "E04" && faultProtocol === "desktop-product-faults-v2"
              ? "path.test.mjs"
              : "fixture.test.mjs")
    );
  } catch {
    return false;
  }
}
