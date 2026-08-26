import type { ChildProcessWithoutNullStreams } from "node:child_process";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";

import { FORGE_VERSION } from "@forge/core";
import { describe, expect, it } from "vitest";

import {
  CodexAppServerClient,
  type CodexProcessFactoryOptions,
} from "./client.js";

class FakeCodexProcess extends EventEmitter {
  readonly stdin = new PassThrough();
  readonly stdout = new PassThrough();
  readonly stderr = new PassThrough();
  killed = false;

  kill(): boolean {
    this.killed = true;
    return true;
  }
}

describe("CodexAppServerClient", () => {
  it("initializes JSON-RPC and routes responses, notifications, and server requests", async () => {
    const process = new FakeCodexProcess();
    const received: unknown[] = [];
    let buffered = "";
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (chunk: string) => {
      buffered += chunk;
      const lines = buffered.split("\n");
      buffered = lines.pop() ?? "";
      for (const line of lines) {
        if (!line) continue;
        const message = JSON.parse(line) as {
          readonly id?: number | string;
          readonly method?: string;
        };
        received.push(message);
        if (message.method === "initialize") {
          process.stdout.write(
            `${JSON.stringify({ id: message.id, result: { userAgent: "fake" } })}\n`,
          );
        }
        if (message.method === "account/read") {
          process.stdout.write(
            `${JSON.stringify({ id: message.id, result: { account: null, requiresOpenaiAuth: true } })}\n`,
          );
        }
      }
    });

    const client = await CodexAppServerClient.connect({
      cwd: "/workspace",
      env: { FORGE_CODEX_PATH: "/custom/codex" },
      processFactory: (options: CodexProcessFactoryOptions) => {
        expect(options.command).toBe("/custom/codex");
        return process as unknown as ChildProcessWithoutNullStreams;
      },
    });
    const account = await client.request("account/read", {
      refreshToken: false,
    });
    expect(account).toEqual({ account: null, requiresOpenaiAuth: true });

    const notification = client.waitForNotification<{ success: boolean }>({
      method: "account/login/completed",
      timeoutMs: 1_000,
    });
    process.stdout.write(
      `${JSON.stringify({ method: "account/login/completed", params: { success: true } })}\n`,
    );
    await expect(notification).resolves.toEqual({ success: true });

    const serverRequest = new Promise<void>((resolve) => {
      client.onServerRequest((request) => {
        expect(request.method).toBe("item/fileChange/requestApproval");
        client.respond(request.id, { decision: "decline" });
        resolve();
      });
    });
    process.stdout.write(
      `${JSON.stringify({ id: "approval-1", method: "item/fileChange/requestApproval", params: {} })}\n`,
    );
    await serverRequest;
    expect(received).toContainEqual({
      id: "approval-1",
      result: { decision: "decline" },
    });
    expect(received).toContainEqual({ method: "initialized" });
    expect(received).toContainEqual({
      id: 1,
      method: "initialize",
      params: {
        clientInfo: {
          name: "forge",
          title: "Forge",
          version: FORGE_VERSION,
        },
        capabilities: null,
      },
    });
    client.close();
    expect(process.killed).toBe(true);
  });

  it("rejects notification waiters when the app-server exits", async () => {
    const process = new FakeCodexProcess();
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (chunk: string) => {
      for (const line of chunk.split("\n")) {
        if (!line) continue;
        const message = JSON.parse(line) as {
          readonly id?: number;
          readonly method?: string;
        };
        if (message.method === "initialize") {
          process.stdout.write(
            `${JSON.stringify({ id: message.id, result: {} })}\n`,
          );
        }
      }
    });
    const client = await CodexAppServerClient.connect({
      cwd: "/workspace",
      processFactory: () =>
        process as unknown as ChildProcessWithoutNullStreams,
    });
    const waiting = client.waitForNotification({
      method: "turn/completed",
    });
    process.emit("exit", 1, null);

    await expect(waiting).rejects.toThrow(/exited before completing/u);
    client.close();
  });
});
