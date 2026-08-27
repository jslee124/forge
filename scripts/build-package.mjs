import {
  chmod,
  copyFile,
  mkdir,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { build } from "esbuild";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const outputRoot = path.join(root, "dist", "npm", "forge");
const outputFile = path.join(outputRoot, "dist", "index.js");
const packageName = "@jslee124/forge";
const workspacePackagePaths = [
  "apps/cli/package.json",
  "packages/auth/package.json",
  "packages/codex-app-server/package.json",
  "packages/config/package.json",
  "packages/core/package.json",
  "packages/model-compat/package.json",
  "packages/model-deepseek/package.json",
  "packages/model-openai/package.json",
  "packages/persistence/package.json",
  "packages/plugin-api/package.json",
  "packages/resources/package.json",
  "packages/tools/package.json",
];

const rootPackage = await readJson(path.join(root, "package.json"));
await assertBundledPluginSkillVersion(rootPackage.version);
const dependencies = await collectExternalDependencies();

await rm(outputRoot, { recursive: true, force: true });
await mkdir(path.dirname(outputFile), { recursive: true });

const result = await build({
  absWorkingDir: root,
  bundle: true,
  entryPoints: ["apps/cli/src/index.ts"],
  format: "esm",
  legalComments: "eof",
  logLevel: "info",
  metafile: true,
  outfile: outputFile,
  packages: "bundle",
  platform: "node",
  plugins: [externalizePublicDependencies()],
  target: "node24",
  treeShaking: true,
});

assertOnlyDeclaredExternalPackages(result.metafile, dependencies);

const executable = await readFile(outputFile, "utf8");
if (!executable.startsWith("#!/usr/bin/env node\n")) {
  throw new Error("The packaged CLI entry is missing its Node.js shebang.");
}
await chmod(outputFile, 0o755);

const packageManifest = {
  name: packageName,
  version: rootPackage.version,
  description: "A safe, observable, and evaluable coding agent",
  license: "MIT",
  type: "module",
  bin: { forge: "dist/index.js" },
  files: ["dist", "resources", "README.md", "LICENSE"],
  engines: { node: ">=24" },
  repository: {
    type: "git",
    url: "git+https://github.com/jslee124/forge.git",
  },
  homepage: "https://github.com/jslee124/forge#readme",
  bugs: { url: "https://github.com/jslee124/forge/issues" },
  keywords: ["agent", "coding-agent", "cli", "ai", "typescript"],
  publishConfig: { access: "public" },
  dependencies,
};

await writeFile(
  path.join(outputRoot, "package.json"),
  `${JSON.stringify(packageManifest, null, 2)}\n`,
);
await copyFile(
  path.join(root, "apps", "cli", "README.md"),
  path.join(outputRoot, "README.md"),
);
await copyFile(path.join(root, "LICENSE"), path.join(outputRoot, "LICENSE"));
await copyDirectory(
  path.join(root, "packages", "resources", "skills"),
  path.join(outputRoot, "resources", "skills"),
);

console.log(`Prepared ${packageName}@${rootPackage.version} in ${outputRoot}`);

function externalizePublicDependencies() {
  return {
    name: "externalize-public-dependencies",
    setup(buildApi) {
      buildApi.onResolve({ filter: /.*/ }, (args) => {
        if (args.kind === "entry-point") return undefined;
        if (args.path.startsWith("@forge/")) return undefined;
        if (args.path.startsWith("node:")) {
          return { path: args.path, external: true };
        }
        if (isBarePackageImport(args.path)) {
          return { path: args.path, external: true };
        }
        return undefined;
      });
    },
  };
}

async function collectExternalDependencies() {
  const collected = new Map();
  for (const relativePath of workspacePackagePaths) {
    const manifest = await readJson(path.join(root, relativePath));
    for (const [name, range] of Object.entries(manifest.dependencies ?? {})) {
      if (name.startsWith("@forge/")) continue;
      const existing = collected.get(name);
      if (existing !== undefined && existing !== range) {
        throw new Error(
          `Conflicting runtime dependency ranges for ${name}: ${existing} and ${range}.`,
        );
      }
      collected.set(name, range);
    }
  }
  return Object.fromEntries(
    [...collected.entries()].sort(([left], [right]) =>
      left.localeCompare(right),
    ),
  );
}

function assertOnlyDeclaredExternalPackages(metafile, dependencies) {
  const undeclared = new Set();
  for (const output of Object.values(metafile.outputs)) {
    for (const imported of output.imports) {
      if (!imported.external || imported.path.startsWith("node:")) continue;
      const packageName = packageNameFromImport(imported.path);
      if (!Object.hasOwn(dependencies, packageName))
        undeclared.add(packageName);
    }
  }
  if (undeclared.size > 0) {
    throw new Error(
      `The packaged CLI imports undeclared runtime dependencies: ${[...undeclared].sort().join(", ")}.`,
    );
  }
}

function isBarePackageImport(specifier) {
  return !specifier.startsWith(".") && !specifier.startsWith("/");
}

function packageNameFromImport(specifier) {
  const [first, second] = specifier.split("/");
  return first.startsWith("@") ? `${first}/${second}` : first;
}

async function readJson(filePath) {
  return JSON.parse(await readFile(filePath, "utf8"));
}

async function assertBundledPluginSkillVersion(forgeVersion) {
  const skillRoot = path.join(
    root,
    "packages",
    "resources",
    "skills",
    "forge-plugin-creator",
  );
  const [reference, manifestTemplate, types] = await Promise.all([
    readFile(path.join(skillRoot, "references", "plugin-api.md"), "utf8"),
    readFile(path.join(skillRoot, "templates", "plugin.json"), "utf8"),
    readFile(
      path.join(root, "packages", "plugin-api", "src", "types.ts"),
      "utf8",
    ),
  ]);
  const apiVersion = /PLUGIN_API_VERSION = "([^"]+)"/u.exec(types)?.[1];
  if (!apiVersion)
    throw new Error("Could not determine the plugin API version.");
  if (!reference.includes(`Forge ${forgeVersion}`)) {
    throw new Error(
      `forge-plugin-creator reference does not match Forge ${forgeVersion}.`,
    );
  }
  if (
    !reference.includes(
      `plugin API version \`${JSON.stringify(apiVersion)}\``,
    ) ||
    JSON.parse(manifestTemplate).apiVersion !== apiVersion
  ) {
    throw new Error(
      `forge-plugin-creator assets do not match plugin API version ${apiVersion}.`,
    );
  }
}

async function copyDirectory(source, target) {
  const { cp } = await import("node:fs/promises");
  await cp(source, target, { recursive: true });
}
