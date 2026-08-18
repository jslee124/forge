import assert from "node:assert/strict";
import path from "node:path";
import { pathToFileURL } from "node:url";

const workspace = requiredWorkspace();
const moduleUrl = pathToFileURL(
  path.join(workspace, "src", "merge-options.ts"),
).href;
const { mergeWorkerOptions } = await import(
  `${moduleUrl}?grader=${Date.now()}`
);
const defaults = { enabled: true, retries: 3, label: "primary" };

assert.deepEqual(mergeWorkerOptions(defaults, {}), defaults);
assert.deepEqual(
  mergeWorkerOptions(defaults, { enabled: false, retries: 0, label: "" }),
  { enabled: false, retries: 0, label: "" },
);
assert.deepEqual(defaults, { enabled: true, retries: 3, label: "primary" });

function requiredWorkspace() {
  const value = process.argv[2];
  if (!value) throw new Error("Expected a workspace path.");
  return path.resolve(value);
}
