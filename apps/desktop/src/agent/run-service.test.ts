import { describe, expect, it } from "vitest";
import { RunChannel } from "../main/run-channel.js";
import {
  parseRunCommand,
  parseRunEvent,
  type RunEvent,
  type RunReply,
} from "../shared/run-protocol.js";
import { RunService } from "./run-service.js";

const start = {
  type: "start",
  requestId: "req1",
  sessionId: "session1",
  runId: "run1",
  prompt: "hello",
  engine: "native",
} as const;
const flush = () => new Promise((resolve) => setImmediate(resolve));

describe("run transport", () => {
  it("interrupts instead of hanging on a malformed event from the active run", async () => {
    const channel = new RunChannel(() => undefined);
    const events: RunEvent[] = [];
    channel.subscribe((event) => events.push(event));
    const pending = channel.request(start);
    channel.receive({
      type: "run-reply",
      requestId: start.requestId,
      ok: true,
    });
    await pending;
    channel.receive({
      type: "run-event",
      schemaVersion: 1,
      occurredAt: new Date().toISOString(),
      sessionId: start.sessionId,
      runId: start.runId,
      requestId: start.requestId,
      sequence: 1,
      payload: { type: "text", text: "unsafe mixed protocol" },
    });
    expect(events).toHaveLength(1);
    expect(events[0]?.payload).toEqual({
      type: "complete",
      outcome: "interrupted",
    });
  });
  it("binds structured decisions to actions and emits the decision before completion", async () => {
    const messages: (RunEvent | RunReply)[] = [];
    let allowed: boolean | undefined;
    const service = new RunService(
      (message) => messages.push(message),
      async (_, context) => {
        allowed = await context.approve("Read file", {
          actionId: "action1",
          effect: "read",
          resource: "note.txt",
          preview: "read note.txt",
          input: "{}",
          riskFlags: [],
        });
      },
    );
    service.handle(start);
    await flush();
    const approve = {
      type: "approve",
      requestId: "bad",
      sessionId: start.sessionId,
      runId: start.runId,
      approvalId: "approval-1",
      actionId: "wrong",
      allow: true,
    };
    service.handle(approve);
    expect(messages.at(-1)).toMatchObject({ type: "run-reply", ok: false });
    expect(allowed).toBeUndefined();
    service.handle({ ...approve, requestId: "right", actionId: "action1" });
    await flush();
    expect(allowed).toBe(true);
    const payloads = messages
      .filter((message): message is RunEvent => message.type === "run-event")
      .map((message) => message.payload.type);
    expect(payloads).toEqual(["approval", "approval-resolved", "complete"]);
    service.close();
  });

  it("coalesces reasoning before assigning sequence numbers and flushes terminal text", async () => {
    const messages: (RunEvent | RunReply)[] = [];
    const service = new RunService(
      (message) => messages.push(message),
      async (_, context) => {
        for (let i = 0; i < 10_000; i++) context.detail("reasoning", ".", 1);
        context.text("answer");
        return {
          outcome: "limit_reached",
          reason: "model_step_limit",
          modelSteps: 12,
          toolCalls: 0,
        };
      },
    );
    service.handle(start);
    await flush();
    const events = messages.filter(
      (message): message is RunEvent => message.type === "run-event",
    );
    expect(events.map((message) => message.sequence)).toEqual([1, 2, 3]);
    expect(events[0]?.payload).toMatchObject({
      type: "detail",
      kind: "reasoning",
      text: ".".repeat(10_000),
    });
    expect(events.at(-1)?.payload).toMatchObject({
      outcome: "limit_reached",
      reason: "model_step_limit",
    });
    for (const event of events) expect(parseRunEvent(event)).toBeDefined();
    expect(parseRunEvent({ ...events[0], schemaVersion: 1 })).toBeUndefined();
    service.close();
  });
  it("rejects unknown, oversized, nonserializable and extra authority parameters", () => {
    for (const value of [
      null,
      {},
      { ...start, engine: "other" },
      { ...start, token: "secret" },
      { ...start, signal: new AbortController().signal },
      { ...start, prompt: "" },
      { ...start, requestId: "" },
    ])
      expect(parseRunCommand(value)).toBeUndefined();
    expect(parseRunEvent({ type: "run-event" })).toBeUndefined();
  });
  it("correlates approval and cancellation, rejects cross-session and duplicate starts", async () => {
    const events: RunEvent[] = [];
    let approved: boolean | undefined;
    let count = 0;
    const channel = new RunChannel((request) => service.handle(request));
    const service = new RunService(
      (event) => channel.receive(event),
      async (_request, context) => {
        count++;
        context.text("hello");
        approved = await context.approve("Write file?");
        if (approved && !context.signal.aborted) context.text("written");
      },
    );
    const unsubscribe = channel.subscribe((event) => events.push(event));
    expect(await channel.request(start)).toBe(true);
    await flush();
    expect(await channel.request(start)).toBe(false);
    expect(
      await channel.request({
        type: "cancel",
        requestId: "wrong",
        sessionId: "other",
        runId: "run1",
      }),
    ).toBe(false);
    expect(
      await channel.request({
        type: "approve",
        requestId: "stale",
        sessionId: "session1",
        runId: "run1",
        approvalId: "missing",
        allow: true,
      }),
    ).toBe(false);
    expect(
      await channel.request({
        type: "cancel",
        requestId: "cancel1",
        sessionId: "session1",
        runId: "run1",
      }),
    ).toBe(true);
    await flush();
    expect(approved).toBe(false);
    expect(count).toBe(1);
    expect(events.map((event) => event.sequence)).toEqual([1, 2, 3]);
    expect(events.at(-1)?.payload).toEqual({
      type: "complete",
      outcome: "cancelled",
    });
    unsubscribe();
    channel.disconnect();
    service.close();
  });
  it("drops other-task, duplicate and late events and interrupts on a sequence gap", async () => {
    const channel = new RunChannel(() => undefined);
    const events: RunEvent[] = [];
    channel.subscribe((event) => events.push(event));
    const pending = channel.request(start);
    channel.receive({ type: "run-reply", requestId: "req1", ok: true });
    expect(await pending).toBe(true);
    const event: RunEvent = {
      type: "run-event",
      schemaVersion: 2,
      occurredAt: new Date().toISOString(),
      requestId: "req1",
      sessionId: "session1",
      runId: "run1",
      sequence: 1,
      payload: { type: "text", text: "hello" },
    };
    channel.receive({ ...event, sessionId: "other" });
    channel.receive(event);
    channel.receive(event);
    channel.receive({ ...event, sequence: 3 });
    channel.receive({ ...event, sequence: 2 });
    expect(events).toHaveLength(2);
    expect(events[1]?.payload).toEqual({
      type: "complete",
      outcome: "interrupted",
    });
    expect(await channel.request({ ...start, requestId: "req2" })).toBe(false);
  });
  it("disconnect resolves pending waits once, removes subscriptions and never retries", async () => {
    const sent: unknown[] = [];
    const events: RunEvent[] = [];
    const channel = new RunChannel((value) => sent.push(value));
    channel.subscribe((event) => events.push(event));
    const pending = channel.request(start);
    channel.disconnect();
    channel.disconnect();
    expect(await pending).toBe(false);
    expect(sent).toHaveLength(1);
    expect(events).toHaveLength(1);
  });
  it("accepts an approval once and rejects a replayed run id", async () => {
    let allowed: boolean | undefined;
    const messages: (RunEvent | RunReply)[] = [];
    const service = new RunService(
      (value) => messages.push(value),
      async (_, context) => {
        allowed = await context.approve("Write?");
      },
    );
    service.handle(start);
    await flush();
    service.handle({
      type: "approve",
      requestId: "approve",
      sessionId: "session1",
      runId: "run1",
      approvalId: "approval-1",
      allow: true,
    });
    await flush();
    expect(allowed).toBe(true);
    expect(messages).toContainEqual(
      expect.objectContaining({
        payload: { type: "complete", outcome: "completed" },
      }),
    );
    service.handle({ ...start, requestId: "again" });
    expect(messages.at(-1)).toEqual({
      type: "run-reply",
      requestId: "again",
      ok: false,
    });
    service.close();
  });

  it("production without executor refuses execution and shutdown denies approvals", async () => {
    const replies: (RunEvent | RunReply)[] = [];
    new RunService((value) => replies.push(value)).handle(start);
    expect(replies).toEqual([
      { type: "run-reply", requestId: "req1", ok: false },
    ]);
    let allowed: boolean | undefined;
    const service = new RunService(
      () => undefined,
      async (_, context) => {
        allowed = await context.approve("test");
      },
    );
    service.handle(start);
    await flush();
    service.close();
    await flush();
    expect(allowed).toBe(false);
  });
});

describe("recovery command boundary", () => {
  it("accepts only a source link and opaque preparation token", () => {
    const recovery = {
      token: "review-token",
      sourceRunId: "source-run",
      kind: "retry",
    };
    expect(parseRunCommand({ ...start, recovery })).toMatchObject({ recovery });
    for (const invalid of [
      { ...recovery, kind: "replay" },
      { ...recovery, token: "../unsafe" },
      { ...recovery, permissionProfile: "workspace-write" },
      { ...recovery, grants: ["allow"] },
    ])
      expect(parseRunCommand({ ...start, recovery: invalid })).toBeUndefined();
  });
});
