import { expect, it } from "vitest";
import {
  AutomaticWorkspaceWritePolicy,
  PerActionApprovalPolicy,
  type ProposedAction,
  ReadOnlyPolicy,
  WorkspaceWritePolicy,
} from "./policy.js";

const signal = new AbortController().signal;
const write = { tool: { risk: "write" } } as ProposedAction;
it("requires approval for each remote action even when the base profile allows writes", async () => {
  for (const base of [
    new AutomaticWorkspaceWritePolicy(),
    new WorkspaceWritePolicy(),
  ]) {
    const policy = new PerActionApprovalPolicy(base);
    expect((await policy.evaluate(write, signal)).kind).toBe("confirm");
    expect((await policy.evaluate(write, signal)).kind).toBe("confirm");
    expect(
      (
        await policy.evaluate(
          { tool: { risk: "read" } } as ProposedAction,
          signal,
        )
      ).kind,
    ).toBe("allow");
  }
});
it("never overrides underlying denials", async () => {
  expect(
    (
      await new PerActionApprovalPolicy(new ReadOnlyPolicy()).evaluate(
        write,
        signal,
      )
    ).kind,
  ).toBe("deny");
});
