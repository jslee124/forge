import { execFile, spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { cp, mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs, promisify } from "node:util";
import {
  loadDesktopProductCorpus,
  prepareDesktopProductRound,
} from "../../../evals/dist/desktop-product-evaluation.js";
import {
  PILOT_TASKS,
  pilotScenario,
} from "../src/main/product-live-scenarios.ts";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const desktop = join(root, "apps/desktop");
const { values } = parseArgs({
  options: {
    prepare: { type: "boolean" },
    live: { type: "boolean" },
    report: { type: "boolean" },
    output: { type: "string" },
    "supported-only": { type: "boolean" },
  },
  strict: true,
});
if (
  !values.output ||
  [values.prepare, values.live, values.report].filter(Boolean).length !== 1
)
  throw new Error(
    "Usage: --prepare|--live|--report --output <matrix-directory> [--supported-only]",
  );
const output = resolve(values.output);
const corpus = await loadDesktopProductCorpus();
const unavailable = {
  D02: "Frozen v1 seed has no mock/implementation mismatch specimen. A versioned fixture is required before scoring.",
  D03: "Missing-model admission exists in UI acceptance, but this matrix has no task-specific no-credential lane. Existing local tests are not substituted.",
  D05: "External-edit-after-read trigger and stale-baseline observation not wired into the real Desktop matrix.",
  F04: "Large-output/10000-fragment injection and control-reachability probe not wired into this matrix.",
  F05: "Crash-after-tool-start, relaunch and no-replay probe not wired into this matrix.",
  F06: "Journal-write failure injection and side-effect audit not wired into this matrix.",
};
const files = [
  "apps/desktop/out/main/index.js",
  "apps/desktop/out/main/agent.js",
  "apps/desktop/src/main/product-live-scenarios.ts",
  "apps/desktop/src/main/product-live-policy.ts",
  "apps/desktop/scripts/product-live.mjs",
  "apps/desktop/scripts/product-matrix.mjs",
  "evals/scripts/desktop-product-assertions.mjs",
  "evals/fixtures/desktop-product/manifest.json",
];
const hashes = async () =>
  Object.fromEntries(
    await Promise.all(
      files.map(async (name) => [
        name,
        createHash("sha256")
          .update(await readFile(join(root, name)))
          .digest("hex"),
      ]),
    ),
  );
const revision = async () =>
  (
    await promisify(execFile)("git", ["rev-parse", "HEAD"], { cwd: root })
  ).stdout.trim();
const save = async (name, value) =>
  writeFile(join(output, name), JSON.stringify(value, null, 2) + "\n", {
    mode: 0o600,
  });
if (values.prepare) {
  await mkdir(output, { mode: 0o700 });
  const lanes = [];
  for (const round of [1, 2]) {
    const directory = join(output, `round-${round}`);
    await prepareDesktopProductRound(directory, round);
    const command = join(output, `round-${round}-command`);
    await mkdir(command, { mode: 0o700 });
    await cp(join(directory, "round.json"), join(command, "round.json"));
    await cp(join(directory, "F02"), join(command, "F02"), { recursive: true });
    for (const task of PILOT_TASKS) {
      for (const stage of task === "F02" ? ["model", "command"] : [undefined]) {
        const scenario = pilotScenario(task, stage);
        lanes.push({
          round,
          task,
          ...(stage ? { stage } : {}),
          directory: stage === "command" ? command : directory,
          scenario,
        });
      }
    }
  }
  const plan = {
    schemaVersion: 1,
    sourceRevision: await revision(),
    sha256: await hashes(),
    model: corpus.primaryModel,
    corpus: corpus.revision,
    locale: "zh-CN",
    finalizationInput: "continuation",
    wholeTaskRetries: 0,
    externalDestination: "DeepSeek API",
    maxLogicalModelSteps: lanes.reduce(
      (n, l) => n + l.scenario.limits.maxSteps,
      0,
    ),
    maxWallClockMsPerLane: 200000,
    stimulusDisclosure:
      "Original prompt plus exact per-lane scenario supplement. Supplemented fault probes are not unchanged-prompt baseline.",
    missing: unavailable,
    lanes,
    fullBaselineComplete: false,
  };
  await save("matrix-plan.json", plan);
  console.log(
    `Prepared 48 task rows / ${lanes.length} supported lanes; 6 missing task protocols per round; zero model calls.`,
  );
}
const plan = JSON.parse(
  await readFile(join(output, "matrix-plan.json"), "utf8"),
);
async function report() {
  const rows = [];
  for (const round of [1, 2])
    for (const task of corpus.tasks) {
      const lanes = [];
      for (const lane of plan.lanes.filter(
        (l) => l.round === round && l.task === task.id,
      )) {
        const directory = join(lane.directory, task.id);
        const read = async (name) =>
          readFile(join(directory, name), "utf8").then(JSON.parse, () => null);
        const result = await read("pilot-result.json");
        lanes.push({
          stage: lane.stage ?? null,
          evidence: directory,
          assessment: await read("assessment.json"),
          completion: result?.completion ?? null,
          checks: result?.checks ?? null,
          independent: await read("independent-check.json"),
          attemptFailure: await read("attempt-failure.json"),
        });
      }
      rows.push({
        round,
        task: task.id,
        critical: task.critical,
        status: plan.missing[task.id]
          ? "not_run_missing_protocol"
          : lanes.every((l) => l.completion)
            ? "executed_needs_semantic_review"
            : "not_run_or_infrastructure_failure",
        missingProtocol: plan.missing[task.id] ?? null,
        lanes,
      });
    }
  const result = {
    sourceRevision: plan.sourceRevision,
    model: plan.model,
    rows,
    recordedLogicalModelSteps: rows
      .flatMap((r) => r.lanes)
      .reduce((n, l) => n + (l.completion?.modelSteps ?? 0), 0),
    wholeTaskRetries: 0,
    fullBaselineComplete: false,
    independentUserTrial: false,
  };
  await save("matrix-results.json", result);
  return result;
}
if (values.live) {
  if (!values["supported-only"])
    throw new Error(
      "Full baseline blocked by six missing task protocols; use explicit --supported-only for the disclosed partial matrix",
    );
  if (
    (await revision()) !== plan.sourceRevision ||
    JSON.stringify(await hashes()) !== JSON.stringify(plan.sha256)
  )
    throw new Error("Source/build drift since preparation");
  // Validate every lane before accessing credentials or making a paid request.
  for (const lane of plan.lanes) {
    const args = [
      "scripts/product-live.mjs",
      "--check",
      "--round",
      lane.directory,
      "--task",
      lane.task,
      ...(lane.stage ? ["--cancel-stage", lane.stage] : []),
    ];
    await promisify(execFile)(process.execPath, args, { cwd: desktop });
  }
  const attempts = [];
  for (const lane of plan.lanes) {
    if (
      (await revision()) !== plan.sourceRevision ||
      JSON.stringify(await hashes()) !== JSON.stringify(plan.sha256)
    )
      throw new Error("Source/build drift during matrix");
    const directory = join(lane.directory, lane.task);
    const args = [
      "scripts/product-live.mjs",
      "--live",
      "--round",
      lane.directory,
      "--task",
      lane.task,
      ...(lane.stage ? ["--cancel-stage", lane.stage] : []),
    ];
    console.log(
      `START round=${lane.round} task=${lane.task} stage=${lane.stage ?? "none"}`,
    );
    const child = spawn(process.execPath, args, {
      cwd: desktop,
      stdio: ["ignore", "pipe", "pipe"],
    });
    // Launcher logs contain no credentials; it independently redacts the provider key.
    let log = "";
    for (const stream of [child.stdout, child.stderr])
      stream.on("data", (chunk) => {
        log += chunk.toString();
      });
    const code = await new Promise((resolveExit, reject) => {
      child.once("error", reject);
      child.once("exit", resolveExit);
    });
    await writeFile(join(directory, "matrix-launch.log"), log, {
      flag: "wx",
      mode: 0o600,
    });
    attempts.push({
      round: lane.round,
      task: lane.task,
      stage: lane.stage ?? null,
      exitCode: code,
    });
    await save("matrix-attempts.json", attempts);
    const results = await report();
    console.log(`END round=${lane.round} task=${lane.task} exit=${code}`);
    const row = results.rows.find(
      (r) => r.round === lane.round && r.task === lane.task,
    );
    const current = row.lanes.find((l) => l.stage === (lane.stage ?? null));
    if (
      !current.completion ||
      ["configuration_error", "disconnected"].includes(
        current.completion.reason,
      ) ||
      ["provider-unavailable", "provider-rate-limited"].includes(
        current.completion.message,
      )
    )
      throw new Error(
        "Infrastructure/provider failure: stopping paid batch; original attempt retained",
      );
    if (
      row.critical &&
      Object.values(current.checks ?? {}).some((v) => v === false)
    )
      throw new Error(
        "Critical contract failed: stopping paid batch; no retry",
      );
  }
}
const result = await report();
console.log(
  `Report: ${result.rows.length} task rows, ${result.recordedLogicalModelSteps} recorded logical steps; full baseline remains incomplete.`,
);
