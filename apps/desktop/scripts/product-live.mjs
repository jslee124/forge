import { execFile, spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, readdir, readFile, stat, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs, promisify } from "node:util";
import { checkProductEdit } from "../../../evals/scripts/desktop-product-assertions.mjs";
import { collectAttemptEvidence } from "../../../evals/scripts/desktop-product-attempt.mjs";
import { AuthenticationManager } from "../../../packages/auth/dist/index.js";
import {
  CONTROL_TASKS,
  PILOT_TASKS,
  pilotScenario,
} from "../src/main/product-live-scenarios.ts";

const { values } = parseArgs({
  options: {
    live: { type: "boolean" },
    fixture: { type: "boolean" },
    check: { type: "boolean" },
    round: { type: "string", multiple: true },
    task: { type: "string", multiple: true },
    "finalization-input": { type: "string" },
    "recover-summary": { type: "boolean" },
    locale: { type: "string" },
    "cancel-stage": { type: "string" },
  },
  strict: true,
});
if (
  (!values.live && !values.check) ||
  (values.live && values.check) ||
  !values.round?.length
)
  throw new Error(
    "Usage: --check|--live --round <prepared-round-directory> [--round <directory>] [--task <supported-task-id>] [--finalization-input continuation|evidence] [--recover-summary] [--locale en|zh-CN] [--cancel-stage model|command]",
  );
const tasks = values.task ?? ["Q02", "E01", "F03"];
if (
  new Set(tasks).size !== tasks.length ||
  tasks.some((task) => !PILOT_TASKS.includes(task))
)
  throw new Error(
    `Pilot tasks must be unique members of ${PILOT_TASKS.join(", ")}`,
  );
for (const task of tasks)
  pilotScenario(task, task === "F02" ? values["cancel-stage"] : undefined);
if (values["cancel-stage"] && !tasks.includes("F02"))
  throw new Error("--cancel-stage requires F02");
if (
  values.fixture &&
  tasks.some(
    (task) => !["D02", "D03", "D05", "D06", ...CONTROL_TASKS].includes(task),
  )
)
  throw new Error("Unsupported local fault fixture task");
const usesLocalFixture = (task) =>
  Boolean(values.fixture || CONTROL_TASKS.includes(task));
const finalizationInput = values["finalization-input"] ?? "continuation";
if (!["continuation", "evidence"].includes(finalizationInput))
  throw new Error("Invalid finalization input");
if (
  values["recover-summary"] &&
  !tasks.some((task) => ["E01", "F03"].includes(task))
)
  throw new Error("Summary recovery pilot requires E01 or F03");
const locale = values.locale ?? "zh-CN";
if (!["en", "zh-CN"].includes(locale)) throw new Error("Invalid pilot locale");
const require = createRequire(import.meta.url);
let key = ""; // Loaded only after all selected inputs validate; D03 never reads credentials.
const corpus = JSON.parse(
  await readFile(
    new URL(
      "../../../evals/fixtures/desktop-product/manifest.json",
      import.meta.url,
    ),
    "utf8",
  ),
);
async function inventory(directory, prefix = "") {
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory())
      files.push(...(await inventory(join(directory, entry.name), relative)));
    else if (entry.isFile()) files.push(relative);
    else throw new Error("Nonregular fixture entry");
  }
  return files.sort();
}
const originalFiles = await inventory(
  fileURLToPath(
    new URL("../../../evals/fixtures/desktop-product/seed/", import.meta.url),
  ),
);
const sourceRevision = (
  await promisify(execFile)("git", ["rev-parse", "HEAD"])
).stdout.trim();
for (const supplied of values.round) {
  const round = resolve(supplied);
  const manifest = JSON.parse(
    await readFile(join(round, "round.json"), "utf8"),
  );
  if (
    manifest.revision !== "desktop-product-v1" ||
    JSON.stringify(manifest.primaryModel) !==
      JSON.stringify({
        engine: "forge",
        provider: "deepseek",
        id: "deepseek-flash",
        reasoningEffort: "high",
      })
  )
    throw new Error("Unrecognized prepared model/corpus");
  const expectedByTask = {};
  if (
    manifest.faultProtocol !== undefined &&
    manifest.faultProtocol !== "desktop-product-faults-v1"
  )
    throw new Error("Unrecognized fault protocol");
  {
    if (
      JSON.stringify(Object.keys(manifest.fixtureSha256).sort()) !==
      JSON.stringify(originalFiles)
    )
      throw new Error("Unrecognized fixture inventory");
    const plans = [];
    for (const task of tasks) {
      const directory = join(round, task);
      const assessment = JSON.parse(
        await readFile(join(directory, "assessment.json"), "utf8"),
      );
      if (
        assessment.prompt !==
        corpus.tasks.find((entry) => entry.id === task)?.prompt
      )
        throw new Error("Modified task prompt");
      if (
        task === "D02" &&
        manifest.faultProtocol !== "desktop-product-faults-v1"
      )
        throw new Error("D02 requires the versioned mock fixture protocol");
      const overlays =
        task === "D02" ? (manifest.taskFixtureSha256?.D02 ?? {}) : {};
      if (task === "D02") {
        const overlayUrl = new URL(
          "../../../evals/fixtures/desktop-product/protocols/faults-v1/D02/",
          import.meta.url,
        );
        const names = await inventory(fileURLToPath(overlayUrl));
        if (
          JSON.stringify(Object.keys(overlays).sort()) !== JSON.stringify(names)
        )
          throw new Error("Modified fault fixture inventory");
        for (const name of names)
          if (
            createHash("sha256")
              .update(await readFile(new URL(name, overlayUrl)))
              .digest("hex") !== overlays[name]
          )
            throw new Error("Modified fault fixture hash");
      }
      const expected = { ...manifest.fixtureSha256, ...overlays };
      expectedByTask[task] = expected;
      if (
        JSON.stringify(await inventory(join(directory, "workspace"))) !==
        JSON.stringify(Object.keys(expected).sort())
      )
        throw new Error("Workspace has extra or missing files");
      for (const [name, expected] of Object.entries(manifest.fixtureSha256)) {
        if (name.startsWith("/") || name.split(/[\\/]/).includes(".."))
          throw new Error("Invalid seed path");
        const original = await readFile(
          new URL(
            `../../../evals/fixtures/desktop-product/seed/${name}`,
            import.meta.url,
          ),
        );
        const actual = await readFile(join(round, task, "workspace", name));
        if (
          createHash("sha256").update(original).digest("hex") !== expected ||
          createHash("sha256").update(actual).digest("hex") !== expected
        )
          throw new Error(`Modified seed: ${task}/${name}`);
      }
      for (const [name, expectedHash] of Object.entries(overlays))
        if (
          createHash("sha256")
            .update(await readFile(join(directory, "workspace", name)))
            .digest("hex") !== expectedHash
        )
          throw new Error(`Modified task overlay: ${task}/${name}`);
      plans.push({
        task,
        faultProtocol: manifest.faultProtocol ?? null,
        taskFixtureSha256: overlays,
        providerMode: usesLocalFixture(task)
          ? "local-scripted"
          : task === "D03"
            ? "none"
            : "external",
        credentialAccess:
          task === "D03" || usesLocalFixture(task)
            ? "none"
            : "only with --live after validation",
        modelSteps:
          task === "D03"
            ? 0
            : pilotScenario(
                task,
                task === "F02" ? values["cancel-stage"] : undefined,
              ).limits.maxSteps,
        toolCalls: pilotScenario(
          task,
          task === "F02" ? values["cancel-stage"] : undefined,
        ).limits.maxToolCalls,
        scenario: pilotScenario(
          task,
          task === "F02" ? values["cancel-stage"] : undefined,
        ),
        wallClockMs: task === "F05" ? 400000 : 175000,
        processPhases:
          task === "F05" ? ["crash", "read-only-reopen"] : ["execution"],
        status: "not_run",
        finalizationInput,
        locale,
        ...(values["recover-summary"] && ["E01", "F03"].includes(task)
          ? {
              recoverySummary: {
                maxModelSteps: 1,
                maxToolCalls: 0,
                wallClockMs: 90000,
              },
            }
          : {}),
      });
    }
    if (values.check) {
      await writeFile(
        join(round, "pilot-plan.json"),
        JSON.stringify(
          {
            sourceRevision,
            round: manifest.round,
            model: manifest.primaryModel,
            tasks: plans,
            fixtureFiles: Object.keys(manifest.fixtureSha256),
            externalDestination: tasks.every(
              (task) => task === "D03" || usesLocalFixture(task),
            )
              ? null
              : "DeepSeek API",
            externalCallsMade: 0,
            approval: "awaiting explicit confirmation",
            fullBaselineComplete: false,
          },
          null,
          2,
        ) + "\n",
        { mode: 0o600 },
      );
      console.log(
        `Round ${manifest.round}: pinned seed/model checks passed; ${tasks.length} pilot tasks pending; no credential access or provider calls`,
      );
      continue;
    }
  }
  const results = [];
  for (const task of tasks) {
    const directory = join(round, task);
    const workspace = join(directory, "workspace");
    for (const [name, expected] of Object.entries(expectedByTask[task])) {
      const actual = createHash("sha256")
        .update(await readFile(join(workspace, name)))
        .digest("hex");
      if (actual !== expected)
        throw new Error(`Modified seed: ${task}/${name}`);
    }
    if (task !== "D03" && !usesLocalFixture(task) && !key)
      key = new AuthenticationManager().requireApiKey("deepseek").apiKey;
    const home = join(directory, "runtime-home");
    await mkdir(home, { mode: 0o700 }); // A prior attempt is retained, never overwritten or silently retried.
    const limits = pilotScenario(
      task,
      task === "F02" ? values["cancel-stage"] : undefined,
    ).limits;
    await writeFile(
      join(home, "config.json"),
      JSON.stringify({
        schemaVersion: 1,
        model: manifest.primaryModel,
        limits,
      }),
      { mode: 0o600, flag: "wx" },
    );
    const env = Object.fromEntries(
      Object.entries(process.env).filter(
        ([name]) => !/KEY|TOKEN|SECRET|PASSWORD|AUTH|CREDENTIAL/i.test(name),
      ),
    );
    Object.assign(env, {
      CI: "true",
      ...(task !== "D03" && !usesLocalFixture(task)
        ? { DEEPSEEK_API_KEY: key }
        : {}),
      FORGE_HOME: home,
      FORGE_PRODUCT_LIVE_HOME: home,
      FORGE_PRODUCT_LIVE_WORKSPACE: workspace,
      FORGE_PRODUCT_LIVE_TASK: task,
      FORGE_PRODUCT_LIVE_FIXTURE: usesLocalFixture(task) ? "1" : "0",
      FORGE_PRODUCT_LIVE_OPT_IN: "1",
      FORGE_PRODUCT_LIVE_FINALIZATION_INPUT: finalizationInput,
      FORGE_PRODUCT_LIVE_LOCALE: locale,
      ...(task === "F02"
        ? { FORGE_PRODUCT_LIVE_CANCEL_STAGE: values["cancel-stage"] }
        : {}),
      FORGE_PRODUCT_LIVE_RECOVER_SUMMARY:
        values["recover-summary"] && ["E01", "F03"].includes(task) ? "1" : "0",
    });
    console.log(
      `Round ${manifest.round} / ${task}: starting ${task === "D03" ? "zero-call admission" : usesLocalFixture(task) ? "local scripted fixture" : "real provider run"}; max steps ${limits.maxSteps}`,
    );
    const log = [];
    async function launchDesktop(phase) {
      const child = spawn(
        require("electron"),
        [resolve("."), "--desktop-product-live"],
        {
          env: {
            ...env,
            ...(phase ? { FORGE_PRODUCT_CONTROL_PHASE: phase } : {}),
          },
          stdio: ["ignore", "pipe", "pipe"],
        },
      );
      for (const stream of [child.stdout, child.stderr])
        stream.on("data", (chunk) =>
          log.push(
            key
              ? chunk.toString().split(key).join("[redacted]")
              : chunk.toString(),
          ),
        );
      const timer = setTimeout(
        () => child.kill(),
        values["recover-summary"] && ["E01", "F03"].includes(task)
          ? 290000
          : 200000,
      );
      try {
        return {
          code: await new Promise((resolveExit, reject) => {
            child.once("error", reject);
            child.once("exit", resolveExit);
          }),
          launchError: undefined,
        };
      } catch (cause) {
        return { code: null, launchError: String(cause) };
      } finally {
        clearTimeout(timer);
      }
    }
    let { code, launchError } = await launchDesktop();
    if (code === 0 && task === "F05") {
      // A fresh process inspects the crashed run; it never resubmits its prompt.
      await readFile(join(directory, "crash-start.json"), "utf8");
      ({ code, launchError } = await launchDesktop("reopen"));
    }
    await writeFile(join(directory, "desktop.log"), log.join(""), {
      mode: 0o600,
      flag: "wx",
    });
    if (code !== 0) {
      const forensic = await collectAttemptEvidence(home, directory).catch(
        (error) => ({ error: String(error) }),
      );
      const retained = await readFile(
        join(directory, "pilot-result.json"),
        "utf8",
      ).then(JSON.parse, () => undefined);
      const failedAssessment = JSON.parse(
        await readFile(join(directory, "assessment.json"), "utf8"),
      );
      failedAssessment.status = retained
        ? "executed_contract_failed"
        : "infrastructure_failed";
      const evidenceCandidates = retained
        ? [
            "pilot-result.json",
            "events.json",
            "desktop.png",
            "attempt-failure.json",
          ]
        : [
            "attempt-failure.json",
            "desktop.log",
            "attempt-records.json",
            "observed-events.json",
            "control-failure.json",
            "crash-start.json",
            "events.json",
            "before-crash.png",
          ];
      failedAssessment.evidence = [
        "attempt-failure.json",
        ...(
          await Promise.all(
            evidenceCandidates
              .filter((name) => name !== "attempt-failure.json")
              .map(async (name) =>
                (await stat(join(directory, name)).then(
                  () => true,
                  () => false,
                ))
                  ? name
                  : null,
              ),
          )
        ).filter(Boolean),
      ];
      await writeFile(
        join(directory, "assessment.json"),
        JSON.stringify(failedAssessment, null, 2) + "\n",
        { mode: 0o600 },
      );
      await writeFile(
        join(directory, "attempt-failure.json"),
        JSON.stringify(
          {
            sourceRevision,
            exitCode: code,
            launchError,
            limits,
            status: retained ? "contract_failed" : "failed_to_record",
            externalProviderConfigured:
              task !== "D03" && !usesLocalFixture(task),
            forensic,
            actualExternalCalls:
              "HTTP attempts are not established by logical steps",
            recordedLogicalModelSteps: retained?.completion?.modelSteps ?? null,
          },
          null,
          2,
        ) + "\n",
        { flag: "wx", mode: 0o600 },
      );
      throw new Error(
        `Pilot ${task} stopped (${code}); original attempt retained, see local evidence`,
      );
    }
    const result = JSON.parse(
      await readFile(join(directory, "pilot-result.json"), "utf8"),
    );
    if (task === "D03" || CONTROL_TASKS.includes(task)) {
      const assessment = JSON.parse(
        await readFile(join(directory, "assessment.json"), "utf8"),
      );
      assessment.status =
        task === "D03"
          ? "executed_admission_checked"
          : "executed_control_checked";
      assessment.evidence =
        task === "D03"
          ? ["pilot-result.json", "desktop.png"]
          : [
              "pilot-result.json",
              "desktop.png",
              "events.json",
              ...(task === "F05"
                ? ["crash-start.json", "before-crash.png"]
                : []),
            ];
      await writeFile(
        join(directory, "assessment.json"),
        JSON.stringify(assessment, null, 2) + "\n",
        { mode: 0o600 },
      );
      continue;
    }
    const finalizationEvents = [];
    for (const entry of await readdir(join(home, "runs"), {
      withFileTypes: true,
    })) {
      if (!entry.isFile() || !entry.name.endsWith(".jsonl")) continue;
      const lines = (await readFile(join(home, "runs", entry.name), "utf8"))
        .trim()
        .split("\n");
      const trace = lines.map((line) => JSON.parse(line));
      for (const record of trace)
        if (record.event?.type === "run.finalizing")
          finalizationEvents.push({
            runId: record.runId,
            ...record.event,
            modelRequestStarted: trace.some(
              (r) =>
                r.event?.type === "model.started" &&
                r.event.step === record.event.step,
            ),
          });
    }
    await writeFile(
      join(directory, "projection-observation.json"),
      `${JSON.stringify({ selected: finalizationInput, finalizationEvents }, null, 2)}\n`,
      { flag: "wx", mode: 0o600 },
    );
    let independent = { status: "not_applicable" };
    if (/^E0[1-6]$/.test(task) || task === "D02")
      independent = await checkProductEdit(task, workspace, home);
    await writeFile(
      join(directory, "independent-check.json"),
      JSON.stringify(independent, null, 2) + "\n",
      { flag: "wx", mode: 0o600 },
    );
    const assessment = JSON.parse(
      await readFile(join(directory, "assessment.json"), "utf8"),
    );
    assessment.status = "executed_pending_review";
    assessment.evidence = [
      "pilot-result.json",
      "events.json",
      "desktop.png",
      "independent-check.json",
    ];
    await writeFile(
      join(directory, "assessment.json"),
      JSON.stringify(assessment, null, 2) + "\n",
      { mode: 0o600 },
    );
    results.push({
      task,
      finalizationInput,
      ...(values["recover-summary"] && ["E01", "F03"].includes(task)
        ? {
            recovery: JSON.parse(
              await readFile(join(directory, "recovery-result.json"), "utf8"),
            ),
          }
        : {}),
      outcome: result.completion?.outcome,
      checks: result.checks,
      independent,
      limits,
      sourceRevision,
      assessment: "needs_review",
    });
    await writeFile(
      join(round, "pilot.json"),
      JSON.stringify(
        {
          round: manifest.round,
          model: manifest.primaryModel,
          results,
          remainingTasks: 24 - tasks.length,
          userTrial: false,
          fullBaselineComplete: false,
        },
        null,
        2,
      ) + "\n",
      { mode: 0o600 },
    );
    console.log(
      `Round ${manifest.round} / ${task}: ${result.completion?.outcome}; assertions ${independent.status}; evidence saved`,
    );
    // Credential/service failures stop the pilot instead of spending more requests.
    if (
      ["configuration_error", "disconnected"].includes(
        result.completion?.reason,
      ) ||
      ["provider-unavailable", "provider-rate-limited"].includes(
        result.completion?.message,
      )
    )
      throw new Error(
        "Provider unavailable for this pinned baseline; stopping further paid calls",
      );
  }
}
