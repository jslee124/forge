import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { CodexClient } from "@forge/application";
import type {
  JsonRpcNotification,
  JsonRpcServerRequest,
} from "@forge/codex-app-server";
import { expect, it } from "vitest";
import { DesktopApplication } from "./application.js";

class Client implements CodexClient {
  readonly notifications = new Set<(n: JsonRpcNotification) => void>();
  readonly approvals = new Set<(r: JsonRpcServerRequest) => void>();
  readonly failures = new Set<(e: Error) => void>();
  readonly calls: string[] = [];
  readonly inputs: unknown[] = [];
  readonly replies: unknown[] = [];
  turnStart: (() => void) | undefined;
  closed = false;
  async request<T>(method: string, params?: unknown): Promise<T> {
    this.calls.push(method);
    if (method === "turn/start") this.inputs.push(params);
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

it("executes and restores Codex desktop turns using only text history", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "forge-desktop-codex-"));
  try {
    const clients: Client[] = [];
    const env = { FORGE_HOME: join(cwd, "home") };
    const connect = async () => {
      const client = new Client();
      clients.push(client);
      client.turnStart = () => {
        for (const listener of client.notifications)
          listener({
            method: "item/agentMessage/delta",
            params: { delta: "Codex answer" },
          });
        queueMicrotask(() => client.complete());
      };
      return client;
    };
    const app = new DesktopApplication(env, cwd, { connect });
    await app.manage({ type: "workspace", cwd });
    const state = await app.manage({ type: "create", prompt: "hello" });
    const output: string[] = [];
    await app.execute(
      {
        type: "start",
        requestId: randomUUID(),
        runId: randomUUID(),
        sessionId: state.sessionId,
        engine: "codex",
        prompt: "hello",
      },
      {
        signal: new AbortController().signal,
        text: (text) => output.push(text),
        detail: () => undefined,
        approve: async () => false,
      },
    );
    expect(output.join("")).toBe("Codex answer");
    const restarted = new DesktopApplication(env, cwd, { connect });
    await restarted.manage({ type: "workspace", cwd });
    await restarted.manage({ type: "resume", sessionId: state.sessionId });
    expect((await restarted.state()).messages.at(-1)?.content).toBe(
      "Codex answer",
    );
    await restarted.execute(
      {
        type: "start",
        requestId: randomUUID(),
        runId: randomUUID(),
        sessionId: state.sessionId,
        engine: "codex",
        prompt: "continue",
      },
      {
        signal: new AbortController().signal,
        text: () => undefined,
        detail: () => undefined,
        approve: async () => false,
      },
    );
    expect(JSON.stringify(clients[1]?.inputs)).toContain("Codex answer");
    expect(clients.every((client) => client.closed)).toBe(true);
    expect((await restarted.manage({ type: "auth-status" })).auth).toBe(
      "authenticated",
    );
    expect((await restarted.state()).codexModels).toEqual(["test"]);
    app.close();
    restarted.close();
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});
it("reports missing Codex without falling back to native execution", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "forge-desktop-no-codex-"));
  try {
    const app = new DesktopApplication({ FORGE_HOME: join(cwd, "home") }, cwd, {
      connect: async () => {
        throw new Error("missing executable");
      },
    });
    expect((await app.manage({ type: "auth-status" })).auth).toBe(
      "unavailable",
    );
    await app.manage({ type: "workspace", cwd });
    const state = await app.manage({ type: "create", prompt: "hello" });
    await expect(
      app.execute(
        {
          type: "start",
          requestId: randomUUID(),
          runId: randomUUID(),
          sessionId: state.sessionId,
          engine: "codex",
          prompt: "hello",
        },
        {
          signal: new AbortController().signal,
          text: () => undefined,
          detail: () => undefined,
          approve: async () => false,
        },
      ),
    ).rejects.toThrow("run-failed");
    app.close();
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

it.each([null, "apiKey"])(
  "does not report %s as a ChatGPT execution login",
  async (type) => {
    const cwd = await mkdtemp(join(tmpdir(), "forge-desktop-auth-"));
    const client = new Client();
    const request = client.request.bind(client);
    client.request = async <T>(method: string): Promise<T> =>
      method === "account/read"
        ? ({ account: type ? { type } : null } as T)
        : request<T>(method);
    const app = new DesktopApplication({ FORGE_HOME: join(cwd, "home") }, cwd, {
      connect: async () => client,
    });
    try {
      const state = await app.manage({ type: "auth-status" });
      expect(state.auth).toBe("signed-out");
      expect(state.codexModels).toEqual([]);
      expect(client.closed).toBe(true);
    } finally {
      app.close();
      await rm(cwd, { recursive: true, force: true });
    }
  },
);
it("preserves authenticated status if only model discovery fails", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "forge-desktop-models-"));
  const client = new Client();
  const request = client.request.bind(client);
  client.request = async <T>(method: string): Promise<T> => {
    if (method === "model/list") throw new Error("model service unavailable");
    return request<T>(method);
  };
  const app = new DesktopApplication({ FORGE_HOME: join(cwd, "home") }, cwd, {
    connect: async () => client,
  });
  try {
    expect((await app.manage({ type: "auth-status" })).auth).toBe(
      "authenticated",
    );
  } finally {
    app.close();
    await rm(cwd, { recursive: true, force: true });
  }
});
it.each([true, false])(
  "settles browser login success=%s and clears the URL",
  async (success) => {
    const cwd = await mkdtemp(join(tmpdir(), "forge-desktop-login-"));
    const client = new Client();
    const request = client.request.bind(client);
    client.request = async <T>(method: string): Promise<T> =>
      method === "account/login/start"
        ? ({
            type: "chatgpt",
            loginId: "login",
            authUrl: "https://auth.openai.com/test",
          } as T)
        : request<T>(method);
    client.waitForNotification = async <T>(): Promise<T> =>
      ({ loginId: "login", success }) as T;
    const app = new DesktopApplication({ FORGE_HOME: join(cwd, "home") }, cwd, {
      connect: async () => client,
    });
    try {
      await app.manage({ type: "login" });
      await expect
        .poll(async () => (await app.state()).auth)
        .toBe(success ? "authenticated" : "failed");
      expect((await app.state()).loginUrl).toBe("");
      expect(client.closed).toBe(true);
    } finally {
      app.close();
      await rm(cwd, { recursive: true, force: true });
    }
  },
);

it("keeps login state during refresh and restores it after cancellation", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "forge-desktop-cancel-login-"));
  const client = new Client();
  const request = client.request.bind(client);
  client.request = async <T>(method: string): Promise<T> =>
    method === "account/login/start"
      ? ({
          type: "chatgpt",
          loginId: "login",
          authUrl: "https://auth.openai.com/test",
        } as T)
      : request<T>(method);
  client.waitForNotification = async <T>(options?: {
    signal?: AbortSignal;
  }): Promise<T> =>
    new Promise((_resolve, reject) => {
      const abort = () => reject(new Error("cancelled"));
      options?.signal?.addEventListener("abort", abort, { once: true });
      if (options?.signal?.aborted) abort();
    });
  const app = new DesktopApplication({ FORGE_HOME: join(cwd, "home") }, cwd, {
    connect: async () => client,
  });
  try {
    await app.manage({ type: "login" });
    await expect
      .poll(async () => (await app.state()).loginUrl)
      .toBe("https://auth.openai.com/test");
    expect((await app.manage({ type: "auth-status" })).auth).toBe("signing-in");
    await app.manage({ type: "cancel-login" });
    await expect.poll(async () => (await app.state()).auth).toBe("unknown");
    expect((await app.state()).loginUrl).toBe("");
    expect(client.calls).toContain("account/login/cancel");
    expect(client.closed).toBe(true);
  } finally {
    app.close();
    await rm(cwd, { recursive: true, force: true });
  }
});
