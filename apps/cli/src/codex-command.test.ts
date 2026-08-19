import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { AuthenticationManager } from "@forge/auth";
import type {
  CodexLoginCompleted,
  CodexModel,
  JsonRpcNotification,
  JsonRpcServerRequest,
} from "@forge/codex-app-server";
import { afterEach, describe, expect, it } from "vitest";

import {
  type CodexClient,
  type CodexCommandDependencies,
  type CodexOutputEvent,
  runCodexAuthCommand,
  runCodexModelsCommand,
  runCodexTask,
} from "./codex-command.js";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

class BufferOutput {
  value = "";
  write(chunk: string): void {
    this.value += chunk;
  }
}

class FakeClient implements CodexClient {
  readonly requests: Array<{ method: string; params: unknown }> = [];
  readonly responses: Array<{ id: string | number; result: unknown }> = [];
  readonly notifications = new Set<(value: JsonRpcNotification) => void>();
  readonly serverRequests = new Set<(value: JsonRpcServerRequest) => void>();
  account: unknown = {
    account: { type: "chatgpt", email: "user@example.com", planType: "plus" },
    requiresOpenaiAuth: true,
  };
  models: readonly CodexModel[] = [model()];
  closed = false;

  async request<T>(method: string, params?: unknown): Promise<T> {
    this.requests.push({ method, params });
    if (method === "account/read") return this.account as T;
    if (method === "account/login/start") {
      return {
        type: "chatgpt",
        loginId: "login-1",
        authUrl: "https://chatgpt.com/login",
      } as T;
    }
    if (method === "model/list") {
      return { data: this.models, nextCursor: null } as T;
    }
    if (method === "thread/start") {
      return {
        thread: { id: "thread-1" },
        model: "gpt-test",
        modelProvider: "openai",
        reasoningEffort: null,
      } as T;
    }
    if (method === "turn/start") {
      queueMicrotask(() =>
        this.emit({
          method: "item/agentMessage/delta",
          params: { delta: "done" },
        }),
      );
      queueMicrotask(() =>
        this.emit({
          method: "item/started",
          params: {
            item: { type: "commandExecution", command: "pwd" },
          },
        }),
      );
      queueMicrotask(() =>
        this.emit({
          method: "turn/completed",
          params: {
            threadId: "thread-1",
            turn: { id: "turn-1", status: "completed", error: null },
          },
        }),
      );
      return { turn: { id: "turn-1", status: "inProgress" } } as T;
    }
    return {} as T;
  }

  respond(id: string | number, result: unknown): void {
    this.responses.push({ id, result });
  }
  respondError(): void {}
  onNotification(listener: (value: JsonRpcNotification) => void): () => void {
    this.notifications.add(listener);
    return () => this.notifications.delete(listener);
  }
  onServerRequest(listener: (value: JsonRpcServerRequest) => void): () => void {
    this.serverRequests.add(listener);
    return () => this.serverRequests.delete(listener);
  }
  onFailure(): () => void {
    return () => undefined;
  }
  async waitForNotification<T>(options: {
    readonly method: string;
  }): Promise<T> {
    expect(options.method).toBe("account/login/completed");
    return {
      loginId: "login-1",
      success: true,
      error: null,
    } satisfies CodexLoginCompleted as T;
  }
  close(): void {
    this.closed = true;
  }
  emit(notification: JsonRpcNotification): void {
    for (const listener of this.notifications) listener(notification);
  }
}

describe("Codex commands", () => {
  it("reports API-key providers without confusing them with ChatGPT sign-in", async () => {
    const stdout = new BufferOutput();
    const result = await runCodexAuthCommand(
      "status",
      "openai-api",
      {},
      {
        ...dependencies(new FakeClient(), stdout, new BufferOutput()),
        env: { OPENAI_API_KEY: "test-secret" },
      },
    );

    expect(result).toBe(0);
    expect(stdout.value).toBe("openai-api: authenticated via OPENAI_API_KEY\n");
  });

  it("removes stored API credentials but does not pretend to unset the environment", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "forge-auth-command-"));
    temporaryDirectories.push(root);
    const env = { FORGE_HOME: root };
    await new AuthenticationManager(env).storeApiKey("deepseek", "test-secret");
    const stdout = new BufferOutput();

    const result = await runCodexAuthCommand(
      "logout",
      "deepseek",
      {},
      { ...dependencies(new FakeClient(), stdout, new BufferOutput()), env },
    );

    expect(result).toBe(0);
    expect(stdout.value).toContain("Removed the stored deepseek credential");
    expect(
      new AuthenticationManager(env).status("deepseek").authenticated,
    ).toBe(false);
  });

  it("runs browser login through the official app-server account surface", async () => {
    const client = new FakeClient();
    const stdout = new BufferOutput();
    const opened: string[] = [];
    const result = await runCodexAuthCommand(
      "login",
      "openai",
      { method: "browser" },
      dependencies(client, stdout, new BufferOutput(), {
        openUrl: async (url) => {
          opened.push(url);
        },
      }),
    );

    expect(result).toBe(0);
    expect(opened).toEqual(["https://chatgpt.com/login"]);
    expect(stdout.value).toContain("OpenAI sign-in completed");
    expect(stdout.value).toContain("ChatGPT subscription (plus)");
    expect(client.requests[0]).toEqual({
      method: "account/login/start",
      params: {
        type: "chatgpt",
        useHostedLoginSuccessPage: true,
        appBrand: "chatgpt",
      },
    });
    expect(client.closed).toBe(true);
  });

  it("lists model-specific reasoning efforts", async () => {
    const client = new FakeClient();
    const stdout = new BufferOutput();
    const result = await runCodexModelsCommand(
      "openai",
      dependencies(client, stdout, new BufferOutput()),
    );

    expect(result).toBe(0);
    expect(stdout.value).toContain("gpt-test");
    expect(stdout.value).toContain("low, high");
  });

  it("runs Codex read-only by default with the selected model and effort", async () => {
    const client = new FakeClient();
    const stdout = new BufferOutput();
    const stderr = new BufferOutput();
    const result = await runCodexTask(
      "inspect the repository",
      { model: "gpt-test", reasoningEffort: "high" },
      dependencies(client, stdout, stderr),
    );

    expect(result).toBe(0);
    expect(stdout.value).toBe("[answer]\ndone\n");
    expect(stderr.value).toContain("[command] pwd\n");
    expect(client.requests).toContainEqual({
      method: "account/read",
      params: { refreshToken: true },
    });
    expect(client.requests).toContainEqual({
      method: "thread/start",
      params: {
        model: "gpt-test",
        modelProvider: "openai",
        cwd: "/workspace",
        approvalPolicy: "never",
        sandbox: "read-only",
        serviceName: "forge",
        ephemeral: true,
      },
    });
    expect(client.requests).toContainEqual({
      method: "turn/start",
      params: {
        threadId: "thread-1",
        input: [
          { type: "text", text: "inspect the repository", text_elements: [] },
        ],
        effort: "high",
      },
    });
  });

  it("emits structured interactive output without changing plain CLI output", async () => {
    const client = new FakeClient();
    const events: CodexOutputEvent[] = [];
    const result = await runCodexTask(
      "inspect the repository",
      { model: "gpt-test", reasoningEffort: "high" },
      dependencies(client, new BufferOutput(), new BufferOutput(), {
        onOutput: (event) => events.push(event),
      }),
    );

    expect(result).toBe(0);
    expect(events).toEqual([
      { type: "system", text: "Codex · gpt-test · reasoning high" },
      { type: "answer", text: "" },
      { type: "answer", text: "done" },
      { type: "tool", text: "○ Running command: pwd" },
    ]);
  });

  it("rejects unsupported reasoning effort before starting a thread", async () => {
    const client = new FakeClient();
    const stderr = new BufferOutput();
    const result = await runCodexTask(
      "inspect",
      { reasoningEffort: "ultra" },
      dependencies(client, new BufferOutput(), stderr),
    );

    expect(result).toBe(2);
    expect(stderr.value).toContain("not supported");
    expect(
      client.requests.some(({ method }) => method === "thread/start"),
    ).toBe(false);
  });

  it("redacts credentials from app-server errors", async () => {
    const client = new FakeClient();
    client.request = async () => {
      throw new Error("Bearer secret eyJabc.def.ghi");
    };
    const stderr = new BufferOutput();
    const result = await runCodexAuthCommand(
      "status",
      "openai",
      {},
      dependencies(client, new BufferOutput(), stderr),
    );

    expect(result).toBe(1);
    expect(stderr.value).not.toContain("secret");
    expect(stderr.value).not.toContain("eyJabc");
    expect(stderr.value).toContain("[REDACTED]");
  });

  it("cancels an interrupted login through the app server", async () => {
    const client = new FakeClient();
    const controller = new AbortController();
    client.waitForNotification = async () => {
      controller.abort();
      throw new Error("cancelled");
    };
    const result = await runCodexAuthCommand(
      "login",
      "openai",
      { method: "browser" },
      {
        ...dependencies(client, new BufferOutput(), new BufferOutput()),
        signal: controller.signal,
        openUrl: async () => undefined,
      },
    );

    expect(result).toBe(130);
    expect(client.requests).toContainEqual({
      method: "account/login/cancel",
      params: { loginId: "login-1" },
    });
  });

  it("handles expired authorization and logout with fake responses", async () => {
    const expired = new FakeClient();
    expired.waitForNotification = async <T>() =>
      ({
        loginId: "login-1",
        success: false,
        error: "authorization expired sk-secret_12345678",
      }) as T;
    const stderr = new BufferOutput();
    const loginResult = await runCodexAuthCommand(
      "login",
      "openai",
      {},
      dependencies(expired, new BufferOutput(), stderr, {
        openUrl: async () => undefined,
      }),
    );
    expect(loginResult).toBe(1);
    expect(stderr.value).toContain("authorization expired");
    expect(stderr.value).not.toContain("sk-secret");

    const logout = new FakeClient();
    const stdout = new BufferOutput();
    expect(
      await runCodexAuthCommand(
        "logout",
        "openai",
        {},
        dependencies(logout, stdout, new BufferOutput()),
      ),
    ).toBe(0);
    expect(logout.requests).toContainEqual({
      method: "account/logout",
      params: undefined,
    });
    expect(stdout.value).toContain("Signed out");
  });

  it("fails actionably when the app-server response shape changes", async () => {
    const client = new FakeClient();
    client.request = async <T>() => ({ unexpected: true }) as T;
    const stderr = new BufferOutput();
    const result = await runCodexAuthCommand(
      "login",
      "openai",
      {},
      dependencies(client, new BufferOutput(), stderr),
    );

    expect(result).toBe(1);
    expect(stderr.value).toContain("invalid account/login/start response");
    expect(stderr.value).toContain("Update the Codex CLI");
  });
});

function model(): CodexModel {
  return {
    id: "gpt-test",
    model: "gpt-test",
    displayName: "GPT Test",
    description: "test model",
    hidden: false,
    supportedReasoningEfforts: [
      { reasoningEffort: "low", description: "fast" },
      { reasoningEffort: "high", description: "deep" },
    ],
    defaultReasoningEffort: "low",
    inputModalities: ["text"],
    isDefault: true,
  };
}

function dependencies(
  client: FakeClient,
  stdout: BufferOutput,
  stderr: BufferOutput,
  extra: Partial<CodexCommandDependencies> = {},
): CodexCommandDependencies {
  return {
    env: {},
    cwd: "/workspace",
    stdout,
    stderr,
    signal: new AbortController().signal,
    isTTY: false,
    connect: async () => client,
    ...extra,
  };
}
