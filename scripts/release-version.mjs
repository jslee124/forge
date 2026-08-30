import { pathToFileURL } from "node:url";

const SEMVER_PATTERN =
  /^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/u;

export function npmDistTagForVersion(version) {
  const match = SEMVER_PATTERN.exec(version);
  if (!match) throw new Error(`Invalid release version: ${version}`);
  return match[1] ? "next" : "latest";
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  const rawVersion = process.argv[2];
  if (!rawVersion)
    throw new Error("A release version or v-prefixed tag is required.");
  console.log(npmDistTagForVersion(rawVersion.replace(/^v/u, "")));
}
