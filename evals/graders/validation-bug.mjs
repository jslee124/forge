import assert from "node:assert/strict";
import path from "node:path";
import { pathToFileURL } from "node:url";

const workspace = requiredWorkspace();
const moduleUrl = pathToFileURL(
  path.join(workspace, "src", "parse-port.ts"),
).href;
const { parsePort } = await import(`${moduleUrl}?grader=${Date.now()}`);

for (const [input, expected] of [
  ["1", 1],
  ["080", 80],
  ["65535", 65535],
]) {
  assert.equal(parsePort(input), expected);
}
for (const input of [
  "",
  "\t",
  " 80",
  "80 ",
  "+80",
  "-1",
  "1.0",
  "1e2",
  "0x10",
  "12abc",
  "0",
  "65536",
]) {
  assert.throws(() => parsePort(input));
}

function requiredWorkspace() {
  const value = process.argv[2];
  if (!value) throw new Error("Expected a workspace path.");
  return path.resolve(value);
}
