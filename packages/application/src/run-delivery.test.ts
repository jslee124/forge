import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  FileProductRunStore,
  type ProductRunRecord,
  productDeliverySchema,
  type RecordedAction,
} from "@forge/persistence";
import { describe, expect, it } from "vitest";
import { projectActionEvent } from "./product-run.js";
import { projectRunDelivery } from "./run-delivery.js";

function record(actions: RecordedAction[] = []): ProductRunRecord {
  const time = new Date().toISOString();
  return {
    summary: {
      schemaVersion: 1,
      sessionId: "session",
      runId: "run",
      engine: "native",
      prompt: "task",
      startedAt: time,
      updatedAt: time,
      state: "finished",
      completion: { outcome: "completed" },
      sequence: actions.length,
      omittedEvents: 0,
      omittedCharacters: 0,
    },
    incomplete: false,
    events: actions.map((action, index) => ({
      sequence: index + 1,
      occurredAt: time,
      payload: { type: "action", action },
    })),
  };
}
const commandOutput = {
  program: "node",
  args: ["check.js"],
  cwd: ".",
  exitCode: 1,
  signal: null,
  timedOut: false,
  stdout: "",
  stderr: "failed",
};
function observed(
  tool: string,
  output: unknown,
  id = "action",
): RecordedAction {
  const action = projectActionEvent({
    type: "tool.completed",
    step: 1,
    call: { id, name: tool, input: {} },
    result: { ok: true, output, truncated: false },
  });
  if (!action) throw new Error("Missing action");
  return action;
}
describe("factual delivery projection", () => {
  it("preserves file observations before JSON clipping and does not accept unsafe output paths", () => {
    const output = {
      operation: "create",
      path: "file.txt",
      bytes: 30_000,
      diff: "+x".repeat(20_000),
    };
    const action = observed("edit_file", output);
    expect(action.truncated).toBe(true);
    expect(action.facts).toMatchObject({
      kind: "file",
      path: "file.txt",
      truncated: true,
    });
    const delivery = projectRunDelivery(record([action]));
    expect(delivery.files[0]?.facts.patch).toHaveLength(8192);
    for (const path of [
      "../outside",
      "/absolute",
      "C:\\outside",
      "a\nb",
      "nested/../../outside",
    ])
      expect(observed("edit_file", { ...output, path }).facts).toBeUndefined();
    expect(productDeliverySchema.safeParse(delivery).success).toBe(true);
  });
  it("keeps actual nonzero exits, timeouts and missing results without claiming verification", () => {
    const delivery = projectRunDelivery(
      record([
        observed(
          "run_command",
          { ...commandOutput, stdout: "x".repeat(5000) },
          "failed-command",
        ),
        observed(
          "run_command",
          {
            ...commandOutput,
            exitCode: null,
            timedOut: true,
            signal: "SIGTERM",
          },
          "timed-out",
        ),
        {
          actionId: "uncertain",
          step: 1,
          tool: "run_command",
          status: "running",
          input: "{}",
        },
        {
          actionId: "denied",
          step: 1,
          tool: "edit_file",
          status: "denied",
          input: "{}",
        },
      ]),
    );
    expect(delivery.commands.map((entry) => entry.facts.exitCode)).toEqual([
      1,
      null,
    ]);
    expect(delivery.commands[1]?.facts.timedOut).toBe(true);
    expect(delivery.commands[0]?.facts.stdout).toHaveLength(2048);
    expect(delivery.commands[0]?.facts.stderr).toBe("failed");
    expect(delivery.commands[0]?.facts.truncated).toBe(true);
    expect(delivery.unresolved.map((entry) => entry.status)).toEqual([
      "unknown",
      "denied",
    ]);
    expect(delivery.files).toEqual([]);
  });
  it("never infers changes or tests from prose, legacy JSON or proposed actions", () => {
    const source = record([
      {
        actionId: "old",
        step: 1,
        tool: "run_command",
        status: "succeeded",
        input: "{}",
        output: JSON.stringify({
          ok: true,
          output: { ...commandOutput, exitCode: 0 },
        }),
      },
      {
        ...observed("edit_file", {
          operation: "create",
          path: "a",
          bytes: 1,
          diff: "+a",
        }),
        status: "proposed",
      },
    ]);
    source.events.push({
      sequence: 3,
      occurredAt: new Date().toISOString(),
      payload: { type: "text", text: "All tests passed. I wrote file.txt." },
    });
    expect(projectRunDelivery(source)).toMatchObject({
      files: [],
      commands: [],
      unstructured: 1,
      unresolved: [{ status: "not_executed" }],
    });
    expect(
      projectRunDelivery({
        ...source,
        summary: { ...source.summary, engine: "codex" },
      }).incomplete,
    ).toBe(true);
  });
  it("upserts action identity and bounds the delivery DTO with disclosed omissions", () => {
    const pending: RecordedAction = {
      actionId: "same",
      step: 1,
      tool: "run_command",
      status: "running",
      input: "{}",
    };
    expect(
      projectRunDelivery(
        record([pending, observed("run_command", commandOutput, "same")]),
      ).unresolved,
    ).toEqual([]);
    const source = record(
      Array.from({ length: 150 }, (_, index) =>
        observed(
          "edit_file",
          {
            operation: "create",
            path: `file-${index}`,
            bytes: 20_000,
            diff: "x".repeat(20_000),
          },
          `file-${index}`,
        ),
      ),
    );
    const delivery = projectRunDelivery(source);
    expect(JSON.stringify(delivery).length).toBeLessThan(263_000);
    expect(delivery.omitted).toBeGreaterThan(0);
    expect(delivery.incomplete).toBe(true);
  });
  it("round trips redacted facts and retains legacy records without inventing facts", async () => {
    const home = await mkdtemp(join(tmpdir(), "forge-delivery-"));
    try {
      const store = new FileProductRunStore(home, {
        secrets: ["private-test-key"],
      });
      const writer = await store.create({
        sessionId: "session",
        runId: "run",
        engine: "native",
        prompt: "task",
      });
      await writer.record({
        type: "action",
        action: observed("run_command", {
          ...commandOutput,
          args: ["private-test-key"],
        }),
      });
      await writer.finish({ outcome: "completed" });
      const delivery = projectRunDelivery(await store.read("session", "run"));
      expect(delivery.commands).toHaveLength(1);
      expect(JSON.stringify(delivery)).not.toContain("private-test-key");
    } finally {
      await rm(home, { recursive: true, force: true });
    }
  });
});
