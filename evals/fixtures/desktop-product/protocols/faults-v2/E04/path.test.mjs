import assert from "node:assert/strict";
import { test } from "node:test";
import { relativePath } from "./workflow.mjs";

test("preserves a relative filename, including meaningful whitespace", () => {
  for (const value of [
    "report.txt",
    "my documents/report file.txt",
    " report.txt ",
  ])
    assert.equal(relativePath(value), value);
});

test("rejects paths that can address outside the workspace", () => {
  for (const value of [
    "../private.txt",
    "nested/../../private.txt",
    "/private.txt",
  ])
    assert.throws(() => relativePath(value));
});
