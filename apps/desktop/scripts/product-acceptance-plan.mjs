import { execFile } from "node:child_process";
import { readdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs, promisify } from "node:util";
import {
  acceptanceLane,
  pilotDeadlines,
} from "../src/main/product-live-scenarios.ts";
import { snapshotMatrixInputs } from "./product-matrix-inputs.mjs";

// Offline proposal only. Never imports the live launcher or credential manager.
const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const { values } = parseArgs({
  options: { output: { type: "string" }, "acceptance-v2": { type: "boolean" } },
  strict: true,
});
if (!values.output)
  throw new Error("Usage: --output <new-plan.json>; offline only");
const version = values["acceptance-v2"]
  ? "full-acceptance-v2"
  : "full-acceptance-v1";
const manifest = "evals/fixtures/desktop-product/manifest.json";
const corpus = JSON.parse(await readFile(join(root, manifest), "utf8"));
const files = [
  manifest,
  "apps/desktop/scripts/product-acceptance-plan.mjs",
  "apps/desktop/scripts/product-matrix.mjs",
  "apps/desktop/scripts/product-matrix-inputs.mjs",
  "apps/desktop/scripts/product-live.mjs",
  "apps/desktop/src/main/product-live-scenarios.ts",
  "apps/desktop/src/main/product-live-policy.ts",
  "evals/scripts/desktop-product-assertions.mjs",
  "docs/development/DESKTOP_PRODUCT_PRD.md",
];
async function collect(directory) {
  for (const entry of (
    await readdir(join(root, directory), { withFileTypes: true })
  ).sort((a, b) => a.name.localeCompare(b.name))) {
    const name = `${directory}/${entry.name}`;
    if (entry.isDirectory()) await collect(name);
    else if (entry.isFile()) files.push(name);
    else throw new Error(`Unsupported fixture entry: ${name}`);
  }
}
await collect("evals/fixtures/desktop-product/seed");
await collect("evals/fixtures/desktop-product/protocols");
const snapshot = await snapshotMatrixInputs(root, files, [
  "apps/desktop/out/main/index.js",
  "apps/desktop/out/main/agent.js",
]);
const lanes = [];
for (const round of [1, 2]) {
  for (const task of corpus.tasks) {
    for (const stage of task.id === "F02"
      ? ["model", "command"]
      : [undefined]) {
      const lane = acceptanceLane(task.id, stage, version);
      const protocol = lane.faultProtocol;
      const profile = lane.profile;
      const current = lane.scenario;
      const limits = current.limits;
      const paidSteps =
        current.localOnly || task.id === "D03" ? 0 : limits.maxSteps;
      lanes.push({
        round,
        task: task.id,
        stage: stage ?? null,
        critical: task.critical,
        protocol,
        currentProfile: profile,
        proposedLimits: limits,
        currentLimits: current.limits,
        requiresBudgetWiring:
          JSON.stringify(limits) !== JSON.stringify(current.limits),
        maxPaidLogicalSteps: paidSteps,
        proposedLauncherDeadlineMs:
          pilotDeadlines(task.id, profile).launcherMs *
          (task.id === "F05" ? 2 : 1),
        stimulus: { prompt: task.prompt, supplement: current.supplement },
        expectedWrites: current.expectedWrites,
        assertion: task.assertion,
        review: {
          correctness: null,
          scope: null,
          authority: null,
          honesty: null,
          usability: null,
          independentEvidence: [],
          humanEvidence: [],
          outcome: "pending",
        },
      });
    }
  }
}
const plan = {
  schemaVersion: 1,
  kind: "desktop-acceptance-proposal",
  acceptanceProfile: version,
  preparedAt: new Date().toISOString(),
  sourceRevision: (
    await promisify(execFile)("git", ["rev-parse", "HEAD"], { cwd: root })
  ).stdout.trim(),
  workingTreeStatus: (
    await promisify(execFile)("git", ["status", "--porcelain=v1"], {
      cwd: root,
    })
  ).stdout,
  inputSnapshot: snapshot,
  corpus: corpus.revision,
  model: corpus.primaryModel,
  locale: "zh-CN",
  rubric: corpus.rubric,
  taskRows: 48,
  executionLanes: lanes.length,
  wholeTaskRetries: 0,
  externalCallsMade: 0,
  executionReady: false,
  budget: {
    maxPaidLogicalSteps: lanes.reduce(
      (n, lane) => n + lane.maxPaidLogicalSteps,
      0,
    ),
    maxSerialLauncherMs: lanes.reduce(
      (n, lane) => n + lane.proposedLauncherDeadlineMs,
      0,
    ),
    currencyCap: null,
    tokenCap: null,
    caveat:
      "Logical steps are not billed requests or money. Provider retries, token usage and prices need separate accounting; timeouts are planned, not enforced here.",
  },
  gates: {
    perRound: { denominator: 24, minimumPasses: 22, allCriticalMustPass: true },
    independentUsers: {
      users: 5,
      tasks: ["Q02", "E01", "F03"],
      minimumPasses: 12,
      denominator: 15,
    },
    passRule:
      "All five rubric dimensions require evidence and human review; completed or green authored tests alone never establish success. Both F02 stages must pass for one task pass.",
  },
  blockers: [
    `Prepare a fresh matrix with ${values["acceptance-v2"] ? "--acceptance-v2" : "--acceptance"}; this offline proposal is not an executable matrix or approval to spend.`,
    "Freeze clean source/build/fixture hashes and fresh isolated workspaces before execution; invalidate the proposal after changes.",
    "Set --max-paid-steps for the frozen batch and explicitly acknowledge variable cost before paid execution. This quota is not a currency cap; a hard monetary limit requires provider-side controls.",
    "Freeze semantic review evidence requirements before execution; preserve failures and stop on critical, provider, infrastructure or source-drift errors without whole-task retry.",
  ],
  exclusions: [
    "Telegram",
    "Independent user trials",
    "Manual IME/VoiceOver checks",
    "Other platform installs",
    "Release publication",
  ],
  fullBaselineComplete: false,
  lanes,
};
await writeFile(resolve(values.output), JSON.stringify(plan, null, 2) + "\n", {
  flag: "wx",
  mode: 0o600,
});
console.log(
  JSON.stringify(
    {
      output: resolve(values.output),
      taskRows: plan.taskRows,
      executionLanes: plan.executionLanes,
      budget: plan.budget,
      externalCallsMade: 0,
      executionReady: false,
    },
    null,
    2,
  ),
);
