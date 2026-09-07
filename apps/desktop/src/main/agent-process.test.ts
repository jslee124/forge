import { EventEmitter } from "node:events";
import type { UtilityProcess } from "electron";
import { describe, expect, it, vi } from "vitest";
import { AgentProcess } from "./agent-process.js";

class FakeUtilityProcess extends EventEmitter {
  readonly postMessage = vi.fn(
    (message: { type: string; requestId: string }) => {
      if (message.type === "ping") {
        queueMicrotask(() =>
          this.emit("message", {
            type: "pong",
            requestId: message.requestId,
            pid: 42,
            resourcesAvailable: true,
          }),
        );
      }
      if (message.type === "shutdown") {
        queueMicrotask(() => {
          this.emit("message", {
            type: "shutdown-complete",
            requestId: message.requestId,
          });
          this.emit("exit", 0);
        });
      }
    },
  );

  readonly kill = vi.fn(() => true);
}

describe("AgentProcess", () => {
  it("starts, communicates, exits, and removes owned listeners", async () => {
    const child = new FakeUtilityProcess();
    const agent = new AgentProcess(child as unknown as UtilityProcess);
    child.emit("message", { type: "ready", pid: 42 });

    await expect(agent.waitUntilReady()).resolves.toBeUndefined();
    await expect(agent.ping()).resolves.toEqual({
      pid: 42,
      resourcesAvailable: true,
    });
    await expect(agent.close()).resolves.toBeUndefined();

    expect(child.kill).not.toHaveBeenCalled();
    expect(child.listenerCount("message")).toBe(0);
    expect(child.listenerCount("exit")).toBe(0);
  });

  it("rejects pending work and removes listeners after an unexpected exit", async () => {
    const child = new FakeUtilityProcess();
    child.postMessage.mockImplementation(() => undefined);
    const agent = new AgentProcess(child as unknown as UtilityProcess);
    child.emit("message", { type: "ready", pid: 42 });

    const ping = agent.ping();
    child.emit("exit", 9);

    await expect(ping).rejects.toThrow("Desktop Agent exited with code 9");
    expect(child.listenerCount("message")).toBe(0);
    expect(child.listenerCount("exit")).toBe(0);
  });
});
