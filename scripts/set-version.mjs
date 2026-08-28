import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const version = process.argv[2];
const semanticVersion =
  /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/u;
const manifests = [
  "package.json",
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

if (!version || !semanticVersion.test(version)) {
  throw new Error("Usage: pnpm version:set -- <semantic-version>");
}

for (const relativePath of manifests) {
  const filePath = path.join(root, relativePath);
  const manifest = JSON.parse(await readFile(filePath, "utf8"));
  manifest.version = version;
  await writeFile(filePath, `${JSON.stringify(manifest, null, 2)}\n`);
}

const versionSourcePath = path.join(
  root,
  "packages",
  "core",
  "src",
  "index.ts",
);
const versionSource = await readFile(versionSourcePath, "utf8");
const nextVersionSource = versionSource.replace(
  /export const FORGE_VERSION = "[^"]+";/u,
  `export const FORGE_VERSION = "${version}";`,
);
if (
  nextVersionSource === versionSource &&
  !versionSource.includes(`"${version}"`)
) {
  throw new Error(
    "Could not locate FORGE_VERSION in packages/core/src/index.ts.",
  );
}
await writeFile(versionSourcePath, nextVersionSource);

await replaceText("README.md", [
  [/source-v[^?]+/gu, `source-v${version}-0e7490`],
  [
    /Source version \d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?/gu,
    `Source version ${version}`,
  ],
  [
    /current source and npm release target is\n`[^`]+`/gu,
    `current source and npm release target is\n\`${version}\``,
  ],
]);
await replaceText("README.zh-CN.md", [
  [/source-v[^?]+/gu, `source-v${version}-0e7490`],
  [/源码版本 \d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?/gu, `源码版本 ${version}`],
  [
    /当前源码和 npm release 目标版本是 `[^`]+`/gu,
    `当前源码和 npm release 目标版本是 \`${version}\``,
  ],
]);
await replaceText("docs/GETTING_STARTED.md", [
  [
    /should print `[^`]+` for the current/gu,
    `should print \`${version}\` for the current`,
  ],
]);
await replaceText("docs/zh-CN/GETTING_STARTED.md", [
  [
    /当前源码 release 应输出 `[^`]+`/gu,
    `当前源码 release 应输出 \`${version}\``,
  ],
]);
await replaceText(
  "packages/resources/skills/forge-plugin-creator/references/plugin-api.md",
  [
    [
      /version-matched to Forge [0-9A-Za-z.+-]+/gu,
      `version-matched to Forge ${version}`,
    ],
  ],
);

console.log(`Updated Forge workspace versions to ${version}.`);

async function replaceText(relativePath, replacements) {
  const filePath = path.join(root, relativePath);
  let content = await readFile(filePath, "utf8");
  for (const [pattern, replacement] of replacements) {
    content = content.replace(pattern, replacement);
  }
  await writeFile(filePath, content);
}
