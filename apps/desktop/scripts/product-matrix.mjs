import { execFile, spawn } from "node:child_process";
import { cp, mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs, promisify } from "node:util";
import {
  loadDesktopProductCorpus,
  prepareDesktopProductRound,
} from "../../../evals/dist/desktop-product-evaluation.js";
import {
  acceptanceProtocol,
  PILOT_TASKS,
  pilotDeadlines,
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
    acceptance: { type: "boolean" },
    "max-paid-steps": { type: "string" },
    "acknowledge-variable-cost": { type: "boolean" },
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
if (values.acceptance && !values.prepare)
  throw new Error("Set --acceptance only when preparing a fresh matrix");
if (values.acceptance && values["fault-protocol"])
  throw new Error("Acceptance pins its protocol per task");
if (
  (values["max-paid-steps"] || values["acknowledge-variable-cost"]) &&
  !values.live
)
  throw new Error("Spending controls apply only to --live");
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
  "apps/desktop/src/main/product-live-acceptance.ts",
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
// Include every seed and protocol file, not only the manifest or injected tests.
async function collectInputs(directory) {
  for (const entry of (
    await readdir(join(root, directory), { withFileTypes: true })
  ).sort((a, b) => a.name.localeCompare(b.name))) {
    const name = `${directory}/${entry.name}`;
    if (entry.isDirectory()) await collectInputs(name);
    else if (entry.isFile()) {
      if (!files.includes(name)) files.push(name);
    } else throw new Error(`Unsupported fixture entry: ${name}`);
  }
}
await collectInputs("evals/fixtures/desktop-product/seed");
await collectInputs("evals/fixtures/desktop-product/protocols");
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
  const tasks = values.task ?? PILOT_TASKS;
  if (
    new Set(tasks).size !== tasks.length ||
    tasks.some((task) => !PILOT_TASKS.includes(task))
  )
    throw new Error("Invalid matrix task subset");
  await mkdir(output, { mode: 0o700 });
  const lanes = [];
  for (const round of [1, 2]) {
    const protocols = values.acceptance
      ? [...new Set(tasks.map(acceptanceProtocol))]
      : [faultProtocol];
    const directories = {};
    for (const protocol of protocols) {
      const directory = join(
        output,
        values.acceptance ? `round-${round}-${protocol}` : `round-${round}`,
      );
      await prepareDesktopProductRound(directory, round, protocol);
      directories[protocol] = directory;
    }
    const directory =
      directories[
        values.acceptance ? acceptanceProtocol("F02") : faultProtocol
      ] ?? directories[protocols[0]];
    const command = join(output, `round-${round}-command`);
    await mkdir(command, { mode: 0o700 });
    await cp(join(directory, "round.json"), join(command, "round.json"));
    await cp(join(directory, "F02"), join(command, "F02"), { recursive: true });
    for (const task of tasks) {
      for (const stage of task === "F02" ? ["model", "command"] : [undefined]) {
        const protocol = values.acceptance
          ? acceptanceProtocol(task)
          : faultProtocol;
        const profile = values.acceptance ? "full-acceptance-v1" : "bounded";
        const scenario = pilotScenario(task, stage, protocol, profile);
        lanes.push({
          round,
          task,
          ...(stage ? { stage } : {}),
          directory: stage === "command" ? command : directories[protocol],
          profile,
          faultProtocol: protocol,
          deadlines: pilotDeadlines(task, profile),
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
    maxWallClockMsPerLane: Math.max(
      ...lanes.map(
        (lane) => lane.deadlines.launcherMs * (lane.task === "F05" ? 2 : 1),
      ),
    ),
    maxSerialLauncherMs: lanes.reduce(
      (n, lane) =>
        n + lane.deadlines.launcherMs * (lane.task === "F05" ? 2 : 1),
      0,
    ),
    stimulusDisclosure:
      "Original prompt plus exact per-lane scenario supplement. Supplemented fault probes are not unchanged-prompt baseline.",
    missing: unavailable,
    faultProtocol,
    acceptanceProfile: values.acceptance ? "full-acceptance-v1" : null,
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
  if (
    plan.lanes.some((lane) => lane.profile === "full-acceptance-v1") !==
    (plan.acceptanceProfile === "full-acceptance-v1")
  )
    throw new Error("Modified acceptance profile declaration");
  if (values.task || values["fault-protocol"])
    throw new Error(
      "Live execution uses the frozen plan; task overrides are forbidden",
    );
  if (!values["supported-only"])
    throw new Error(
      "Live execution requires --supported-only; task execution does not establish full semantic baseline acceptance",
    );
  const paidCeiling =
    plan.providerMode === "local-scripted"
      ? 0
      : plan.lanes.reduce(
          (n, lane) =>
            n +
            (lane.task === "D03" || lane.scenario.localOnly
              ? 0
              : lane.scenario.limits.maxSteps),
          0,
        );
  let paidBudget;
  if (plan.acceptanceProfile === "full-acceptance-v1") {
    const input = values["max-paid-steps"] ?? "";
    paidBudget = Number(input);
    if (
      !/^\d+$/.test(input) ||
      !Number.isSafeInteger(paidBudget) ||
      paidBudget < paidCeiling ||
      paidBudget > 570
    )
      throw new Error(
        `Acceptance requires --max-paid-steps covering the frozen ${paidCeiling} step ceiling (maximum 570); no credentials read`,
      );
    if (paidCeiling > 0 && !values["acknowledge-variable-cost"])
      throw new Error(
        "Acceptance requires --acknowledge-variable-cost: step quotas are not currency caps; no credentials read",
      );
    if (
      plan.wholeTaskRetries !== 0 ||
      plan.maxPaidLogicalModelSteps !== paidCeiling
    )
      throw new Error("Modified acceptance budget");
    for (const lane of plan.lanes) {
      const canonical = pilotScenario(
        lane.task,
        lane.stage,
        acceptanceProtocol(lane.task),
        "full-acceptance-v1",
      );
      const expectedDirectory = join(
        output,
        lane.stage === "command"
          ? `round-${lane.round}-command`
          : `round-${lane.round}-${acceptanceProtocol(lane.task)}`,
      );
      if (
        ![1, 2].includes(lane.round) ||
        lane.directory !== expectedDirectory ||
        lane.profile !== "full-acceptance-v1" ||
        lane.faultProtocol !== acceptanceProtocol(lane.task) ||
        JSON.stringify(lane.scenario) !== JSON.stringify(canonical)
      )
        throw new Error("Modified acceptance lane");
    }
    const expectedIds = [1, 2].flatMap((round) =>
      plan.selectedTasks.flatMap((task) =>
        (task === "F02" ? ["model", "command"] : [undefined]).map(
          (stage) => `${round}:${task}:${stage ?? ""}`,
        ),
      ),
    );
    const actualIds = plan.lanes.map(
      (lane) => `${lane.round}:${lane.task}:${lane.stage ?? ""}`,
    );
    if (
      new Set(plan.selectedTasks).size !== plan.selectedTasks.length ||
      JSON.stringify(expectedIds) !== JSON.stringify(actualIds)
    )
      throw new Error("Modified acceptance lane inventory");
  }
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
      ...(lane.profile === "full-acceptance-v1" ? ["--full-acceptance"] : []),
      ...(plan.providerMode === "local-scripted" ? ["--fixture"] : []),
    ];
    await promisify(execFile)(process.execPath, args, { cwd: desktop });
  }
  const attempts = [];
  // Persist reservations before launching. A crash consumes the reservation;
  // existing ledger prevents silent resume/retry of a partially executed batch.
  const ledger = {
    maxPaidSteps: paidBudget ?? paidCeiling,
    reservedPaidSteps: 0,
    reservations: [],
  };
  if (plan.acceptanceProfile)
    await writeFile(
      join(output, "matrix-budget.json"),
      JSON.stringify(ledger, null, 2) + "\n",
      { flag: "wx", mode: 0o600 },
    );
  for (const lane of plan.lanes) {
    if (
      (await revision()) !== plan.sourceRevision ||
      JSON.stringify(await hashes()) !== JSON.stringify(plan.sha256)
    )
      throw new Error("Source/build drift during matrix");
    const directory = join(lane.directory, lane.task);
    if (plan.acceptanceProfile) {
      const reserve =
        plan.providerMode === "local-scripted" ||
        lane.task === "D03" ||
        lane.scenario.localOnly
          ? 0
          : lane.scenario.limits.maxSteps;
      if (ledger.reservedPaidSteps + reserve > ledger.maxPaidSteps)
        throw new Error("Paid step quota exhausted before launch");
      ledger.reservedPaidSteps += reserve;
      ledger.reservations.push({
        round: lane.round,
        task: lane.task,
        stage: lane.stage ?? null,
        steps: reserve,
      });
      await save("matrix-budget.json", ledger);
    }
    const args = [
      "scripts/product-live.mjs",
      "--live",
      "--round",
      lane.directory,
      "--task",
      lane.task,
      ...(lane.stage ? ["--cancel-stage", lane.stage] : []),
      ...(lane.profile === "full-acceptance-v1" ? ["--full-acceptance"] : []),
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
