import { randomUUID } from "node:crypto";
import { mkdtemp, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import type { ModelAdapter, ModelStreamEvent } from "@forge/core";
import { ExecutionLease, GatewayStore } from "@forge/persistence";
import { expect, it, vi } from "vitest";
import { gatewayBinding, setupGateway } from "./config.js";
import { retryGatewayDelivery, runGateway } from "./runtime.js";

it("polls, invokes the native application, delivers, shuts down and releases the bot lease", async () => {
  const root = await realpath(
    await mkdtemp(join(tmpdir(), "forge-gateway-runtime-")),
  );
  const accountId = String(Date.now());
  const env = {
    FORGE_HOME: join(root, "home"),
    FORGE_TELEGRAM_BOT_TOKEN: `${accountId}:fake`,
  };
  const config = await setupGateway(
    {
      owner: "7",
      workspace: root,
      alias: "runtime",
      permissionProfile: "safe",
    },
    env,
  );
  const controller = new AbortController();
  const sent: string[] = [];
  const offsets: number[] = [];
  let polled = false;
  const fetcher = vi.fn<typeof fetch>(async (url, init) => {
    const method = String(url).split("/").at(-1);
    const payload = JSON.parse(String(init?.body)) as {
      offset?: number;
      text?: string;
    };
    let result: unknown = {};
    if (method === "getMe") result = { id: Number(accountId), is_bot: true };
    else if (method === "getWebhookInfo") result = { url: "" };
    else if (method === "getUpdates") {
      offsets.push(payload.offset ?? 0);
      if (!polled) {
        polled = true;
        result = [
          {
            update_id: 10,
            message: {
              from: { id: 7, is_bot: false },
              chat: { id: 7, type: "private" },
              date: Math.floor(Date.now() / 1000),
              text: "hello",
            },
          },
        ];
      } else {
        await delay(20);
        result = [];
      }
    } else if (method === "sendMessage") {
      sent.push(payload.text ?? "");
      if (payload.text?.includes(": completed")) controller.abort();
    }
    return new Response(JSON.stringify({ ok: true, result }));
  });
  const model: ModelAdapter = {
    async *stream(): AsyncIterable<ModelStreamEvent> {
      yield { type: "text.delta", text: "offline transport answer" };
      yield {
        type: "finish",
        finishReason: "stop",
        usage: {
          inputTokens: 1,
          outputTokens: 1,
          reasoningTokens: 0,
          cachedInputTokens: 0,
          cacheWriteTokens: 0,
          totalTokens: 2,
        },
      };
    },
  };
  const watchdog = setTimeout(() => controller.abort(), 3000);
  try {
    await runGateway(env, controller.signal, {
      fetcher,
      createAdapter: () => model,
    });
    expect(sent.join("\n")).toContain("offline transport answer");
    expect(offsets).toContain(11);
    const state = await new GatewayStore(join(root, "home")).load(
      gatewayBinding(config),
    );
    expect(state.task?.state).toBe("completed");
    expect(state.connection).toBe("disconnected");
    const lease = await ExecutionLease.acquire(`telegram:${accountId}`);
    await lease.release();
  } finally {
    clearTimeout(watchdog);
    await rm(root, { recursive: true, force: true });
  }
});

it("allows delivery-only recovery locally and refuses it while the bot lease is owned", async () => {
  const root = await realpath(
    await mkdtemp(join(tmpdir(), "forge-delivery-recovery-")),
  );
  const accountId = String(Date.now());
  const env = {
    FORGE_HOME: join(root, "home"),
    FORGE_TELEGRAM_BOT_TOKEN: `${accountId}:fake`,
  };
  try {
    const config = await setupGateway(
      { owner: "7", workspace: root, alias: "test", permissionProfile: "safe" },
      env,
    );
    const store = new GatewayStore(join(root, "home"));
    const state = await store.load(gatewayBinding(config));
    state.outbox.push({
      id: randomUUID(),
      conversationId: "7",
      text: "finished",
      kind: "terminal",
      attempts: 6,
      nextAttemptAt: 99,
      failed: true,
    });
    state.outbox.push({
      id: randomUUID(),
      conversationId: "7",
      text: "old approval",
      kind: "approval",
      attempts: 1,
      nextAttemptAt: 0,
      failed: false,
    });
    await store.save(state);
    const lease = await ExecutionLease.acquire(`telegram:${accountId}`);
    try {
      await expect(retryGatewayDelivery(env)).rejects.toThrow("workspace-busy");
    } finally {
      await lease.release();
    }
    expect(await retryGatewayDelivery(env)).toBe(1);
    const restored = await store.load(gatewayBinding(config));
    expect(restored.outbox[0]).toMatchObject({
      attempts: 0,
      failed: false,
      kind: "terminal",
    });
    expect(restored.task).toBeUndefined();
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
