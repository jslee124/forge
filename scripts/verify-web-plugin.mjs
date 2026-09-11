import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const require = createRequire(
  new URL("../packages/plugin-api/package.json", import.meta.url),
);
const { z } = require("zod");
const directory = resolve(process.argv[2] ?? "apps/desktop/out/web-tools");
const module = await import(pathToFileURL(`${directory}/index.mjs`));
const text =
  "A public article with independently checked evidence and clear reading limits. ".repeat(
    30,
  );
let requests = 0;
const tools = module.createWebTools(
  { z },
  {
    env: {},
    lookupAll: async () => [{ address: "93.184.216.34", family: 4 }],
    fetch: async () => {
      requests++;
      return new Response(
        `<article><h1>Packaged extraction</h1><p>${text}</p><p>${text}</p></article>`,
        { headers: { "content-type": "text/html" } },
      );
    },
  },
);
const result = await tools[1].execute(
  { url: "https://example.com/article" },
  {
    signal: new AbortController().signal,
    workspace: { cwd: "/tmp", root: "/tmp" },
    limits: { maxOutputBytes: 16384, maxEntries: 10, commandTimeoutMs: 1000 },
  },
);
assert.equal(result.ok, true);
assert.equal(result.output.method, "readability");
assert.equal(requests, 1);
console.log(
  JSON.stringify({
    node: process.versions.node,
    electron: process.versions.electron ?? null,
    method: result.output.method,
    passed: true,
  }),
);
