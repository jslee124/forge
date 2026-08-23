import { describe, expect, it } from "vitest";
import { z } from "zod";

import type { ForgeTool, ProposedAction } from "./index.js";
import {
  AutomaticWorkspaceWritePolicy,
  WorkspaceWritePolicy,
} from "./index.js";

const writeTool = fakeTool("apply_patch", "write");
const processTool = fakeTool("run_command", "process");
const networkTool = fakeTool("web_fetch", "network");
const modelTool = fakeTool("delegate_review", "model");

describe("permission profile safety floor", () => {
  it("requires safe-profile confirmation for writes and destructive processes", async () => {
    const policy = new WorkspaceWritePolicy();

    await expect(
      policy.evaluate(action(writeTool), signal()),
    ).resolves.toMatchObject({
      kind: "confirm",
    });
    await expect(
      policy.evaluate(
        action(processTool, { program: "rm", args: ["-rf", "build"] }),
        signal(),
      ),
    ).resolves.toMatchObject({ kind: "confirm" });
    await expect(
      policy.evaluate(
        action(networkTool, { url: "https://example.com" }),
        signal(),
      ),
    ).resolves.toMatchObject({ kind: "confirm" });
    await expect(
      policy.evaluate(action(modelTool, { task: "Review" }), signal()),
    ).resolves.toMatchObject({ kind: "confirm" });
  });

  it("workspace-write never auto-allows process commands", async () => {
    const policy = new AutomaticWorkspaceWritePolicy();

    await expect(
      policy.evaluate(action(writeTool), signal()),
    ).resolves.toMatchObject({
      kind: "allow",
    });
    await expect(
      policy.evaluate(
        action(processTool, { program: "rm", args: ["-rf", "build"] }),
        signal(),
      ),
    ).resolves.toMatchObject({ kind: "confirm" });
    await expect(
      policy.evaluate(
        action(networkTool, { url: "https://example.com" }),
        signal(),
      ),
    ).resolves.toMatchObject({ kind: "confirm" });
    await expect(
      policy.evaluate(action(modelTool, { task: "Review" }), signal()),
    ).resolves.toMatchObject({ kind: "confirm" });
  });
});

function fakeTool(name: string, risk: ForgeTool["risk"]): ForgeTool {
  return {
    name,
    description: name,
    risk,
    inputSchema: z.unknown(),
    execute: async () => ({ ok: true, output: {}, truncated: false }),
  };
}

function action(tool: ForgeTool, input: unknown = {}): ProposedAction {
  return {
    call: { id: "call-1", name: tool.name, input },
    tool,
    input,
  };
}

function signal(): AbortSignal {
  return new AbortController().signal;
}
