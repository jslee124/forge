import assert from "node:assert/strict";
import { test } from "node:test";
import { mockTool } from "./mock.mjs";
import { actualTool } from "./mock-implementation.mjs";

test("implementation satisfies the current object contract", () => {
  assert.deepEqual(actualTool(), { value: "ok" });
});
test("mock matches the implementation contract", () => {
  assert.deepEqual(mockTool(), actualTool());
});
