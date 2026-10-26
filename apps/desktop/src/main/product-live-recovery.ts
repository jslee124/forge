import { randomUUID } from "node:crypto";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { BrowserWindow } from "electron";
import type { RunEvent } from "../shared/run-protocol.js";
import type { AgentProcess } from "./agent-process.js";

/** Explicit pilot-only review/summary flow; never an automatic product retry. */
export async function runPilotSummaryRecovery(options: {
  window: BrowserWindow;
  agent: AgentProcess;
  directory: string;
  sourceRunId: string;
  until: (condition: string) => Promise<void>;
  hashes: () => Promise<Record<string, string>>;
}) {
  const { window, agent, directory, sourceRunId, until, hashes } = options;
  const js = (code: string) => window.webContents.executeJavaScript(code);
  const before = await hashes();
  const events: RunEvent[] = [];
  let completed!: () => void;
  const done = new Promise<void>((resolve) => {
    completed = resolve;
  });
  const stop = agent.runs.subscribe((event) => {
    events.push(event);
    if (event.payload.type === "complete") completed();
  });
  let deadline: ReturnType<typeof setTimeout> | undefined;
  try {
    const draft = "Keep this next task draft";
    await js(
      `(()=>{const e=document.querySelector('.live-composer textarea');Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(e,${JSON.stringify(draft)});e.dispatchEvent(new Event('input',{bubbles:true}));})()`,
    );
    await until(
      "document.querySelector('[data-run-result=current] [data-recovery=summarize]:not(:disabled)')",
    );
    await js(
      "document.querySelector('[data-run-result=current] [data-recovery=summarize]').click()",
    );
    await until(
      "document.querySelector('dialog[open] .recovery-plan-metadata')",
    );
    if (events.length)
      throw new Error("Recovery began before explicit review confirmation");
    await writeFile(
      join(directory, "recovery-review.png"),
      (await window.webContents.capturePage()).toPNG(),
      { flag: "wx" },
    );
    await js(
      "document.querySelector('dialog .studio-confirmation-actions button:last-child').click()",
    );
    await Promise.race([
      done,
      new Promise((_, reject) => {
        deadline = setTimeout(() => {
          const event = events.at(-1);
          if (event)
            void agent.runs.request({
              type: "cancel",
              requestId: randomUUID(),
              runId: event.runId,
              sessionId: event.sessionId,
            });
          reject(new Error("Summary recovery wall-clock limit"));
        }, 90000);
      }),
    ]);
    await until(
      "document.querySelector('[data-run-result=current]') && !document.querySelector('[data-testid=composer-engine]').disabled",
    );
    const state = await agent.management.request({ type: "state" });
    const summary = state.runHistory?.selected?.summary;
    const after = await hashes();
    const completion = events.findLast(
      (e) => e.payload.type === "complete",
    )?.payload;
    const report = {
      sourceRunId,
      summary,
      completion,
      events,
      checks: {
        reviewedBeforeRun: true,
        linkedSource:
          summary?.recovery?.sourceRunId === sourceRunId &&
          summary?.recovery?.kind === "summarize",
        toolFree:
          completion?.type === "complete" &&
          completion.toolCalls === 0 &&
          !events.some(
            (e) =>
              e.payload.type === "approval" ||
              (e.payload.type === "action" &&
                e.payload.action.status === "running"),
          ),
        oneStep:
          completion?.type === "complete" &&
          (completion.modelSteps ?? Infinity) <= 1,
        draftPreserved:
          (await js(
            "document.querySelector('.live-composer textarea').value",
          )) === draft,
        workspaceUnchanged: JSON.stringify(before) === JSON.stringify(after),
      },
      answer: state.messages
        .filter((m) => m.role === "assistant" && m.kind !== "system-outcome")
        .at(-1)?.content,
      fixtureModel: false,
      userTrial: false,
      rubricStatus: "needs_review",
    };
    await writeFile(
      join(directory, "recovery-result.json"),
      `${JSON.stringify(report, null, 2)}\n`,
      { flag: "wx", mode: 0o600 },
    );
    await writeFile(
      join(directory, "recovery-summary.png"),
      (await window.webContents.capturePage()).toPNG(),
      { flag: "wx" },
    );
    if (Object.values(report.checks).some((value) => !value))
      throw new Error("Summary recovery contract failed; evidence retained");
  } finally {
    stop();
    if (deadline) clearTimeout(deadline);
  }
}
