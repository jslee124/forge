import type { RunPayload } from "../shared/run-protocol.js";

/** Deliberately narrow pilot policy; approval observations never authorize arbitrary processes. */
export function allowPilotApproval(
  task: string,
  approval: Extract<RunPayload, { type: "approval" }>,
): boolean {
  if (task !== "E01" || !approval.descriptor) return false;
  try {
    const input = JSON.parse(approval.descriptor.input) as {
      path?: unknown;
      program?: unknown;
      args?: unknown;
      cwd?: unknown;
    };
    if (approval.descriptor.effect === "write")
      return input.path === "workflow.mjs";
    if (approval.descriptor.effect !== "process") return false;
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
