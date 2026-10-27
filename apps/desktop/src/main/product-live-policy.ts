import type { RunPayload } from "../shared/run-protocol.js";

import { CANCEL_COMMAND } from "./product-live-scenarios.js";

/** Deliberately narrow pilot policy; approval observations never authorize arbitrary processes. */
export function allowPilotApproval(
  task: string,
  approval: Extract<RunPayload, { type: "approval" }>,
  cancelStage?: string,
): boolean {
  if (!["E01", "D01", "F02"].includes(task) || !approval.descriptor)
    return false;
  try {
    const input = JSON.parse(approval.descriptor.input) as {
      path?: unknown;
      program?: unknown;
      args?: unknown;
      cwd?: unknown;
    };
    if (approval.descriptor.effect === "write")
      return task === "E01" && input.path === "workflow.mjs";
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
      input.args[1] === "fixture.test.mjs"
    );
  } catch {
    return false;
  }
}
