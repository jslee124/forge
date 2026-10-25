import { expect, it } from "vitest";
import { unchangedReadFingerprint } from "./read-progress.js";
import type { ToolCall } from "./tools.js";

const call: ToolCall = {
  id: "read",
  name: "read_file",
  input: { path: "file", startLine: 1 },
};
const result = (content = "evidence", resourceVersion = "known") =>
  [
    {
      callId: "read",
      toolName: "read_file",
      result: {
        ok: true as const,
        output: { content, resourceVersion },
        truncated: false,
      },
    },
  ] as const;
it("normalizes input key order and excludes per-attempt call identity", () => {
  const original = unchangedReadFingerprint([call], result());
  expect(original).toBeTruthy();
  expect(
    unchangedReadFingerprint(
      [{ ...call, id: "next", input: { startLine: 1, path: "file" } }],
      [{ ...result()[0], callId: "next" }],
    ),
  ).toBe(original);
});
it("treats changed content and changed versions as new evidence", () => {
  const original = unchangedReadFingerprint([call], result());
  expect(unchangedReadFingerprint([call], result("new evidence"))).not.toBe(
    original,
  );
  expect(
    unchangedReadFingerprint([call], result("evidence", "new-version")),
  ).not.toBe(original);
});
it("never infers no progress for process/network calls, unknown versions or mixed operations", () => {
  expect(
    unchangedReadFingerprint([{ ...call, name: "run_command" }], result()),
  ).toBeUndefined();
  expect(
    unchangedReadFingerprint([{ ...call, name: "web_fetch" }], result()),
  ).toBeUndefined();
  expect(
    unchangedReadFingerprint([call], result("evidence", "")),
  ).toBeUndefined();
  expect(
    unchangedReadFingerprint(
      [call, { ...call, id: "write", name: "edit_file" }],
      [...result(), { ...result()[0], callId: "write" }],
    ),
  ).toBeUndefined();
});
