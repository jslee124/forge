import type { ProductRunCompletion } from "@forge/application";
import type { RunEvent, RunPayload } from "../../shared/run-protocol.js";
import {
  type ActivityState,
  activityReducer,
  initialActivity,
} from "./run-state.js";

export interface SessionRun {
  identity: { sessionId: string; runId: string; requestId: string };
  prompt: string;
  preserveDraft?: boolean;
  active: boolean;
  status: string;
  answer: string;
  omitted: number;
  activity: ActivityState;
  approvals: Extract<RunPayload, { type: "approval" }>[];
  completion?: ProductRunCompletion;
}
export function createSessionRun(
  identity: SessionRun["identity"],
  prompt: string,
  preserveDraft: boolean,
): SessionRun {
  return {
    identity,
    prompt,
    preserveDraft,
    active: true,
    status: "running",
    answer: "",
    omitted: 0,
    activity: initialActivity,
    approvals: [],
  };
}
/** Bounded background projection. A session switch never changes a run's identity. */
export function reduceSessionRun(run: SessionRun, event: RunEvent): SessionRun {
  if (
    !run.active ||
    event.runId !== run.identity.runId ||
    event.requestId !== run.identity.requestId ||
    event.sessionId !== run.identity.sessionId
  )
    return run;
  const next = {
    ...run,
    activity: activityReducer(run.activity, { type: "event", event }),
  };
  const payload = event.payload;
  if (payload.type === "text") {
    const text = run.answer + payload.text;
    next.answer = text.slice(-1_000_000);
    next.omitted += Math.max(0, text.length - 1_000_000);
  } else if (payload.type === "phase")
    next.status = run.approvals.length ? "approval" : payload.phase;
  else if (payload.type === "approval") {
    next.approvals = [...run.approvals, payload];
    next.status = "approval";
  } else if (payload.type === "approval-resolved") {
    next.approvals = run.approvals.filter(
      (value) => value.approvalId !== payload.approvalId,
    );
    next.status = next.approvals.length ? "approval" : "running";
  } else if (payload.type === "complete") {
    next.active = false;
    next.status = payload.outcome;
    next.completion = payload;
    next.approvals = [];
  }
  return next;
}
