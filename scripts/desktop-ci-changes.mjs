import { execFileSync } from "node:child_process";
import { appendFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const desktopPaths = ["apps/desktop/", "packages/", "scripts/"];
const desktopFiles = new Set([
  ".github/workflows/ci.yml",
  ".npmrc",
  "biome.json",
  "docs/catalog.json",
  "package.json",
  "pnpm-lock.yaml",
  "pnpm-workspace.yaml",
  "tsconfig.base.json",
  "tsconfig.json",
  "vitest.config.ts",
]);

export function affectsDesktop(file) {
  return (
    desktopFiles.has(file) ||
    desktopPaths.some((prefix) => file.startsWith(prefix))
  );
}

function main() {
  const { BASE_SHA: base, HEAD_SHA: head, GITHUB_OUTPUT: output } = process.env;
  if (!base || !head || !output) {
    throw new Error("BASE_SHA, HEAD_SHA, and GITHUB_OUTPUT are required");
  }

  const mergeBase = execFileSync("git", ["merge-base", base, head], {
    encoding: "utf8",
  }).trim();
  const files = execFileSync(
    "git",
    ["diff", "--name-only", "--no-renames", "-z", mergeBase, head],
    { encoding: "utf8" },
  )
    .split("\0")
    .filter(Boolean);
  const desktopChanged = files.some(affectsDesktop);
  appendFileSync(output, `desktop_changed=${desktopChanged}\n`);
  console.log(`Desktop packaging: ${desktopChanged ? "required" : "skipped"}`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main();
}
