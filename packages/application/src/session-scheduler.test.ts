import { describe, expect, it } from "vitest";
import { SessionScheduler, sessionConcurrency } from "./session-scheduler.js";

const tick = () => new Promise((resolve) => setImmediate(resolve));
describe("shared session scheduling", () => {
  it("enforces a process-wide limit, FIFO order and one run per session", async () => {
    const scheduler = new SessionScheduler();
    const entered: string[] = [];
    const release = new Map<string, () => void>();
    const submit = (id: string) =>
      scheduler.submit({
        sessionId: id,
        runId: id,
        execute: async () => {
          entered.push(id);
          await new Promise<void>((resolve) => release.set(id, resolve));
          return id;
        },
      });
    const a = submit("a");
    const b = submit("b");
    const c = submit("c");
    const d = submit("d");
    await tick();
    expect(entered).toEqual(["a", "b"]);
    expect(scheduler.queued).toBe(2);
    await expect(submit("c")).rejects.toThrow("session-busy");
    release.get("b")?.();
    expect(await b).toBe("b");
    await tick();
    expect(entered).toEqual(["a", "b", "c"]);
    expect(scheduler.cancel("a", "wrong-run")).toBe(false);
    release.get("a")?.();
    await a;
    await tick();
    expect(entered).toEqual(["a", "b", "c", "d"]);
    release.get("c")?.();
    release.get("d")?.();
    await Promise.all([c, d]);
    expect(scheduler.busy).toBe(false);
    await scheduler.drain();
  });
  it("cancels queued tasks without effects and drains cooperative running tasks", async () => {
    const scheduler = new SessionScheduler({ maxConcurrent: 1 });
    let entered = 0;
    const active = scheduler.submit({
      sessionId: "active",
      runId: "one",
      execute: async (signal) => {
        entered++;
        await new Promise<void>((resolve) =>
          signal.addEventListener("abort", () => resolve(), { once: true }),
        );
        return "cancelled";
      },
    });
    const controller = new AbortController();
    const queued = scheduler.submit({
      sessionId: "queued",
      runId: "two",
      signal: controller.signal,
      execute: async () => {
        entered++;
      },
    });
    const rejected = expect(queued).rejects.toThrow("cancelled");
    controller.abort();
    await rejected;
    await tick();
    expect(entered).toBe(1);
    await scheduler.drain();
    expect(await active).toBe("cancelled");
    expect(scheduler.busy).toBe(false);
    await expect(
      scheduler.submit({
        sessionId: "late",
        runId: "late",
        execute: async () => {},
      }),
    ).rejects.toThrow("scheduler-closed");
  });
  it("bounds waiting jobs and rejects invalid configuration", async () => {
    for (const maxConcurrent of [0, 17, 1.5, Number.NaN])
      expect(() => new SessionScheduler({ maxConcurrent })).toThrow(
        "invalid-concurrency-limit",
      );
    expect(sessionConcurrency({})).toBe(2);
    expect(
      sessionConcurrency({
        FORGE_MAX_CONCURRENT_RUNS: "3",
        FORGE_DESKTOP_MAX_CONCURRENT_RUNS: "4",
      }),
    ).toBe(3);
    expect(sessionConcurrency({ FORGE_DESKTOP_MAX_CONCURRENT_RUNS: "4" })).toBe(
      4,
    );
    const scheduler = new SessionScheduler({ maxConcurrent: 1 });
    const first = scheduler.submit({
      sessionId: "first",
      runId: "first",
      execute: async (signal) => {
        if (!signal.aborted)
          await new Promise<void>((resolve) =>
            signal.addEventListener("abort", () => resolve(), { once: true }),
          );
      },
    });
    const queued = Array.from({ length: 32 }, (_, n) =>
      scheduler
        .submit({ sessionId: `q${n}`, runId: `q${n}`, execute: async () => {} })
        .catch((error) => error.message),
    );
    await expect(
      scheduler.submit({
        sessionId: "overflow",
        runId: "overflow",
        execute: async () => {},
      }),
    ).rejects.toThrow("session-queue-full");
    await scheduler.drain();
    await first;
    expect(await Promise.all(queued)).toEqual(Array(32).fill("cancelled"));
  });
});
