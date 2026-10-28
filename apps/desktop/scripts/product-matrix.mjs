import { execFile, spawn } from "node:child_process";
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
import { snapshotMatrixInputs } from "./product-matrix-inputs.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const desktop = join(root, "apps/desktop");
const { values } = parseArgs({
  options: {
    prepare: { type: "boolean" },
    live: { type: "boolean" },
    fixture: { type: "boolean" },
    report: { type: "boolean" },
    output: { type: "string" },
    "supported-only": { type: "boolean" },
    task: { type: "string", multiple: true },
    "fault-protocol": { type: "string" },
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
const faultProtocol = values["fault-protocol"] ?? "desktop-product-faults-v1";
if (
  ![
    "desktop-product-faults-v1",
    "desktop-product-faults-v2",
    "desktop-product-faults-v3",
    "desktop-product-faults-v4",
    "desktop-product-faults-v5",
  ].includes(faultProtocol)
)
  throw new Error("Unknown fault protocol");
if (values["fault-protocol"] && !values.prepare)
  throw new Error("Set --fault-protocol only when preparing a fresh matrix");
const corpus = await loadDesktopProductCorpus();
const unavailable = {};
const buildFiles = [
  "apps/desktop/out/main/index.js",
  "apps/desktop/out/main/agent.js",
];
const files = [
  "apps/desktop/src/main/product-control-acceptance.ts",
  "apps/desktop/src/main/product-control-faults.ts",
  "apps/desktop/src/main/product-control-stream.ts",
  "apps/desktop/src/main/product-live-scenarios.ts",
  "apps/desktop/src/main/product-live-policy.ts",
  "apps/desktop/src/main/product-regression-checks.ts",
  "apps/desktop/scripts/product-live.mjs",
  "apps/desktop/scripts/product-matrix.mjs",
  "apps/desktop/scripts/product-matrix-inputs.mjs",
  "evals/scripts/desktop-product-assertions.mjs",
  "evals/scripts/desktop-product-attempt.mjs",
  "evals/fixtures/desktop-product/protocols/faults-v1/D02/mock.mjs",
  "evals/fixtures/desktop-product/protocols/faults-v1/D02/mock-implementation.mjs",
  "evals/fixtures/desktop-product/protocols/faults-v1/D02/mock.test.mjs",
  "evals/fixtures/desktop-product/protocols/faults-v2/E04/path.test.mjs",
  "evals/fixtures/desktop-product/manifest.json",
];
const snapshot = () => snapshotMatrixInputs(root, files, buildFiles);
const hashes = async () => (await snapshot()).sha256;
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
    await prepareDesktopProductRound(directory, round, faultProtocol);
    const command = join(output, `round-${round}-command`);
    await mkdir(command, { mode: 0o700 });
    await cp(join(directory, "round.json"), join(command, "round.json"));
    await cp(join(directory, "F02"), join(command, "F02"), { recursive: true });
    const tasks = values.task ?? PILOT_TASKS;
    if (
      new Set(tasks).size !== tasks.length ||
      tasks.some((task) => !PILOT_TASKS.includes(task))
    )
      throw new Error("Invalid matrix task subset");
    for (const task of tasks) {
      for (const stage of task === "F02" ? ["model", "command"] : [undefined]) {
        const scenario = pilotScenario(task, stage, faultProtocol);
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
  const inputs = await snapshot();
  const plan = {
    schemaVersion: 1,
    sourceRevision: await revision(),
    sha256: inputs.sha256,
    missingBuildArtifacts: inputs.missingBuildArtifacts,
    model: corpus.primaryModel,
    corpus: corpus.revision,
    locale: "zh-CN",
    finalizationInput: "continuation",
    wholeTaskRetries: 0,
    externalDestination:
      values.fixture ||
      lanes.every((l) => l.task === "D03" || l.scenario.localOnly)
        ? null
        : "DeepSeek API",
    maxLogicalModelSteps: lanes.reduce(
      (n, l) => n + (l.task === "D03" ? 0 : l.scenario.limits.maxSteps),
      0,
    ),
    maxWallClockMsPerLane: lanes.some((l) => l.task === "F05")
      ? 400000
      : 200000,
    stimulusDisclosure:
      "Original prompt plus exact per-lane scenario supplement. Supplemented fault probes are not unchanged-prompt baseline.",
    missing: unavailable,
    faultProtocol,
    selectedTasks: values.task ?? PILOT_TASKS,
    providerMode:
      values.fixture ||
      lanes.every((l) => l.scenario.localOnly || l.task === "D03")
        ? "local-scripted"
        : lanes.some((l) => l.scenario.localOnly)
          ? "mixed"
          : "external",
    maxPaidLogicalModelSteps: values.fixture
      ? 0
      : lanes.reduce(
          (n, l) =>
            n +
            (l.task === "D03" || l.scenario.localOnly
              ? 0
              : l.scenario.limits.maxSteps),
          0,
        ),
    lanes,
    fullBaselineComplete: false,
  };
  await save("matrix-plan.json", plan);
  console.log(
    `Prepared 48 task rows / ${lanes.length} supported lanes; no missing task hooks; fault controls are local scripted lanes; zero model calls.`,
  );
  if (inputs.missingBuildArtifacts.length)
    console.log(
      "Desktop build is pending; build and prepare a fresh matrix before live execution.",
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
          admission: result?.admission ?? null,
          controlReview: result?.controlReview ?? null,
          fixtureModel: result?.fixtureModel ?? null,
          forensic: await read("attempt-records.json"),
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
          : lanes.length === 0
            ? "not_selected"
            : lanes.every(
                  (l) =>
                    l.completion ||
                    l.admission?.blocked ||
                    l.controlReview?.checked,
                )
              ? "executed_needs_semantic_review"
              : "not_run_or_infrastructure_failure",
        missingProtocol: plan.missing[task.id] ?? null,
        lanes,
      });
    }
  const result = {
    sourceRevision: plan.sourceRevision,
    model: plan.model,
    providerMode: plan.providerMode,
    rows,
    recordedLogicalModelSteps: rows
      .flatMap((r) => r.lanes)
      .reduce(
        (n, l) =>
          n +
          (l.completion?.modelSteps ?? l.forensic?.modelStartsObserved ?? 0),
        0,
      ),
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
      "Live execution requires --supported-only; task execution does not establish full semantic baseline acceptance",
    );
  const inputs = await snapshot();
  if (plan.missingBuildArtifacts?.length || inputs.missingBuildArtifacts.length)
    throw new Error(
      "Desktop build missing at preparation; run pnpm desktop:build and prepare a fresh matrix before live execution",
    );
  if (
    (await revision()) !== plan.sourceRevision ||
    JSON.stringify(inputs.sha256) !== JSON.stringify(plan.sha256)
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
      ...(plan.providerMode === "local-scripted" ? ["--fixture"] : []),
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
      ...(plan.providerMode === "local-scripted" ? ["--fixture"] : []),
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
      !(
        current.completion ||
        current.admission?.blocked ||
        current.controlReview?.checked
      ) ||
      ["configuration_error", "disconnected"].includes(
        current.completion?.reason,
      ) ||
      ["provider-unavailable", "provider-rate-limited"].includes(
        current.completion?.message,
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
