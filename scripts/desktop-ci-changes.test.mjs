import assert from "node:assert/strict";
import test from "node:test";
import { affectsDesktop } from "./desktop-ci-changes.mjs";

test("desktop packaging includes app, shared code, and build inputs", () => {
  for (const file of [
    "apps/desktop/src/main/index.ts",
    "packages/core/src/runtime.ts",
    "packages/resources/docs/en/DESKTOP.md",
    "scripts/build-web-plugin.mjs",
    "pnpm-lock.yaml",
    ".github/workflows/ci.yml",
  ]) {
    assert.equal(affectsDesktop(file), true, file);
  }
});

test("desktop packaging skips CLI, evaluation, and prose-only changes", () => {
  for (const file of [
    "apps/cli/src/index.ts",
    "evals/src/evaluation.test.ts",
    "docs/ROADMAP.md",
    "README.md",
  ]) {
    assert.equal(affectsDesktop(file), false, file);
  }
});
