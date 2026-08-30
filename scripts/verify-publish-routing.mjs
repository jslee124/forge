import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { npmDistTagForVersion } from "./release-version.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const packageJson = JSON.parse(
  await readFile(path.join(root, "package.json"), "utf8"),
);
const fixtures = new Map([
  ["0.3.3", "latest"],
  ["0.4.0-beta.1", "next"],
  ["1.0.0-rc.2+build.7", "next"],
]);

for (const [version, expected] of fixtures) {
  const actual = npmDistTagForVersion(version);
  if (actual !== expected) {
    throw new Error(`${version} routes to ${actual}; expected ${expected}.`);
  }
}

const workflow = await readFile(
  path.join(root, ".github", "workflows", "publish.yml"),
  "utf8",
);
for (const required of [
  "scripts/release-version.mjs",
  "workflow_dispatch:",
  "contents: write",
  "ref: $" + "{{ env.RELEASE_TAG }}",
  'npm_dist_tag="$(node scripts/release-version.mjs "$RELEASE_TAG")"',
  'npm publish --access public --tag "$' +
    '{{ steps.npm-dist-tag.outputs.tag }}"',
  'release_notes=".github/releases/$' + '{RELEASE_TAG}.md"',
  'gh release create "$' + '{release_args[@]}"',
]) {
  if (!workflow.includes(required)) {
    throw new Error(
      `Publish workflow is missing required routing: ${required}`,
    );
  }
}

for (const forbidden of [
  '\\"$GITHUB_REF_NAME\\"',
  'echo "NPM_DIST_TAG=$(node scripts/release-version.mjs',
]) {
  if (workflow.includes(forbidden)) {
    throw new Error(
      `Publish workflow contains unsafe routing that can hide a failed dist-tag selection: ${forbidden}`,
    );
  }
}

const currentTag = `v${packageJson.version}`;
const releaseNotesPath = path.join(
  root,
  ".github",
  "releases",
  `${currentTag}.md`,
);
const releaseNotes = await readFile(releaseNotesPath, "utf8");
for (const required of ["## Highlights", "## Install", "## Verification"]) {
  if (!releaseNotes.includes(required)) {
    throw new Error(
      `${path.relative(root, releaseNotesPath)} is missing ${required}.`,
    );
  }
}

for (const staleClaim of ["not yet tagged", "not yet published"]) {
  if (releaseNotes.toLowerCase().includes(staleClaim)) {
    throw new Error(
      `${path.relative(root, releaseNotesPath)} contains stale release status: ${staleClaim}.`,
    );
  }
}

console.log("Stable releases route to latest and prereleases route to next.");
console.log(`GitHub release notes verified for ${currentTag}.`);
