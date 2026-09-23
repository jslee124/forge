import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { copyFile, mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";

const [windowsDir, macosDir, outputDir, tag] = process.argv.slice(2);
if (
  !windowsDir ||
  !macosDir ||
  !outputDir ||
  !/^desktop-\d+\.\d+\.\d+-preview\.\d+$/.test(tag ?? "")
) {
  throw new Error(
    "Usage: assemble-preview-release.mjs <windows-dir> <macos-dir> <output-dir> <desktop-preview-tag>",
  );
}

const version = tag.slice("desktop-".length).split("-")[0];
const sources = [
  {
    dir: windowsDir,
    platform: "win32",
    arch: "x64",
    name: `forge-desktop-${version}-x64.exe`,
  },
  {
    dir: macosDir,
    platform: "darwin",
    arch: "arm64",
    name: `forge-desktop-${version}-arm64.dmg`,
  },
  {
    dir: macosDir,
    platform: "darwin",
    arch: "x64",
    name: `forge-desktop-${version}-x64.dmg`,
  },
];

async function sha256(file) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(file)) hash.update(chunk);
  return hash.digest("hex");
}

const manifests = new Map();
for (const { dir, platform } of sources) {
  if (manifests.has(platform)) continue;
  const manifest = JSON.parse(
    await readFile(join(dir, "desktop-build.json"), "utf8"),
  );
  if (
    manifest.tag !== tag ||
    manifest.platform !== platform ||
    manifest.packageVersion !== version
  ) {
    throw new Error(`Invalid ${platform} build identity`);
  }
  manifests.set(platform, manifest);
}

await mkdir(outputDir, { recursive: true });
const assets = [];
for (const { dir, platform, arch, name } of sources) {
  const manifest = manifests.get(platform);
  const matches = manifest.assets.filter(
    (asset) => asset.name === name && asset.arch === arch,
  );
  if (matches.length !== 1 || !/^[a-f0-9]{64}$/.test(matches[0].sha256)) {
    throw new Error(`Missing or duplicate ${name} in ${platform} manifest`);
  }
  const source = join(dir, name);
  if (!(await stat(source)).isFile()) throw new Error(`Not a file: ${source}`);
  const actual = await sha256(source);
  if (actual !== matches[0].sha256)
    throw new Error(`Checksum mismatch: ${name}`);
  await copyFile(source, join(outputDir, name));
  assets.push({ name, platform, arch, sha256: actual });
}

await writeFile(
  join(outputDir, "SHA256SUMS"),
  assets.map(({ sha256, name }) => `${sha256}  ${name}\n`).join(""),
);
await writeFile(
  join(outputDir, "desktop-build.json"),
  `${JSON.stringify({ tag, version: tag.slice(8), packageVersion: version, platform: "multi", channel: "preview", assets }, null, 2)}\n`,
);
console.log(`Verified ${tag}: ${assets.map(({ name }) => name).join(", ")}`);
