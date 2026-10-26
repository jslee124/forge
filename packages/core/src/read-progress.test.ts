import { expect, it } from "vitest";
import {
  ReadProgressTracker,
  unchangedReadFingerprint,
} from "./read-progress.js";
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

function observe(
  tracker: ReadProgressTracker,
  path: string,
  version = "v1",
  content = "same",
) {
  return tracker.observe(
    [{ ...call, input: { path } }],
    result(content, version),
  );
}

it("detects alternating unchanged read batches after three repeated observations", () => {
  const tracker = new ReadProgressTracker();
  expect(
    ["a", "b", "a", "b", "a"].map((path) => observe(tracker, path)),
  ).toEqual([false, false, false, false, true]);
});

it("keeps three consecutive identical reads as the existing threshold", () => {
  const tracker = new ReadProgressTracker();
  expect([1, 2, 3].map(() => observe(tracker, "a"))).toEqual([
    false,
    false,
    true,
  ]);
});

it("resets repeated observations when a new scope is read", () => {
  const tracker = new ReadProgressTracker();
  for (const path of ["a", "b", "a", "b", "c", "a", "b"])
    expect(observe(tracker, path)).toBe(false);
});

it("permits changed versions, reverted versions and changed results", () => {
  const tracker = new ReadProgressTracker();
  for (const version of ["v1", "v2", "v1", "v2", "v1", "v2"])
    expect(observe(tracker, "a", version)).toBe(false);
  for (const content of ["one", "two", "one", "two"])
    expect(observe(tracker, "a", "v2", content)).toBe(false);
});

it.each(["run_command", "edit_file", "search"])(
  "forgets prior read evidence across %s",
  (name) => {
    const tracker = new ReadProgressTracker();
    observe(tracker, "a");
    observe(tracker, "a");
    expect(tracker.observe([{ ...call, name }], result())).toBe(false);
    expect(observe(tracker, "a")).toBe(false);
    expect(observe(tracker, "a")).toBe(false);
  },
);

it("forgets prior cycles when versions are unavailable or operations fail", () => {
  const tracker = new ReadProgressTracker();
  for (const path of ["a", "b", "a", "b"]) observe(tracker, path);
  expect(observe(tracker, "a", "")).toBe(false);
  expect(observe(tracker, "a")).toBe(false);
  expect(
    tracker.observe(
      [call],
      [
        {
          callId: call.id,
          toolName: call.name,
          result: {
            ok: false,
            error: { code: "not_found", message: "missing", retryable: false },
          },
        },
      ],
    ),
  ).toBe(false);
  expect(observe(tracker, "a")).toBe(false);
});

it("forgets cycles on tracking capacity instead of inferring a loop", () => {
  const tracker = new ReadProgressTracker();
  for (let i = 0; i < 65; i++)
    expect(observe(tracker, `file-${i}`)).toBe(false);
  expect(observe(tracker, "file-0")).toBe(false);
  expect(observe(tracker, "file-1")).toBe(false);
  expect(observe(tracker, "file-0")).toBe(false);
});
