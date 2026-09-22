import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";

const tag = process.env.FORGE_DESKTOP_BUILD_TAG;
if (
  !tag ||
  !/^desktop-\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/.test(tag)
) {
  throw new Error(
    "Packaging requires FORGE_DESKTOP_BUILD_TAG=desktop-<full-semver>",
  );
}
const pkg = JSON.parse(
  await readFile(new URL("../package.json", import.meta.url), "utf8"),
);
const version = tag.slice(8);
if (version.split(/[-+]/)[0] !== pkg.version)
  throw new Error("Tag/package version mismatch");
if (process.argv.includes("--validate")) process.exit(0);
const assets = [];
for (const arch of ["arm64", "x64"]) {
  for (const extension of ["dmg", "zip"]) {
    const name = `forge-desktop-${pkg.version}-${arch}.${extension}`;
    const hash = createHash("sha256");
    for await (const chunk of createReadStream(
      new URL(`../release/${name}`, import.meta.url),
    ))
      hash.update(chunk);
    assets.push({ name, arch, sha256: hash.digest("hex") });
  }
}
await writeFile(
  new URL("../release/SHA256SUMS", import.meta.url),
  assets.map((asset) => `${asset.sha256}  ${asset.name}\n`).join(""),
);
await writeFile(
  new URL("../release/desktop-build.json", import.meta.url),
  `${JSON.stringify({ tag, version, packageVersion: pkg.version, channel: version.split("+")[0].includes("-") ? "preview" : "stable", assets }, null, 2)}\n`,
);
console.log(
  `Verified desktop release contract: ${tag}, ${assets.length} assets`,
);
