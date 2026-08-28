import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const expectedTag =
  process.argv.slice(2).find((argument) => argument !== "--") ??
  process.env.GITHUB_REF_NAME;
const rootPackage = await readJson(path.join(root, "package.json"));
const expectedVersion = rootPackage.version;
const manifests = [
  "apps/cli/package.json",
  "evals/package.json",
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

if (expectedTag !== `v${expectedVersion}`) {
  throw new Error(
    `Release tag ${expectedTag ?? "<missing>"} does not match package version v${expectedVersion}.`,
  );
}

for (const relativePath of manifests) {
  const manifest = await readJson(path.join(root, relativePath));
  if (manifest.version !== expectedVersion) {
    throw new Error(
      `${relativePath} has version ${manifest.version}; expected ${expectedVersion}.`,
    );
  }
}

const versionSource = await readFile(
  path.join(root, "packages", "core", "src", "index.ts"),
  "utf8",
);
if (!versionSource.includes(`FORGE_VERSION = "${expectedVersion}"`)) {
  throw new Error("FORGE_VERSION does not match the workspace version.");
}

const publishedPackage = await readJson(
  path.join(root, "dist", "npm", "forge", "package.json"),
);
if (publishedPackage.version !== expectedVersion) {
  throw new Error(
    "The generated npm package version does not match the release tag.",
  );
}

console.log(`Release tag ${expectedTag} matches every Forge package version.`);

async function readJson(filePath) {
  return JSON.parse(await readFile(filePath, "utf8"));
}
