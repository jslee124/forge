import assert from "node:assert/strict";
import path from "node:path";
import { pathToFileURL } from "node:url";

const workspace = requiredWorkspace();
const moduleUrl = pathToFileURL(
  path.join(workspace, "src", "retry-cache.ts"),
).href;
const { RetryCache } = await import(`${moduleUrl}?grader=${Date.now()}`);

const cache = new RetryCache();
let calls = 0;
let rejectFirst;
const first = cache.getOrLoad(
  "profile",
  () =>
    new Promise((_resolve, reject) => {
      calls += 1;
      rejectFirst = reject;
    }),
);
const duplicate = cache.getOrLoad("profile", async () => {
  calls += 1;
  return "should-not-run";
});
assert.equal(first, duplicate);
assert.equal(calls, 1);
rejectFirst(new Error("temporary failure"));
await assert.rejects(first);

const recovered = await cache.getOrLoad("profile", async () => {
  calls += 1;
  return "recovered";
});
assert.equal(recovered, "recovered");
assert.equal(calls, 2);
assert.equal(
  await cache.getOrLoad("profile", async () => "should-not-run"),
  "recovered",
);
assert.equal(calls, 2);

function requiredWorkspace() {
  const value = process.argv[2];
  if (!value) throw new Error("Expected a workspace path.");
  return path.resolve(value);
}
