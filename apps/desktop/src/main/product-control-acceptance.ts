import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { join } from "node:path";
import type { BrowserWindow } from "electron";
import type { RunEvent } from "../shared/run-protocol.js";
import type { AgentProcess } from "./agent-process.js";
import type { FileService } from "./file-service.js";
import { savePilotFailure } from "./product-attempt-evidence.js";
import {
  blockControlJournal,
  changedPaths,
  commandPid,
  waitFor,
  waitForPidExit,
  workspaceHashes,
} from "./product-control-faults.js";
import { controlStressEvents } from "./product-control-stream.js";
import {
  CANCEL_COMMAND,
  CANCEL_FINISHED,
  CANCEL_STARTED,
} from "./product-live-scenarios.js";

/** Host-injected faults, loopback only. No model capability/quality claims. */
export async function runProductControlPilot(
  window: BrowserWindow,
  agent: AgentProcess,
  files: FileService,
) {
  const {
    FORGE_HOME: home,
    FORGE_PRODUCT_LIVE_HOME: isolated,
    FORGE_PRODUCT_LIVE_WORKSPACE: workspace,
    FORGE_PRODUCT_LIVE_TASK: task,
  } = process.env;
  if (
    !home ||
    home !== isolated ||
    !workspace ||
    !task ||
    !["F04", "F05", "F06"].includes(task ?? "") ||
    process.env["FORGE_PRODUCT_LIVE_OPT_IN"] !== "1" ||
    process.env["FORGE_PRODUCT_LIVE_FIXTURE"] !== "1"
  )
    throw new Error("Control faults require explicit isolated local fixture");
  const directory = join(workspace, "..");
  const assessment = JSON.parse(
    await readFile(join(directory, "assessment.json"), "utf8"),
  ) as { id: string; prompt: string };
  if (assessment.id !== task) throw new Error("Control task mismatch");
  const js = (source: string) => window.webContents.executeJavaScript(source);
  const until = (expression: string) =>
    js(
      `new Promise((resolve,reject)=>{const end=Date.now()+15000;const poll=()=>{if(${expression})resolve(true);else if(Date.now()>end)reject(new Error('Control UI timeout: '+${JSON.stringify(expression)}));else setTimeout(poll,40)};poll()})`,
    );
  const click = async (selector: string) => {
    await until(
      `document.querySelector(${JSON.stringify(selector)}) && !document.querySelector(${JSON.stringify(selector)}).disabled`,
    );
    await js(`document.querySelector(${JSON.stringify(selector)}).click()`);
  };
  const capture = async (name: string) => {
    await js(
      "document.fonts.ready.then(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))))",
    );
    await writeFile(
      join(directory, `${name}.png`),
      (await window.webContents.capturePage()).toPNG(),
      { flag: "wx" },
    );
  };
  const reload = async () => {
    const loaded = new Promise<void>((resolve) =>
      window.webContents.once("did-finish-load", () => resolve()),
    );
    window.webContents.reload();
    await loaded;
    await until(
      "document.querySelector('.live-composer textarea') && !document.querySelector('[data-testid=composer-engine]').disabled",
    );
    await click("[data-testid=settings]");
    await click(".settings-nav button:first-child");
    await until("document.querySelector('[data-testid=language]')");
    const locale = process.env["FORGE_PRODUCT_LIVE_LOCALE"] ?? "zh-CN";
    await js(
      `(()=>{const e=document.querySelector('[data-testid=language]');Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype,'value').set.call(e,${JSON.stringify(locale)});e.dispatchEvent(new Event('change',{bubbles:true}));})()`,
    );
    await until(`document.documentElement.lang===${JSON.stringify(locale)}`);
    await click(".studio-back");
  };
  const events: RunEvent[] = [];
  const controlErrors: string[] = [];
  const jobs: Promise<void>[] = [];
  let pid: number | undefined;
  let blocked: Awaited<ReturnType<typeof blockControlJournal>> | undefined;
  let server: ReturnType<typeof createServer> | undefined;
  let unsubscribe: (() => void) | undefined;
  let providerCalls = 0;
  let fragmentsWritten = 0;
  const checks: Record<string, boolean> = {};
  try {
    if (
      task === "F05" &&
      process.env["FORGE_PRODUCT_CONTROL_PHASE"] === "reopen"
    ) {
      const prior = JSON.parse(
        await readFile(join(directory, "crash-start.json"), "utf8"),
      );
      const trace = join(home, "runs", `${prior.runId}.jsonl`);
      const traceBefore = createHash("sha256")
        .update(await readFile(trace))
        .digest("hex");
      const before = await workspaceHashes(workspace);
      await agent.management.request({
        type: "resume",
        sessionId: prior.sessionId,
      });
      const state = await agent.management.request({
        type: "run-history",
        runId: prior.runId,
      });
      await reload();
      const originalPrompt = state.runHistory?.selected?.summary.prompt ?? "";
      const title = originalPrompt
        .split(/\r?\n/u)
        .find((line) => line.trim())
        ?.trim()
        .slice(0, 80);
      checks["retainedTaskTitle"] =
        Boolean(title) &&
        (await js(
          `document.querySelector('.studio-task-title')?.textContent===${JSON.stringify(title)} && [...document.querySelectorAll('.live-sessions [data-session-id]')].some(e=>e.textContent.includes(${JSON.stringify(title)}))`,
        ));
      checks["retainedRequestVisible"] = await js(
        `document.querySelector('.retained-task-prompt')?.textContent===${JSON.stringify(originalPrompt)} && !document.querySelector('.studio-welcome')`,
      );
      if (await js("Boolean(document.querySelector('.live-panel'))"))
        await click(".studio-panel-toggle");
      await capture("retained-task");
      const { width, height } = window.getBounds();
      window.setSize(840, 728);
      await capture("retained-task-narrow");
      checks["retainedEntryFitsNarrowWindow"] = await js(
        "(()=>{const e=document.querySelector('.retained-task'); const b=e?.querySelector('button')?.getBoundingClientRect();return Boolean(e && e.scrollWidth<=e.clientWidth+1 && b && b.left>=0 && b.right<=innerWidth)})()",
      );
      window.setSize(width, height);
      await click(".retained-task button");
      await until(
        "document.querySelector('.studio-panel-body:not([hidden]) .run-history-selected .run-activity')?.getBoundingClientRect().height>0",
      );
      checks["interruptedAfterReopen"] =
        state.runHistory?.selected?.summary.completion?.outcome ===
        "interrupted";
      checks["unknownEffects"] = Boolean(
        state.runHistory?.selected?.delivery?.unresolved.some(
          (entry) => entry.tool === "run_command" && entry.status === "unknown",
        ),
      );
      checks["noRestoredGrants"] = state.permissionGrants?.length === 0;
      checks["noExecutableOldApproval"] = !(await js(
        "Boolean(document.querySelector('.run-approval'))",
      ));
      checks["noModelReplay"] =
        createHash("sha256")
          .update(await readFile(trace))
          .digest("hex") === traceBefore && traceBefore === prior.traceSha256;
      checks["noEffectReplay"] =
        JSON.stringify(await workspaceHashes(workspace)) ===
        JSON.stringify(before);
      checks["ownedCommandExited"] = prior.ownedCommandExited === true;
      checks["unfinishedAtCrash"] =
        prior.summaryAtCrash.state === "running" &&
        !prior.summaryAtCrash.completion;
      checks["existingFilesPreserved"] = Object.keys(prior.before).every(
        (path) =>
          prior.after[path] === prior.before[path] &&
          before[path] === prior.before[path],
      );
      checks["initialEffectScope"] = changedPaths(
        prior.before,
        prior.after,
      ).every((path) => path === CANCEL_STARTED);
      await capture("desktop");
      await writeFile(
        join(directory, "pilot-result.json"),
        JSON.stringify(
          {
            schemaVersion: 1,
            task,
            fixtureModel: true,
            providerCalls: prior.providerCalls,
            model: {
              engine: "forge",
              provider: "control-fixture",
              id: "scripted",
            },
            completion: null,
            controlReview: {
              kind: "crash-reopen",
              checked: true,
              originalCompletionNotFabricated: true,
            },
            checks,
            recorded: state.runHistory?.selected,
            originalPrompt: assessment.prompt,
            reopenProcess: true,
            userTrial: false,
          },
          null,
          2,
        ) + "\n",
        { flag: "wx", mode: 0o600 },
      );
      if (Object.values(checks).some((value) => !value))
        throw new Error("Crash/reopen control contract failed");
      return;
    }
    // The sentinel belongs to this isolated fixture; it tests preservation of existing files.
    await writeFile(
      join(workspace, "control-existing.txt"),
      "must survive the injected fault\n",
      { flag: "wx" },
    );
    const before = await workspaceHashes(workspace);
    let finish!: (event: RunEvent) => void;
    const completed = new Promise<RunEvent>((resolve) => {
      finish = resolve;
    });
    let releaseApproval!: (event: RunEvent) => void;
    const approval = new Promise<RunEvent>((resolve) => {
      releaseApproval = resolve;
    });
    let crashScheduled = false;
    unsubscribe = agent.runs.subscribe((event) => {
      events.push(event);
      if (event.payload.type === "approval") releaseApproval(event);
      if (event.payload.type === "complete") finish(event);
      if (
        task === "F05" &&
        !crashScheduled &&
        event.payload.type === "action" &&
        event.payload.action.status === "running"
      ) {
        crashScheduled = true;
        jobs.push(
          (async () => {
            pid = await commandPid(workspace, CANCEL_STARTED);
            const health = await agent.ping();
            if (
              !Number.isSafeInteger(health.pid) ||
              health.pid <= 1 ||
              health.pid === pid ||
              health.pid === process.pid
            )
              throw new Error("Invalid owned utility PID");
            await capture("before-crash");
            process.kill(health.pid, "SIGKILL");
          })().catch((error) => {
            controlErrors.push(String(error));
          }),
        );
      }
    });
    const controlServer = createServer(async (request, response) => {
      try {
        providerCalls++;
        // Consume the request but never send it outside loopback.
        for await (const _chunk of request) {
          /* drain */
        }
        if (providerCalls > 1)
          throw new Error("Unexpected second scripted model request");
        if (task === "F06") {
          const identity = await waitFor(
            async () => events[0],
            "run identity before journal injection",
          );
          blocked = await blockControlJournal(
            home,
            identity.sessionId,
            identity.runId,
          );
        }
        response.writeHead(200, {
          "content-type": "text/event-stream",
          "cache-control": "no-cache",
        });
        if (task === "F04") {
          for (const event of controlStressEvents()) {
            response.write(`data: ${JSON.stringify(event)}\n\n`);
            if (event.type === "response.reasoning_summary_text.delta")
              fragmentsWritten++;
          }
          response.end("data: [DONE]\n\n");
          return;
        }
        const send = (delta: unknown, finish_reason: string | null = null) =>
          response.write(
            `data: ${JSON.stringify({ id: "control-fixture", object: "chat.completion.chunk", created: 1, model: "scripted", choices: [{ index: 0, delta, finish_reason }] })}\n\n`,
          );
        send({ role: "assistant" });
        send({
          tool_calls: [
            {
              index: 0,
              id: "owned-control-command",
              type: "function",
              function: {
                name: "run_command",
                arguments: JSON.stringify({
                  program: "node",
                  args: ["-e", CANCEL_COMMAND],
                  cwd: ".",
                }),
              },
            },
          ],
        });
        send({}, "tool_calls");
        response.end("data: [DONE]\n\n");
      } catch (error) {
        controlErrors.push(String(error));
        response.destroy();
      }
    });
    server = controlServer;
    await new Promise<void>((resolve, reject) => {
      controlServer.once("error", reject);
      controlServer.listen(0, "127.0.0.1", resolve);
    });
    const address = controlServer.address();
    if (!address || typeof address === "string")
      throw new Error("Missing control fixture port");
    const config = JSON.parse(
      await readFile(join(home, "config.json"), "utf8"),
    );
    await writeFile(
      join(home, "config.json"),
      JSON.stringify({
        ...config,
        model: { engine: "forge", provider: "control-fixture", id: "scripted" },
        providers: {
          "control-fixture": {
            api: task === "F04" ? "openai-responses" : "openai-completions",
            baseUrl: `http://127.0.0.1:${address.port}/v1`,
            auth: { type: "none" },
            models: [{ id: "scripted" }],
          },
        },
      }),
      { mode: 0o600 },
    );
    await agent.management.request({ type: "workspace", cwd: workspace });
    await files.setWorkspace(workspace);
    await reload();
    await js(
      `(()=>{const e=document.querySelector('.live-composer textarea');Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(e,${JSON.stringify(assessment.prompt)});e.dispatchEvent(new Event('input',{bubbles:true}));})()`,
    );
    await click(".studio-composer-footer > button:last-child");
    if (task !== "F06") {
      const requested = await Promise.race([approval, completed]);
      if (requested.payload.type !== "approval")
        throw new Error("Control approval was not reached");
      const descriptor = requested.payload.descriptor;
      const input = JSON.parse(descriptor?.input ?? "{}");
      if (
        descriptor?.effect !== "process" ||
        input.program !== "node" ||
        JSON.stringify(input.args) !== JSON.stringify(["-e", CANCEL_COMMAND]) ||
        input.cwd !== "."
      )
        throw new Error("Unexpected control approval operation");
      await until(
        "document.querySelector('.run-approval footer button:last-of-type')",
      );
      const metrics = await js(
        "(()=>{const r=document.querySelector('.run-approval footer button:last-of-type').getBoundingClientRect();const s=document.querySelector('.studio-composer-footer > button:last-child').getBoundingClientRect();return {approvalVisible:r.top>=0&&r.bottom<=innerHeight,stopVisible:s.top>=0&&s.bottom<=innerHeight,overflow:document.documentElement.scrollWidth>innerWidth}})()",
      );
      checks["approvalReachable"] = metrics.approvalVisible;
      checks["stopReachable"] = metrics.stopVisible;
      checks["noHorizontalOverflow"] = !metrics.overflow;
      await capture("approval");
      await click(".run-approval footer button:last-of-type");
      if (task === "F04") {
        pid = await commandPid(workspace, CANCEL_STARTED);
        await click(".studio-composer-footer > button:last-child");
      }
    }
    const terminal = await Promise.race([
      completed,
      new Promise<never>((_, reject) => {
        const timer = setTimeout(
          () => reject(new Error("Control completion timeout")),
          15000,
        );
        timer.unref();
      }),
    ]);
    await Promise.all(jobs);
    if (controlErrors.length) throw new Error(controlErrors.join("; "));
    const identity = events[0];
    if (!identity) throw new Error("Missing control identity");
    if (task === "F05") {
      if (!pid) throw new Error("Missing owned process PID");
      process.kill(pid, "SIGTERM");
      await waitForPidExit(pid);
      pid = undefined;
      const traceSha256 = createHash("sha256")
        .update(await readFile(join(home, "runs", `${identity.runId}.jsonl`)))
        .digest("hex");
      const crash = {
        summaryAtCrash: JSON.parse(
          await readFile(
            join(
              home,
              "run-records",
              identity.sessionId,
              identity.runId,
              "summary.json",
            ),
            "utf8",
          ),
        ),
        schemaVersion: 1,
        sessionId: identity.sessionId,
        runId: identity.runId,
        providerCalls,
        ownedCommandExited: true,
        hostObservedCompletion: terminal.payload,
        traceSha256,
        before,
        after: await workspaceHashes(workspace),
      };
      await writeFile(
        join(directory, "crash-start.json"),
        JSON.stringify(crash, null, 2) + "\n",
        { flag: "wx", mode: 0o600 },
      );
      await writeFile(
        join(directory, "events.json"),
        JSON.stringify(events, null, 2) + "\n",
        { flag: "wx", mode: 0o600 },
      );
      return; // The launcher starts a fresh process for read-only recovery, not a task retry.
    }
    if (blocked) await blocked.restore();
    await until(
      "document.querySelector('[data-run-result=current]') && !document.querySelector('[data-testid=composer-engine]').disabled",
    );
    const state = await agent.management.request({ type: "state" });
    const after = await workspaceHashes(workspace);
    const changed = changedPaths(before, after);
    checks["existingFilesPreserved"] = Object.keys(before).every(
      (path) => after[path] === before[path],
    );
    checks["effectScope"] = changed.every(
      (path) => task === "F04" && path === CANCEL_STARTED,
    );
    checks["oneLocalRequest"] = providerCalls === 1;
    checks["managementConnected"] = Boolean(state);
    if (task === "F06") {
      if (!blocked) throw new Error("Journal fault did not trigger");
      checks["journalFaultTriggered"] = Boolean(blocked);
      checks["storageFailureReported"] =
        terminal.payload.type === "complete" &&
        terminal.payload.outcome === "failed" &&
        terminal.payload.reason === "storage_error";
      checks["noApprovalAfterFailure"] = !events.some(
        (e) => e.payload.type === "approval",
      );
      checks["noToolStarted"] = !events.some(
        (e) =>
          e.payload.type === "action" && e.payload.action.status === "running",
      );
      const summary = JSON.parse(
        await readFile(
          join(
            home,
            "run-records",
            identity.sessionId,
            identity.runId,
            "summary.json",
          ),
          "utf8",
        ),
      );
      checks["noFalsePersistedCompletion"] =
        summary.completion?.outcome !== "completed";
      checks["originalJournalRestored"] =
        createHash("sha256")
          .update(await readFile(blocked.journal))
          .digest("hex") === blocked.sha256;
    } else {
      if (!pid) throw new Error("Missing owned process PID");
      await waitForPidExit(pid);
      pid = undefined;
      const trace = (
        await readFile(join(home, "runs", `${identity.runId}.jsonl`), "utf8")
      )
        .trim()
        .split("\n")
        .map((line) => JSON.parse(line));
      const reasonCount = trace.filter(
        (record) => record.event.type === "model.reasoning",
      ).length;
      await js(
        "(()=>{for(const d of document.querySelectorAll('.live-transcript details'))d.open=true;})()",
      );
      await until(
        "document.querySelector('.run-activity')?.textContent.includes('另有内容已省略') || document.querySelector('.run-activity')?.textContent.includes('Additional content was omitted')",
      );
      const rendered = await js(
        "({rows:document.querySelectorAll('.run-activity ol > li').length,outputMax:Math.max(0,...Array.from(document.querySelectorAll('.run-activity .run-output pre')).map(e=>e.textContent.length)),nodes:document.querySelectorAll('*').length})",
      );
      checks["tenThousandFragmentsRecorded"] =
        fragmentsWritten === 10000 && reasonCount === 10000;
      checks["boundedMergedDisplay"] =
        rendered.rows <= 50 &&
        rendered.outputMax <= 65536 &&
        rendered.nodes < 6000;
      checks["cancelled"] =
        terminal.payload.type === "complete" &&
        terminal.payload.outcome === "cancelled";
      checks["unknownEffects"] = Boolean(
        state.runHistory?.selected?.delivery?.unresolved.some(
          (entry) => entry.status === "unknown",
        ),
      );
      checks["ownedProcessExited"] = true;
    }
    const noFinished = await readFile(join(workspace, CANCEL_FINISHED)).then(
      () => false,
      (error: NodeJS.ErrnoException) => {
        if (error.code !== "ENOENT") throw error;
        return true;
      },
    );
    checks["noCompletionMarker"] = noFinished;
    await capture("desktop");
    await writeFile(
      join(directory, "events.json"),
      JSON.stringify(events, null, 2) + "\n",
      { flag: "wx", mode: 0o600 },
    );
    await writeFile(
      join(directory, "pilot-result.json"),
      JSON.stringify(
        {
          schemaVersion: 1,
          task,
          fixtureModel: true,
          providerCalls,
          model: {
            engine: "forge",
            provider: "control-fixture",
            id: "scripted",
          },
          completion: terminal.payload,
          checks,
          controlFault: {
            kind: task,
            fragmentsWritten,
            journalSha256: blocked?.sha256,
          },
          before,
          after,
          changedFiles: changed,
          originalPrompt: assessment.prompt,
          uiRendered: true,
          uiLocale: await js("document.documentElement.lang"),
          userTrial: false,
        },
        null,
        2,
      ) + "\n",
      { flag: "wx", mode: 0o600 },
    );
    if (Object.values(checks).some((value) => !value))
      throw new Error("Control fault contract failed");
  } catch (error) {
    await savePilotFailure(directory, {
      task,
      error: String(error),
      events,
      decisions: [],
      controlErrors,
    });
    try {
      await capture("failure");
    } catch {
      /* the window may itself be gone */
    }
    throw error;
  } finally {
    unsubscribe?.();
    await blocked?.restore();
    if (pid) {
      try {
        process.kill(pid, 0);
        process.kill(pid, "SIGTERM");
        await waitForPidExit(pid);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ESRCH") {
          console.error("Control process cleanup failed", String(error));
          await writeFile(
            join(directory, "cleanup-error.json"),
            JSON.stringify({ error: String(error) }) + "\n",
            { flag: "wx", mode: 0o600 },
          );
        }
      }
    }
    if (server) {
      server.closeAllConnections();
      const closingServer = server;
      await new Promise<void>((resolve) =>
        closingServer.close(() => resolve()),
      );
    }
  }
}
