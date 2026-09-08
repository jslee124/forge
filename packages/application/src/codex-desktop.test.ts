import type {
  JsonRpcNotification,
  JsonRpcServerRequest,
} from "@forge/codex-app-server";
import { describe, expect, it } from "vitest";
import { type CodexClient, runCodexTask } from "./codex.js";

class Client implements CodexClient {
  readonly notifications = new Set<(n: JsonRpcNotification) => void>();
  readonly approvals = new Set<(r: JsonRpcServerRequest) => void>();
  readonly failures = new Set<(e: Error) => void>();
  readonly calls: string[] = [];
  readonly replies: unknown[] = [];
  turnStart: (() => void) | undefined;
  closed = false;
  async request<T>(method: string): Promise<T> {
    this.calls.push(method);
    if (method === "account/read")
      return {
        account: { type: "chatgpt", planType: "plus" },
        requiresOpenaiAuth: true,
      } as T;
    if (method === "model/list")
      return {
        data: [
          {
            id: "test",
            model: "test",
            displayName: "Test",
            description: "",
            hidden: false,
            isDefault: true,
            supportedReasoningEfforts: [
              { reasoningEffort: "low", description: "" },
            ],
            defaultReasoningEffort: "low",
          },
        ],
        nextCursor: null,
      } as T;
    if (method === "thread/start") return { thread: { id: "thread" } } as T;
    if (method === "turn/start") {
      this.turnStart?.();
      return { turn: { id: "turn" } } as T;
    }
    if (method === "turn/interrupt")
      queueMicrotask(() => this.complete("interrupted"));
    return {} as T;
  }
  complete(status = "completed") {
    for (const listener of this.notifications)
      listener({
        method: "turn/completed",
        params: {
          threadId: "thread",
          turn: { id: "turn", status, error: null },
        },
      });
  }
  respond(_id: string | number, result: unknown) {
    this.replies.push(result);
    this.complete();
  }
  respondError(_id: string | number, code: number) {
    this.replies.push(code);
    this.complete();
  }
  onNotification(listener: (n: JsonRpcNotification) => void) {
    this.notifications.add(listener);
    return () => this.notifications.delete(listener);
  }
  onServerRequest(listener: (r: JsonRpcServerRequest) => void) {
    this.approvals.add(listener);
    return () => this.approvals.delete(listener);
  }
  onFailure(listener: (e: Error) => void) {
    this.failures.add(listener);
    return () => this.failures.delete(listener);
  }
  async waitForNotification<T>(): Promise<T> {
    throw new Error("not used");
  }
  close() {
    this.closed = true;
  }
}
function deps(client: Client, signal = new AbortController().signal) {
  return {
    env: {},
    cwd: "/tmp",
    signal,
    isTTY: false,
    connect: async () => client,
    stdout: { write() {} },
    stderr: { write() {} },
  };
}
describe("non-terminal Codex host", () => {
  it.each([true, false])(
    "bridges one-time approval %s without a TTY and removes listeners",
    async (allow) => {
      const client = new Client();
      client.turnStart = () => {
        for (const listener of client.approvals)
          listener({
            id: 1,
            method: "item/commandExecution/requestApproval",
            params: { command: "pwd", threadId: "thread" },
          });
      };
      const code = await runCodexTask(
        "hello",
        {},
        {
          ...deps(client),
          approve: async (description) => {
            expect(description).toContain("pwd");
            return allow;
          },
        },
      );
      expect(code).toBe(0);
      expect(client.replies).toEqual([
        { decision: allow ? "accept" : "decline" },
      ]);
      expect(
        client.notifications.size +
          client.approvals.size +
          client.failures.size,
      ).toBe(0);
      expect(client.closed).toBe(true);
    },
  );
  it("catches cancellation while turn/start is pending", async () => {
    const client = new Client();
    const controller = new AbortController();
    client.turnStart = () => controller.abort();
    expect(
      await runCodexTask("hello", {}, deps(client, controller.signal)),
    ).toBe(130);
    expect(client.calls).toContain("turn/interrupt");
    expect(client.notifications.size + client.failures.size).toBe(0);
  });
  it("never starts a turn for a pre-cancelled request", async () => {
    const client = new Client();
    const controller = new AbortController();
    controller.abort();
    expect(
      await runCodexTask("hello", {}, deps(client, controller.signal)),
    ).toBe(130);
    expect(client.calls).not.toContain("turn/start");
  });
  it("denies a late approval after cancellation", async () => {
    const client = new Client();
    const controller = new AbortController();
    client.turnStart = () => {
      for (const listener of client.approvals)
        listener({
          id: 1,
          method: "item/fileChange/requestApproval",
          params: {},
        });
    };
    await runCodexTask(
      "hello",
      {},
      {
        ...deps(client, controller.signal),
        approve: async () => {
          controller.abort();
          return true;
        },
      },
    );
    expect(client.replies).toEqual([{ decision: "decline" }]);
  });
  it("failure ends the wait and clears all subscriptions", async () => {
    const client = new Client();
    client.turnStart = () => {
      for (const listener of client.failures)
        listener(new Error("disconnected"));
    };
    expect(await runCodexTask("hello", {}, deps(client))).toBe(1);
    expect(
      client.notifications.size + client.approvals.size + client.failures.size,
    ).toBe(0);
  });
});
