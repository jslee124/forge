import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { readdir, stat } from "node:fs/promises";
import { join } from "node:path";

const [directory, tag] = process.argv.slice(2);
const repository = process.env.GITHUB_REPOSITORY;
const token = process.env.GH_TOKEN;
if (!directory || !tag || !repository || !token)
  throw new Error("Missing release verification input");

const localFiles = (await readdir(directory)).sort();
if (
  localFiles.length !== 5 ||
  !localFiles.includes("SHA256SUMS") ||
  !localFiles.includes("desktop-build.json")
) {
  throw new Error("Unexpected release asset set");
}

const response = await fetch(
  `https://api.github.com/repos/${repository}/releases/tags/${encodeURIComponent(tag)}`,
  {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
    },
  },
);
if (!response.ok)
  throw new Error(`GitHub release lookup failed: HTTP ${response.status}`);
const release = await response.json();
if (release.tag_name !== tag || !release.draft || !release.prerelease)
  throw new Error("Unexpected release identity or state");

const remoteFiles = release.assets.map((asset) => asset.name).sort();
if (JSON.stringify(remoteFiles) !== JSON.stringify(localFiles))
  throw new Error("Release asset names differ from verified local files");
for (const asset of release.assets) {
  const file = join(directory, asset.name);
  if (asset.state !== "uploaded" || asset.size !== (await stat(file)).size) {
    throw new Error(`Remote asset is incomplete: ${asset.name}`);
  }
  if (asset.digest) {
    const hash = createHash("sha256");
    for await (const chunk of createReadStream(file)) hash.update(chunk);
    if (asset.digest !== `sha256:${hash.digest("hex")}`)
      throw new Error(`Remote digest mismatch: ${asset.name}`);
  }
}
console.log(
  `Verified ${release.assets.length} uploaded release assets for ${tag}`,
);
