import { createHash, randomUUID } from "node:crypto";
import { lstat, readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { BrowserWindow } from "electron";
import type { RunEvent } from "../shared/run-protocol.js";
import type { AgentProcess } from "./agent-process.js";
import type { FileService } from "./file-service.js";
import { allowPilotApproval } from "./product-live-policy.js";
import { runPilotSummaryRecovery } from "./product-live-recovery.js";

/** Real provider pilot via the same renderer, preflight, Agent and run journal as normal Desktop. */
export async function runProductLivePilot(
  window: BrowserWindow,
  agent: AgentProcess,
  files: FileService,
) {
  const {
    FORGE_PRODUCT_LIVE_FINALIZATION_INPUT: finalizationInput = "continuation",
    FORGE_PRODUCT_LIVE_RECOVER_SUMMARY: recoverSummary,
  } = process.env;
  const home = process.env["FORGE_PRODUCT_LIVE_HOME"];
  const workspace = process.env["FORGE_PRODUCT_LIVE_WORKSPACE"];
  const task = process.env["FORGE_PRODUCT_LIVE_TASK"];
  if (
    !home ||
    home !== process.env["FORGE_HOME"] ||
    !workspace ||
    !task ||
    !["Q02", "Q05", "Q06", "E01", "F03"].includes(task) ||
    process.env["FORGE_PRODUCT_LIVE_OPT_IN"] !== "1"
  )
    throw new Error("Live pilot requires explicit isolated inputs and opt-in");
  const directory = join(workspace, "..");
  const assessment = JSON.parse(
    await readFile(join(directory, "assessment.json"), "utf8"),
  ) as { id: string; prompt: string };
  if (assessment.id !== task) throw new Error("Pilot task mismatch");
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
  const events: RunEvent[] = [];
  const decisions: { actionId?: string; allow: boolean; reason: string }[] = [];
  let cancelTimer: ReturnType<typeof setTimeout> | undefined;
  let finished!: () => void;
  const done = new Promise<void>((resolve) => {
    finished = resolve;
  });
  const stop = agent.runs.subscribe((event) => {
    events.push(event);
    if (event.payload.type === "approval") {
      const approval = event.payload;
      const allow = allowPilotApproval(task, approval);
      decisions.push({
        ...(approval.descriptor?.actionId
          ? { actionId: approval.descriptor?.actionId }
          : {}),
        allow,
        reason: "fixed pilot task/path/process allowlist",
      });
      void agent.runs.request({
        type: "approve",
        requestId: randomUUID(),
        runId: event.runId,
        sessionId: event.sessionId,
        approvalId: approval.approvalId,
        allow,
        ...(approval.descriptor?.actionId
          ? { actionId: approval.descriptor?.actionId }
          : {}),
      });
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
    if (event.payload.type === "complete") finished();
  });
  let deadline: ReturnType<typeof setTimeout> | undefined;
  try {
    await js(
      `(()=>{const e=document.querySelector('.live-composer textarea');Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(e,${JSON.stringify(assessment.prompt)});e.dispatchEvent(new Event('input',{bubbles:true}));})()`,
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
          175_000,
        );
      }),
    ]);
    await until(
      "document.querySelector('[data-run-result=current]') && !document.querySelector('[data-testid=composer-engine]').disabled",
    );
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
      finalizationInput: finalizationInput,
      observedAt: new Date().toISOString(),
      providerCalls:
        "real external DeepSeek API; count bounded by recorded model steps",
      model: {
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
        readOnlyPreserved: task === "E01" ? null : changed.length === 0,
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
      fixtureModel: false,
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
  } finally {
    stop();
    if (cancelTimer) clearTimeout(cancelTimer);
    if (deadline) clearTimeout(deadline);
  }
  // No second attempt or implicit recovery; explicit pilot summary uses a separate record.
  if (!(await lstat(join(directory, "pilot-result.json"))).isFile())
    throw new Error("Missing pilot evidence");
}
