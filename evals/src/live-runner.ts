import { createHash } from "node:crypto";
import { copyFile, cp, mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { AuthenticationManager } from "@forge/auth";
import { type RunMetadata, runTask } from "@forge/cli/run";
import type { ProposedAction, RunResult } from "@forge/core";
import { DEFAULT_DEEPSEEK_MODEL } from "@forge/model-deepseek";
import {
  FileTraceStore,
  summarizeTrace,
  type TraceEnvelope,
} from "@forge/persistence";
import {
  type EditToolContract,
  toolsForEditContract,
} from "./edit-tool-contract.js";
import { gradeWorkspace } from "./grader.js";
import { repositoryRoot } from "./paths.js";
import { runProcess } from "./process.js";
import {
  type EvaluationReport,
  type TrialReport,
  writeEvaluationReport,
} from "./report.js";
import { loadTaskManifests, type TaskManifest } from "./tasks.js";

export interface LiveEvaluationOptions {
  readonly env: EvaluationEnvironment;
  readonly taskIds?: readonly string[];
  readonly trialsPerTask?: number;
  readonly modelId?: string;
  readonly thinking?: "enabled" | "disabled";
  readonly outputDirectory?: string;
  readonly onProgress?: (message: string) => void;
  readonly editContract?: EditToolContract;
  readonly allowDirty?: boolean;
}

export interface EvaluationEnvironment extends NodeJS.ProcessEnv {
  readonly DEEPSEEK_API_KEY?: string;
  readonly FORGE_EVAL_LIVE?: string;
}

export async function runLiveEvaluation(
  options: LiveEvaluationOptions,
): Promise<{ readonly report: EvaluationReport; readonly output: string }> {
  const liveEnv = resolveLiveEnvironment(options.env);
  const root = repositoryRoot();
  const allTasks = await loadTaskManifests(root);
  const tasks = selectTasks(allTasks, options.taskIds);
  const trialsPerTask = options.trialsPerTask ?? 3;
  if (
    !Number.isInteger(trialsPerTask) ||
    trialsPerTask < 1 ||
    trialsPerTask > 10
  )
    throw new Error("Trials per task must be an integer from 1 through 10.");
  const modelId = options.modelId ?? DEFAULT_DEEPSEEK_MODEL;
  const thinking = options.thinking ?? "enabled";
  const timestamp = new Date().toISOString();
  const output = path.resolve(
    options.outputDirectory ??
      path.join(root, "evals", "artifacts", timestamp.replaceAll(":", "-")),
  );
  await mkdir(path.join(output, "traces"), {
    recursive: true,
    mode: 0o700,
  });
  const revision = await currentRevision(root, options.allowDirty ?? false);
  const trials: TrialReport[] = [];
  for (const task of tasks) {
    for (let trial = 1; trial <= trialsPerTask; trial += 1) {
      options.onProgress?.(
        `Running ${task.id} trial ${trial}/${trialsPerTask}...`,
      );
      trials.push(
        await runOneTrial({
          root,
          output,
          env: liveEnv,
          task,
          trial,
          modelId,
          thinking,
          editContract: options.editContract ?? "flat",
        }),
      );
    }
  }
  const report: EvaluationReport = {
    schemaVersion: 1,
    generatedAt: timestamp,
    forgeCommit: revision.commit,
    workspaceState: revision.state,
    ...(revision.fingerprint
      ? { workspaceFingerprint: revision.fingerprint }
      : {}),
    provider: "deepseek",
    modelId,
    thinking,
    trials,
  };
  await writeEvaluationReport(report, output);
  return { report, output };
}

function resolveLiveEnvironment(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  // biome-ignore lint/complexity/useLiteralKeys: ProcessEnv is an index signature under strict TypeScript.
  if (env["FORGE_EVAL_LIVE"] !== "1") {
    throw new Error(
      "Live evaluation is disabled. Set FORGE_EVAL_LIVE=1 to acknowledge paid model calls.",
    );
  }
  const authentication = new AuthenticationManager(env).requireApiKey(
    "deepseek",
  );
  return { ...env, DEEPSEEK_API_KEY: authentication.apiKey };
}

function selectTasks(
  tasks: readonly TaskManifest[],
  selected: readonly string[] | undefined,
): readonly TaskManifest[] {
  if (!selected || selected.length === 0) return tasks;
  const ids = new Set(selected);
  const result = tasks.filter(({ id }) => ids.has(id));
  const missing = [...ids].filter(
    (id) => !result.some((task) => task.id === id),
  );
  if (missing.length > 0)
    throw new Error(`Unknown evaluation tasks: ${missing.join(", ")}`);
  return result;
}

async function runOneTrial(options: {
  readonly root: string;
  readonly output: string;
  readonly env: NodeJS.ProcessEnv;
  readonly task: TaskManifest;
  readonly trial: number;
  readonly modelId: string;
  readonly thinking: "enabled" | "disabled";
  readonly editContract: EditToolContract;
}): Promise<TrialReport> {
  const parent = await mkdtemp(path.join(tmpdir(), "forge-live-eval-"));
  const workspace = path.join(parent, options.task.id);
  const forgeHome = path.join(parent, "forge-home");
  try {
    await cp(path.join(options.root, options.task.fixture), workspace, {
      recursive: true,
    });
    let result: RunResult | undefined;
    let metadata: RunMetadata | undefined;
    const controller = new AbortController();
    const outputSink = { write: (_chunk: string) => undefined };
    const exitCode = await runTask(
      evaluationPrompt(options.task),
      {
        model: options.modelId,
        thinking: options.thinking,
        permissionProfile: "safe",
      },
      {
        env: { ...options.env, FORGE_HOME: forgeHome },
        cwd: workspace,
        stdout: outputSink,
        stderr: outputSink,
        signal: controller.signal,
        approvalChannel: {
          request: async (action) => approveEvaluationAction(action),
        },
        renderEventsToOutput: false,
        tools: toolsForEditContract(options.editContract),
        onResult: (nextResult, nextMetadata) => {
          result = nextResult;
          metadata = nextMetadata;
        },
      },
    );
    if (!result || !metadata) {
      throw new Error(
        `Evaluation run for ${options.task.id} failed before producing a trace (exit ${exitCode}).`,
      );
    }
    const resolvedResult: RunResult = result;
    const resolvedMetadata: RunMetadata = metadata;
    const envelopes = await new FileTraceStore(forgeHome).read(
      resolvedMetadata.runId,
    );
    const trace = summarizeTrace(envelopes);
    const eventMetrics = summarizeEvaluationEvents(envelopes);
    const grade = await gradeWorkspace(options.task, workspace, options.root);
    const traceFile = path.join("traces", `${resolvedMetadata.runId}.jsonl`);
    await copyFile(
      path.join(forgeHome, "runs", `${resolvedMetadata.runId}.jsonl`),
      path.join(options.output, traceFile),
    );
    return {
      taskId: options.task.id,
      trial: options.trial,
      runId: resolvedMetadata.runId,
      status: resolvedResult.status,
      exitCode: resolvedResult.exitCode,
      passed: resolvedResult.status === "completed" && grade.passed,
      grade,
      trace,
      ...eventMetrics,
      traceFile,
    };
  } finally {
    await rm(parent, { recursive: true, force: true });
  }
}

export function summarizeEvaluationEvents(
  envelopes: readonly TraceEnvelope[],
): Pick<
  TrialReport,
  "deniedActions" | "failedVerificationAttempts" | "reachedLimit"
> {
  let policyDenials = 0;
  let runDenied = false;
  let failedVerificationAttempts = 0;
  let reachedLimit = false;
  for (const { event } of envelopes) {
    if (event.type === "tool.decision" && event.decision.kind === "deny") {
      policyDenials += 1;
    }
    if (event.type === "run.denied") runDenied = true;
    if (event.type === "run.limit_reached") reachedLimit = true;
    if (
      event.type === "tool.completed" &&
      event.call.name === "run_command" &&
      event.result.ok &&
      typeof event.result.output === "object" &&
      event.result.output !== null &&
      "exitCode" in event.result.output &&
      typeof event.result.output.exitCode === "number" &&
      event.result.output.exitCode !== 0
    ) {
      failedVerificationAttempts += 1;
    }
  }
  return {
    deniedActions: Math.max(policyDenials, runDenied ? 1 : 0),
    failedVerificationAttempts,
    reachedLimit,
  };
}

export function evaluationPrompt(task: TaskManifest): string {
  const command = [task.verification.program, ...task.verification.args].join(
    " ",
  );
  return `${task.prompt}\n\nEvaluation constraint: the only approved verification command is exactly \`${command}\` from the repository root. Use that command before finishing.`;
}

function approveEvaluationAction(action: ProposedAction): boolean {
  if (action.tool.risk === "write") return true;
  if (action.tool.risk !== "process" || action.call.name !== "run_command")
    return false;
  if (typeof action.input !== "object" || action.input === null) return false;
  const input = action.input as {
    readonly args?: unknown;
    readonly cwd?: unknown;
    readonly program?: unknown;
    readonly timeoutMs?: unknown;
  };
  return (
    input.program === "pnpm" &&
    Array.isArray(input.args) &&
    input.args.length === 1 &&
    input.args[0] === "test" &&
    input.cwd === "." &&
    input.timeoutMs === 60_000
  );
}

async function currentRevision(
  root: string,
  allowDirty: boolean,
): Promise<{
  readonly commit: string;
  readonly state: "clean" | "dirty";
  readonly fingerprint?: string;
}> {
  const [commit, status] = await Promise.all([
    runProcess({
      program: "git",
      args: ["rev-parse", "HEAD"],
      cwd: root,
    }),
    runProcess({
      program: "git",
      args: ["status", "--porcelain=v1", "-z", "--untracked-files=all"],
      cwd: root,
    }),
  ]);
  if (commit.exitCode !== 0)
    throw new Error("Could not resolve the Forge commit for the report.");
  if (status.exitCode !== 0)
    throw new Error("Could not inspect the Forge worktree for the report.");
  if (status.stdout === "") {
    return { commit: commit.stdout.trim(), state: "clean" };
  }
  if (!allowDirty) {
    throw new Error(
      "Live release trials require a clean Git checkout. Pass --allow-dirty only for development evidence.",
    );
  }
  const diff = await runProcess({
    program: "git",
    args: ["diff", "--no-ext-diff", "--binary", "HEAD"],
    cwd: root,
  });
  if (diff.exitCode !== 0)
    throw new Error("Could not fingerprint the Forge worktree for the report.");
  const hash = createHash("sha256").update(status.stdout).update(diff.stdout);
  for (const entry of status.stdout.split("\0").filter(Boolean)) {
    if (!entry.startsWith("?? ")) continue;
    const relativePath = entry.slice(3);
    hash.update(relativePath);
    hash.update(await readFile(path.join(root, relativePath)));
  }
  return {
    commit: commit.stdout.trim(),
    state: "dirty",
    fingerprint: hash.digest("hex"),
  };
}
