import { cp, mkdir, readFile, rm } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const destination = resolve(
  process.argv[2] ?? join(root, "apps/desktop/out/web-tools"),
);
await rm(destination, { recursive: true, force: true });
await mkdir(destination, { recursive: true });
for (const name of ["index.mjs", "plugin.json", "README.md", "README.zh-CN.md"])
  await cp(
    join(root, "examples/plugins/web-tools", name),
    join(destination, name),
  );
await cp(join(root, "LICENSE"), join(destination, "LICENSE"));
// Preserve packages as packages (including jsdom's relative worker/resources and licenses).
// Flatten only identical versions. Abort on a conflict rather than silently selecting one.
const copied = new Map();
async function copyDependency(name, from) {
  const require = createRequire(join(from, "package.json"));
  let entry;
  try {
    entry = require.resolve(`${name}/package.json`);
  } catch {
    entry = require.resolve(name);
  }
  let directory = dirname(entry);
  while (true) {
    const manifest = await readFile(join(directory, "package.json"), "utf8")
      .then(JSON.parse)
      .catch(() => null);
    if (manifest?.name === name) {
      if (copied.has(name)) {
        if (copied.get(name) !== manifest.version)
          throw new Error(`Conflicting plugin dependency ${name}`);
        return;
      }
      copied.set(name, manifest.version);
      await cp(directory, join(destination, "node_modules", name), {
        recursive: true,
        dereference: true,
        filter: (path) =>
          !path.slice(directory.length).split(/[\\/]/).includes("node_modules"),
      });
      for (const dependency of Object.keys(manifest.dependencies ?? {}))
        await copyDependency(dependency, directory);
      return;
    }
    const parent = dirname(directory);
    if (parent === directory)
      throw new Error(`Missing package manifest for ${name}`);
    directory = parent;
  }
}
for (const name of ["jsdom", "@mozilla/readability"])
  await copyDependency(name, root);
await import(pathToFileURL(join(destination, "node_modules/jsdom/lib/api.js")));
console.log(
  `Web plugin prepared with ${copied.size} locked dependencies at ${destination}`,
);
