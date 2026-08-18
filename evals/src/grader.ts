import path from "node:path";

import { repositoryRoot } from "./paths.js";
import { type ProcessResult, runProcess } from "./process.js";
import type { TaskManifest } from "./tasks.js";

export interface GradeResult {
  readonly passed: boolean;
  readonly publicTests: ProcessResult;
  readonly hiddenTests: ProcessResult;
}

export async function gradeWorkspace(
  task: TaskManifest,
  workspaceRoot: string,
  root = repositoryRoot(),
): Promise<GradeResult> {
  const publicTests = await runProcess({
    program: task.verification.program,
    args: task.verification.args,
    cwd: path.resolve(workspaceRoot, task.verification.cwd),
  });
  const hiddenTests = await runProcess({
    program: process.execPath,
    args: [
      "--experimental-strip-types",
      path.join(root, "evals", "graders", task.hiddenGrader),
      workspaceRoot,
    ],
    cwd: root,
  });
  return {
    passed: publicTests.exitCode === 0 && hiddenTests.exitCode === 0,
    publicTests,
    hiddenTests,
  };
}
