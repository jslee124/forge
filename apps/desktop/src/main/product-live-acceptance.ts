import { createHash, randomUUID } from "node:crypto";
import { lstat, readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { BrowserWindow } from "electron";
import type { RunEvent } from "../shared/run-protocol.js";
import { acceptanceProvider } from "./acceptance-provider.js";
import type { AgentProcess } from "./agent-process.js";
import type { FileService } from "./file-service.js";
import { savePilotFailure } from "./product-attempt-evidence.js";
import {
  type PilotCancellation,
  pilotFaultChecks,
  recordedCommandFailureThenSuccess,
} from "./product-live-checks.js";
import { allowPilotApproval } from "./product-live-policy.js";
import { runPilotSummaryRecovery } from "./product-live-recovery.js";
import {
  CANCEL_FINISHED,
  CANCEL_STARTED,
  CONTROL_TASKS,
  EXTERNAL_EDIT_MARKER,
  PILOT_TASKS,
  pilotScenario,
  usesAutonomousRegression,
} from "./product-live-scenarios.js";
import {
  autonomousRegressionChecks,
  observeRegressionInputs,
  type RegressionObservation,
} from "./product-regression-checks.js";

/** Real provider pilot via the same renderer, preflight, Agent and run journal as normal Desktop. */
export async function runProductLivePilot(
  window: BrowserWindow,
  agent: AgentProcess,
  files: FileService,
) {
  const task = process.env["FORGE_PRODUCT_LIVE_TASK"];
  if ((CONTROL_TASKS as readonly string[]).includes(task ?? "")) {
    const { runProductControlPilot } = await import(
      "./product-control-acceptance.js"
    );
    return runProductControlPilot(window, agent, files);
  }
  const local = process.env["FORGE_PRODUCT_LIVE_FIXTURE"] === "1";
  if (!local || task === "D03") return runPilot(window, agent, files);
  if (!["D02", "D05", "D06"].includes(task ?? ""))
    throw new Error("Unsupported local fault fixture");
  const home = process.env["FORGE_PRODUCT_LIVE_HOME"];
  if (
    !home ||
    home !== process.env["FORGE_HOME"] ||
    process.env["FORGE_PRODUCT_LIVE_OPT_IN"] !== "1"
  )
    throw new Error("Fixture requires explicit isolated opt-in");
  const provider = await acceptanceProvider();
  provider.setMode(`fault-${task}` as "fault-D02" | "fault-D05" | "fault-D06");
  try {
    const config = JSON.parse(
      await readFile(join(home, "config.json"), "utf8"),
    );
    await writeFile(
      join(home, "config.json"),
      JSON.stringify({
        ...config,
        model: { engine: "forge", provider: "p4-fault", id: "scripted" },
        providers: {
          "p4-fault": {
            api: "openai-completions",
            baseUrl: provider.url,
            auth: { type: "none" },
            models: [{ id: "scripted" }],
          },
        },
      }),
      { mode: 0o600 },
    );
    return await runPilot(window, agent, files);
  } finally {
    await provider.close();
  }
}
async function runPilot(
  window: BrowserWindow,
  agent: AgentProcess,
  files: FileService,
) {
  const {
    FORGE_PRODUCT_LIVE_FINALIZATION_INPUT: finalizationInput = "continuation",
    FORGE_PRODUCT_LIVE_RECOVER_SUMMARY: recoverSummary,
    FORGE_PRODUCT_LIVE_LOCALE: locale = "zh-CN",
    FORGE_PRODUCT_LIVE_CANCEL_STAGE: cancelStage,
    FORGE_PRODUCT_LIVE_FAULT_PROTOCOL: faultProtocol,
  } = process.env;
  const home = process.env["FORGE_PRODUCT_LIVE_HOME"];
  const workspace = process.env["FORGE_PRODUCT_LIVE_WORKSPACE"];
  const task = process.env["FORGE_PRODUCT_LIVE_TASK"];
  if (
    !home ||
    home !== process.env["FORGE_HOME"] ||
    !workspace ||
    !task ||
    !["en", "zh-CN"].includes(locale) ||
    !(PILOT_TASKS as readonly string[]).includes(task) ||
    process.env["FORGE_PRODUCT_LIVE_OPT_IN"] !== "1"
  )
    throw new Error("Live pilot requires explicit isolated inputs and opt-in");
  const profile = process.env["FORGE_PRODUCT_LIVE_PROFILE"] ?? "bounded";
  const scenario = pilotScenario(task, cancelStage, faultProtocol, profile);
  const directory = join(workspace, "..");
  const assessment = JSON.parse(
    await readFile(join(directory, "assessment.json"), "utf8"),
  ) as { id: string; prompt: string };
  if (assessment.id !== task) throw new Error("Pilot task mismatch");
  const submittedPrompt = [assessment.prompt, scenario.supplement]
    .filter(Boolean)
    .join("\n\n");
  const js = (code: string) => window.webContents.executeJavaScript(code);
  const until = async (condition: string) => {
    try {
      await js(
        `new Promise((resolve,reject)=>{const deadline=Date.now()+15000;const poll=()=>{if(${condition})resolve(true);else if(Date.now()>deadline)reject(new Error('Pilot UI timeout'));else setTimeout(poll,50);};poll();})`,
      );
    } catch (cause) {
      await writeFile(
        join(directory, "infrastructure-error.json"),
        JSON.stringify(
          {
            condition,
            ui: await js(
              "({text:document.body.innerText.slice(0,12000),url:location.href,workspace:document.querySelector('.studio-workspace-button')?.title})",
            ),
          },
          null,
          2,
        ) + "\n",
        { mode: 0o600 },
      );
      await writeFile(
        join(directory, "infrastructure-error.png"),
        (await window.webContents.capturePage()).toPNG(),
      );
      throw cause;
    }
  };
  const hashes = async () => {
    const result: Record<string, string> = {};
    const walk = async (path: string, prefix = "") => {
      for (const entry of await readdir(path, { withFileTypes: true })) {
        const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
        if (entry.isDirectory()) await walk(join(path, entry.name), relative);
        else if (entry.isFile())
          result[relative] = createHash("sha256")
            .update(await readFile(join(path, entry.name)))
            .digest("hex");
        else throw new Error("Pilot workspace contains a nonregular entry");
      }
    };
    await walk(workspace);
    return result;
  };
  const before = await hashes();
  const selected = await agent.management.request({
    type: "workspace",
    cwd: workspace,
  });
  await files.setWorkspace(workspace);
  window.webContents.reload();
  await until(
    `document.querySelector('.studio-workspace-button')?.title === ${JSON.stringify(selected.cwd)} && document.querySelector('.live-composer textarea') && !document.querySelector('[data-testid=composer-engine]').disabled`,
  );
  await js("document.querySelector('[data-testid=settings]').click()");
  await until("document.querySelector('[data-testid=language]')");
  await js(
    `(()=>{const e=document.querySelector('[data-testid=language]');Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype,'value').set.call(e,${JSON.stringify(locale)});e.dispatchEvent(new Event('change',{bubbles:true}));})()`,
  );
  await until(`document.documentElement.lang === ${JSON.stringify(locale)}`);
  await js("document.querySelector('.studio-back').click()");
  await until("document.querySelector('.live-composer textarea')");
  if (task === "D03") {
    const prior = await agent.management.request({ type: "state" });
    await js(
      `(()=>{const e=document.querySelector('.live-composer textarea');Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(e,${JSON.stringify(submittedPrompt)});e.dispatchEvent(new Event('input',{bubbles:true}));})()`,
    );
    await until(
      "!document.querySelector('.studio-composer-footer > button:last-child').disabled",
    );
    await js(
      "document.querySelector('.studio-composer-footer > button:last-child').click()",
    );
    await until("document.querySelector('[data-testid=setup-required]')");
    const current = await agent.management.request({ type: "state" });
    const traces = await readdir(join(home, "runs")).catch(
      (error: NodeJS.ErrnoException) => {
        if (error.code !== "ENOENT") throw error;
        return [];
      },
    );
    const checks = {
      admissionBlocked: true,
      noSessionCreated: current.sessions.length === prior.sessions.length,
      noRunCreated: !current.runHistory?.selected,
      noProviderTrace: traces.length === 0,
      draftPreserved: await js(
        `document.querySelector('.live-composer textarea').value===${JSON.stringify(submittedPrompt)}`,
      ),
    };
    await js(
      "document.querySelector('[data-testid=setup-required] button').click()",
    );
    await until("document.querySelector('#settings-credentials')");
    await writeFile(
      join(directory, "desktop.png"),
      (await window.webContents.capturePage()).toPNG(),
      { flag: "wx" },
    );
    await writeFile(
      join(directory, "pilot-result.json"),
      JSON.stringify(
        {
          schemaVersion: 1,
          task,
          scenario,
          originalPrompt: assessment.prompt,
          submittedPrompt,
          admission: { blocked: true, settingsReachable: true },
          completion: null,
          checks,
          providerCalls: 0,
          modelInvoked: false,
          uiRendered: true,
          userTrial: false,
        },
        null,
        2,
      ) + "\n",
      { flag: "wx", mode: 0o600 },
    );
    if (Object.values(checks).some((value) => !value))
      throw new Error("Missing-model admission contract failed");
    return;
  }
  const events: RunEvent[] = [];
  const decisions: {
    approvalId: string;
    actionId?: string;
    allow: boolean;
    reason: string;
  }[] = [];
  const controlJobs: Promise<void>[] = [];
  const controlErrors: string[] = [];
  const regressionObservations: RegressionObservation[] = [];
  const cancellation: PilotCancellation | undefined =
    task === "F02" ? { stage: cancelStage as "model" | "command" } : undefined;
  let externalEdit:
    | { actionId?: string; beforeSha256: string; afterSha256: string }
    | undefined;
  let stopScheduled = false;
  const scheduleStop = () => {
    if (stopScheduled || !cancellation) return;
    stopScheduled = true;
    const job = (async () => {
      if (cancellation.stage === "command") {
        const end = Date.now() + 5000;
        while (true) {
          try {
            const marker = JSON.parse(
              await readFile(join(workspace, CANCEL_STARTED), "utf8"),
            ) as { pid?: unknown };
            if (
              typeof marker.pid !== "number" ||
              !Number.isSafeInteger(marker.pid) ||
              marker.pid <= 1
            )
              throw new Error("Invalid probe PID");
            process.kill(marker.pid, 0);
            cancellation.pid = marker.pid;
            break;
          } catch (cause) {
            if (
              (cause as NodeJS.ErrnoException).code !== "ENOENT" ||
              Date.now() > end
            )
              throw cause;
            await new Promise((resolve) => setTimeout(resolve, 20));
          }
        }
      }
      await until(
        `document.querySelector('.studio-composer-footer > button:last-child:not(:disabled)')?.getAttribute('aria-label') === ${JSON.stringify(locale === "zh-CN" ? "停止" : "Stop")}`,
      );
      await writeFile(
        join(directory, "before-stop.png"),
        (await window.webContents.capturePage()).toPNG(),
        { flag: "wx" },
      );
      const sequence = events.at(-1)?.sequence;
      if (sequence === undefined) throw new Error("No event at cancellation");
      cancellation.sequence = sequence;
      cancellation.requestedAt = Date.now();
      await js(
        "document.querySelector('.studio-composer-footer > button:last-child').click()",
      );
    })().catch((cause) => {
      controlErrors.push(String(cause));
    });
    controlJobs.push(job);
  };
  let cancelTimer: ReturnType<typeof setTimeout> | undefined;
  let finished!: () => void;
  const done = new Promise<void>((resolve) => {
    finished = resolve;
  });
  const stop = agent.runs.subscribe((event) => {
    events.push(event);
    if (event.payload.type === "approval") {
      const approval = event.payload;
      const allow = allowPilotApproval(
        task,
        approval,
        cancelStage,
        faultProtocol,
      );
      const decisionIndex = decisions.length + 1;
      decisions.push({
        approvalId: approval.approvalId,
        ...(approval.descriptor?.actionId
          ? { actionId: approval.descriptor?.actionId }
          : {}),
        allow,
        reason: "fixed pilot task/path/process allowlist",
      });
      controlJobs.push(
        (async () => {
          if (
            usesAutonomousRegression(task, faultProtocol) &&
            allow &&
            approval.descriptor?.effect === "process"
          ) {
            regressionObservations.push(
              await observeRegressionInputs(
                workspace,
                approval.descriptor.actionId,
                event.sequence,
              ),
            );
          }
          if (
            task === "D05" &&
            allow &&
            approval.descriptor?.effect === "write" &&
            !externalEdit
          ) {
            const path = join(workspace, "workflow.mjs");
            const content = await readFile(path, "utf8");
            const changed = `${content}\n${EXTERNAL_EDIT_MARKER}\n`;
            externalEdit = {
              actionId: approval.descriptor.actionId,
              beforeSha256: createHash("sha256").update(content).digest("hex"),
              afterSha256: createHash("sha256").update(changed).digest("hex"),
            };
            await writeFile(path, changed);
          }
          const selector = `.run-approval footer button:${allow ? "last" : "first"}-of-type`;
          await until(
            `document.querySelector(${JSON.stringify(selector)}) && !document.querySelector(${JSON.stringify(selector)}).disabled`,
          );
          await writeFile(
            join(directory, `approval-${decisionIndex}.png`),
            (await window.webContents.capturePage()).toPNG(),
            { flag: "wx" },
          );
          await js(
            `document.querySelector(${JSON.stringify(selector)}).click()`,
          );
        })().catch((cause) => {
          controlErrors.push(String(cause));
        }),
      );
    }
    if (!cancelTimer)
      cancelTimer = setTimeout(() => {
        void agent.runs.request({
          type: "cancel",
          requestId: randomUUID(),
          runId: event.runId,
          sessionId: event.sessionId,
        });
      }, 150_000);
    if (
      task === "F02" &&
      cancelStage === "model" &&
      ((event.payload.type === "detail" &&
        event.payload.kind === "reasoning" &&
        event.payload.text.trim()) ||
        (event.payload.type === "text" && event.payload.text.trim()))
    )
      scheduleStop();
    if (
      task === "F02" &&
      cancelStage === "command" &&
      event.payload.type === "action" &&
      event.payload.action.tool === "run_command" &&
      event.payload.action.status === "running"
    )
      scheduleStop();
    if (event.payload.type === "complete") {
      if (cancellation) cancellation.completedAt = Date.now();
      finished();
    }
  });
  let deadline: ReturnType<typeof setTimeout> | undefined;
  try {
    await js(
      `(()=>{const e=document.querySelector('.live-composer textarea');Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(e,${JSON.stringify(submittedPrompt)});e.dispatchEvent(new Event('input',{bubbles:true}));})()`,
    );
    await until(
      "!document.querySelector('.studio-composer-footer > button:last-child').disabled",
    );
    await js(
      "document.querySelector('.studio-composer-footer > button:last-child').click()",
    );
    await until(
      "document.querySelector('.run-navigation') || document.querySelector('[data-run-result=current]') || document.querySelector('[data-testid=setup-required]') || document.querySelector('.field-error')",
    );
    if (
      await js(
        "Boolean(document.querySelector('[data-testid=setup-required],.field-error'))",
      )
    )
      throw new Error("Live pilot admission failed; no request retried");
    await Promise.race([
      done,
      new Promise((_, reject) => {
        deadline = setTimeout(
          () => reject(new Error("Pilot wall-clock limit")),
          profile === "product-defaults" ? 600_000 : 175_000,
        );
      }),
    ]);
    await until(
      "document.querySelector('[data-run-result=current]') && !document.querySelector('[data-testid=composer-engine]').disabled",
    );
    await Promise.all(controlJobs);
    if (cancellation?.stage === "command" && cancellation.pid) {
      try {
        process.kill(cancellation.pid, 0);
        cancellation.pidExited = false;
      } catch (cause) {
        cancellation.pidExited =
          (cause as NodeJS.ErrnoException).code === "ESRCH";
      }
      cancellation.finishedMarkerAbsent = await lstat(
        join(workspace, CANCEL_FINISHED),
      ).then(
        () => false,
        (cause: NodeJS.ErrnoException) => cause.code === "ENOENT",
      );
    }
    const current = await agent.management.request({ type: "state" });
    const answer = current.messages
      .filter((m) => m.role === "assistant" && m.kind !== "system-outcome")
      .map((m) => m.content)
      .join("\n");
    const completion = events.findLast(
      (e) => e.payload.type === "complete",
    )?.payload;
    await js(
      "document.fonts.ready.then(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))))",
    );
    if (
      ["D01", "D02", "D06"].includes(task) &&
      (current.runHistory?.selected?.delivery?.commands.length ?? 0) > 0
    ) {
      await until("document.querySelector('.run-delivery')");
      await js(
        "document.querySelector('.run-delivery').open=true;document.querySelector('.run-delivery-commands').scrollIntoView({block:'nearest'})",
      );
    }
    await js(
      "new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))",
    );
    if (
      ["D01", "D02", "D06"].includes(task) &&
      (current.runHistory?.selected?.delivery?.commands.length ?? 0) > 0
    )
      await until(
        "document.querySelector('.run-delivery').open && document.querySelector('.run-delivery-commands li').getBoundingClientRect().height>0",
      );
    await writeFile(
      join(directory, "desktop.png"),
      (await window.webContents.capturePage()).toPNG(),
    );
    const after = await hashes();
    const changed = [
      ...new Set([...Object.keys(before), ...Object.keys(after)]),
    ].filter((path) => before[path] !== after[path]);
    const lastPhase = events.findIndex(
      (e) => e.payload.type === "phase" && e.payload.phase === "finalizing",
    );
    const report = {
      schemaVersion: 1,
      task,
      scenario,
      executionProfile: profile,
      originalPrompt: assessment.prompt,
      submittedPrompt,
      cancellation,
      externalEdit,
      regressionObservations,
      recorded: current.runHistory?.selected,
      controlErrors,
      finalizationInput: finalizationInput,
      observedAt: new Date().toISOString(),
      faultProtocol: faultProtocol ?? null,
      providerCalls:
        process.env["FORGE_PRODUCT_LIVE_FIXTURE"] === "1"
          ? "local scripted transport; no external model"
          : "real external DeepSeek API; logical steps recorded, HTTP attempts/retries and billing not measured",
      model:
        process.env["FORGE_PRODUCT_LIVE_FIXTURE"] === "1"
          ? { engine: "forge", provider: "p4-fault", id: "scripted" }
          : {
              engine: "forge",
              provider: "deepseek",
              id: "deepseek-flash",
              reasoningEffort: "high",
            },
      completion,
      answer,
      decisions,
      changedFiles: changed,
      before,
      after,
      checks: {
        readOnlyPreserved:
          scenario.expectedWrites.length > 0 ? null : changed.length === 0,
        expectedEffectScope: changed.every((path) =>
          scenario.expectedWrites.includes(path),
        ),
        uiControlsSucceeded: controlErrors.length === 0,
        ...(usesAutonomousRegression(task, faultProtocol)
          ? {
              ...autonomousRegressionChecks(
                events,
                regressionObservations,
                before["workflow.mjs"],
                after["workflow.mjs"],
                after["regression.test.mjs"],
              ),
              regressionTestCreated:
                !before["regression.test.mjs"] &&
                Boolean(after["regression.test.mjs"]),
              originalTestsPreserved:
                before["fixture.test.mjs"] === after["fixture.test.mjs"],
            }
          : {}),
        pathTestsPreserved:
          task === "E04" && faultProtocol === "desktop-product-faults-v2"
            ? Boolean(before["path.test.mjs"]) &&
              before["path.test.mjs"] === after["path.test.mjs"]
            : null,
        pathFailureThenSuccess:
          task === "E04" && faultProtocol === "desktop-product-faults-v2"
            ? recordedCommandFailureThenSuccess(events, "node", [
                "--test",
                "path.test.mjs",
              ])
            : null,
        ...pilotFaultChecks(task, events, cancellation),
        mockTestsPreserved:
          task === "D02"
            ? before["mock.test.mjs"] === after["mock.test.mjs"] &&
              before["mock-implementation.mjs"] ===
                after["mock-implementation.mjs"]
            : null,
        mockFailureThenSuccess:
          task === "D02"
            ? [1, 0].every((code) =>
                events.some(
                  (e) =>
                    e.payload.type === "action" &&
                    e.payload.action.facts?.kind === "command" &&
                    e.payload.action.facts.exitCode === code,
                ),
              )
            : null,
        externalEditTriggered: task === "D05" ? Boolean(externalEdit) : null,
        staleRewriteRejected:
          task === "D05"
            ? events.some(
                (e) =>
                  e.payload.type === "action" &&
                  e.payload.action.actionId === externalEdit?.actionId &&
                  e.payload.action.output &&
                  (() => {
                    try {
                      return (
                        JSON.parse(e.payload.action.output).error?.code ===
                        "stale_file"
                      );
                    } catch {
                      return false;
                    }
                  })(),
              )
            : null,
        externalEditPreserved:
          task === "D05"
            ? (
                await readFile(join(workspace, "workflow.mjs"), "utf8")
              ).includes(EXTERNAL_EDIT_MARKER)
            : null,
        rereadAfterStale:
          task === "D05"
            ? await rereadAfterStale(home, externalEdit?.actionId)
            : null,
        cancelledCommandEffectsUnknown:
          cancellation?.stage === "command"
            ? Boolean(
                current.runHistory?.selected?.delivery?.unresolved.some(
                  (entry) =>
                    entry.tool === "run_command" && entry.status === "unknown",
                ),
              )
            : null,
        portEditScope:
          task === "E01"
            ? changed.every((path) => path === "workflow.mjs")
            : null,
        requestPathReferences:
          task === "Q02"
            ? [
                "main.mjs",
                "workflow.mjs",
                "receive",
                "handle",
                "dispatch",
              ].every((name) => answer.includes(name))
            : null,
        budgetFinalized:
          task === "F03"
            ? completion?.type === "complete" &&
              completion.outcome === "limit_reached" &&
              (completion.modelSteps ?? Infinity) <= 2 &&
              lastPhase >= 0 &&
              !events
                .slice(lastPhase)
                .some(
                  (e) =>
                    e.payload.type === "action" &&
                    e.payload.action.status === "running",
                )
            : null,
      },
      rubricStatus: "needs_review",
      userTrial: false,
      fixtureModel: process.env["FORGE_PRODUCT_LIVE_FIXTURE"] === "1",
      uiRendered: true,
    };
    await writeFile(
      join(directory, "pilot-result.json"),
      JSON.stringify(report, null, 2) + "\n",
      { flag: "wx", mode: 0o600 },
    );
    await writeFile(
      join(directory, "events.json"),
      JSON.stringify(events, null, 2) + "\n",
      { flag: "wx", mode: 0o600 },
    );
    console.log(
      `Live pilot ${task}: ${completion?.type === "complete" ? completion.outcome : "unknown"}; evidence recorded`,
    );
    if (
      ["D01", "D02", "D05", "D06", "F01", "F02"].includes(task) &&
      Object.values(report.checks).some((value) => value === false)
    )
      throw new Error(
        "Pilot fault contract not satisfied; original evidence retained",
      );
    if (["E01", "F03"].includes(task) && recoverSummary === "1") {
      stop();
      if (cancelTimer) clearTimeout(cancelTimer);
      if (deadline) clearTimeout(deadline);
      const sourceRunId = events.findLast(
        (e) => e.payload.type === "complete",
      )?.runId;
      if (!sourceRunId) throw new Error("Missing source run for recovery");
      await runPilotSummaryRecovery({
        window,
        agent,
        directory,
        sourceRunId,
        until,
        hashes,
      });
    }
  } catch (cause) {
    const saved = await savePilotFailure(directory, {
      task,
      error: String(cause),
      events,
      decisions,
      controlErrors,
      cancellation,
      externalEdit,
    });
    try {
      await writeFile(
        join(directory, "failure.png"),
        (await window.webContents.capturePage()).toPNG(),
        { flag: "wx" },
      );
    } catch {
      /* The window itself may have disconnected; journal/host observations remain separate. */
    }
    console.error("Pilot failure observations", saved);
    throw cause;
  } finally {
    stop();
    if (cancelTimer) clearTimeout(cancelTimer);
    if (deadline) clearTimeout(deadline);
  }
  // No second attempt or implicit recovery; explicit pilot summary uses a separate record.
  if (!(await lstat(join(directory, "pilot-result.json"))).isFile())
    throw new Error("Missing pilot evidence");
}

async function rereadAfterStale(
  home: string,
  actionId?: string,
): Promise<boolean> {
  if (!actionId) return false;
  for (const name of await readdir(join(home, "runs"))) {
    if (!name.endsWith(".jsonl")) continue;
    const records = (await readFile(join(home, "runs", name), "utf8"))
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));
    const rejected = records.findIndex(
      (r) =>
        r.event.type === "tool.failed" &&
        r.event.call?.id === actionId &&
        r.event.result?.error?.code === "stale_file",
    );
    if (
      rejected >= 0 &&
      records
        .slice(rejected + 1)
        .some(
          (r) =>
            r.event.type === "tool.completed" &&
            r.event.call?.name === "read_file" &&
            r.event.call.input?.path === "workflow.mjs" &&
            r.event.result?.ok === true &&
            r.event.result.output?.rewriteAvailable === true,
        )
    )
      return true;
  }
  return false;
}
