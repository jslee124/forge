import { randomUUID } from "node:crypto";
import { mkdtemp, readFile, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type {
  ModelAdapter,
  ModelStreamEvent,
  ProposedAction,
  ToolContext,
} from "@forge/core";
import { acquireWorkspaceLease, GatewayStore } from "@forge/persistence";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  type ChannelAdapter,
  ChannelError,
  type ChannelEvent,
  type ChannelMessage,
} from "./channel.js";
import {
  type GatewayConfig,
  gatewayBinding,
  parseGatewayConfig,
  readGatewayConfig,
  setupGateway,
} from "./config.js";
import {
  type GatewayRunContext,
  type GatewayRunner,
  NativeGatewayRunner,
} from "./runner.js";
import { GatewayService } from "./service.js";
import { TelegramAdapter, telegramEvent } from "./telegram.js";

const directories: string[] = [];
const services: GatewayService[] = [];
afterEach(async () => {
  for (const service of services.splice(0))
    await service.stop().catch(() => {});
  for (const dir of directories.splice(0))
    await rm(dir, { recursive: true, force: true });
});
async function directory(): Promise<string> {
  const dir = await realpath(
    await mkdtemp(join(tmpdir(), "forge-gateway-test-")),
  );
  directories.push(dir);
  return dir;
}
function event(text: string, patch: Partial<ChannelEvent> = {}): ChannelEvent {
  return {
    channel: "telegram",
    accountId: "123",
    senderId: "7",
    conversationId: "7",
    eventId: randomUUID(),
    receivedAt: Date.now(),
    private: true,
    kind: "text",
    text,
    ...patch,
  };
}
async function fixture(
  options: {
    buttons?: boolean;
    channel?: string;
    run?: GatewayRunner["run"];
    native?: boolean;
    approvalMs?: number;
    taskMs?: number;
  } = {},
) {
  const root = await directory();
  const home = await directory();
  const config: GatewayConfig = {
    schemaVersion: 1,
    channel: "telegram",
    accountId: "123",
    tokenEnv: "FORGE_TELEGRAM_BOT_TOKEN",
    allowedUserIds: ["7"],
    workspaceAlias: "test",
    workspaceRoot: root,
    permissionProfile: "safe",
  };
  const sent: ChannelMessage[] = [];
  const adapter: ChannelAdapter = {
    channel: options.channel ?? "telegram",
    accountId: "123",
    capabilities: {
      buttons: options.buttons ?? true,
      edit: false,
      textLimit: 3500,
    },
    send: vi.fn(async (message) => {
      sent.push(message);
    }),
  };
  const run = vi.fn(
    options.run ??
      (async () => ({ state: "completed" as const, text: "done" })),
  );
  const runner: GatewayRunner = {
    prepare: vi.fn(async (session) => session ?? randomUUID()),
    run,
  };
  const store = new GatewayStore(home);
  const state = await store.load(gatewayBinding(config));
  const service = new GatewayService(
    state,
    store,
    config,
    adapter,
    runner,
    ["very-secret-token"],
    {
      approvalMs: options.approvalMs ?? 300000,
      taskMs: options.taskMs ?? 1800000,
    },
  );
  services.push(service);
  await service.recover();
  return {
    root,
    home,
    config,
    sent,
    adapter,
    runner,
    run,
    store,
    state,
    service,
  };
}
const action = {
  tool: { name: "edit_file", risk: "write" },
  call: { id: "call-1" },
  input: { path: "a.txt", content: "hello" },
} as ProposedAction;
const toolContext = {} as ToolContext;
async function waitForApproval(service: GatewayService) {
  await vi.waitFor(() =>
    expect(
      service.state.outbox.some((item) => item.kind === "approval"),
      JSON.stringify(service.state),
    ).toBe(true),
  );
  return service.state.outbox.find((item) => item.kind === "approval");
}

describe("gateway admission and lifecycle", () => {
  it.each([
    { senderId: "8" },
    { private: false },
    { channel: "wrong" },
    { accountId: "wrong" },
    { threadId: "42" },
  ])("rejects unauthorized envelope %j", async (patch) => {
    const f = await fixture();
    await f.service.receive(event("work", patch), 5);
    await f.service.idle();
    expect(f.run).not.toHaveBeenCalled();
    expect(f.state.outbox).toEqual([]);
    expect((await f.store.load(gatewayBinding(f.config))).offset).toBe(5);
  });
  it.each([
    { kind: "unsupported" as const },
    { receivedAt: Date.now() - 600000 },
    { text: "a".repeat(17000) },
  ])("rejects unsupported/stale/large input %j", async (patch) => {
    const f = await fixture();
    await f.service.receive(event("work", patch));
    await f.service.idle();
    expect(f.run).not.toHaveBeenCalled();
  });
  it("deduplicates task delivery, supports new sessions, and never interprets arbitrary slash commands", async () => {
    const f = await fixture();
    const message = event("work");
    await f.service.receive(message, 10);
    await f.service.idle();
    const first = f.state.sessionId;
    await f.service.receive(message, 10);
    await f.service.receive(event("/config whatever"));
    expect(f.run).toHaveBeenCalledTimes(1);
    await f.service.receive(event("next"));
    await f.service.idle();
    expect(f.state.sessionId).toBe(first);
    await f.service.receive(event("/new"));
    await f.service.receive(event("new task"));
    await f.service.idle();
    expect(f.state.sessionId).not.toBe(first);
    expect(f.state.task?.state).toBe("completed");
  });
  it("rejects busy text but processes cancellation while runner is active", async () => {
    const f = await fixture({
      run: async (context) => {
        await new Promise<void>((resolve) =>
          context.signal.addEventListener("abort", () => resolve(), {
            once: true,
          }),
        );
        return { state: "cancelled", text: "stopped" };
      },
    });
    await f.service.receive(event("run"));
    await vi.waitFor(() => expect(f.run).toHaveBeenCalledOnce());
    await f.service.receive(event("second"));
    await f.service.receive(event("/new"));
    await f.service.receive(event("/status"));
    await f.service.receive(event("/cancel"));
    await f.service.idle();
    expect(f.run).toHaveBeenCalledOnce();
    expect(f.state.task?.state).toBe("cancelled");
    expect(f.state.outbox.some((x) => x.text.includes("Busy:"))).toBe(true);
  });
  it("rejects a workspace already leased by another entry point", async () => {
    const f = await fixture();
    const lease = await acquireWorkspaceLease(f.root);
    try {
      await f.service.receive(event("run"));
      expect(f.run).not.toHaveBeenCalled();
    } finally {
      await lease.release();
    }
    await f.service.receive(event("retry"));
    await f.service.idle();
    expect(f.run).toHaveBeenCalledOnce();
  });
  it("recovers accepted work as interrupted without rerunning; clears old approvals", async () => {
    const f = await fixture();
    f.state.task = {
      id: randomUUID(),
      conversationId: "7",
      state: "accepted",
      updatedAt: Date.now(),
    };
    f.state.outbox.push({
      id: randomUUID(),
      conversationId: "7",
      text: "old approval",
      kind: "approval",
      attempts: 0,
      nextAttemptAt: 0,
      failed: false,
    });
    await f.store.save(f.state);
    const state = await new GatewayStore(f.home).load(gatewayBinding(f.config));
    const recovered = new GatewayService(
      state,
      new GatewayStore(f.home),
      f.config,
      f.adapter,
      f.runner,
    );
    services.push(recovered);
    await recovered.recover();
    expect(state.task?.state).toBe("interrupted");
    expect(state.outbox.some((x) => x.kind === "approval")).toBe(false);
    expect(f.run).not.toHaveBeenCalled();
  });
  it("persists acceptance before executing and does not execute after persistence failure", async () => {
    const f = await fixture({
      run: async () => {
        throw new Error("not reached");
      },
    });
    vi.spyOn(f.store, "save").mockRejectedValueOnce(new Error("disk-full"));
    await expect(f.service.receive(event("run"), 3)).rejects.toThrow(
      "disk-full",
    );
    expect(f.run).not.toHaveBeenCalled();
    const lease = await acquireWorkspaceLease(f.root);
    await lease.release();
  });
  it("blocks new work when delivery has exhausted retries", async () => {
    const f = await fixture();
    f.state.outbox.push({
      id: randomUUID(),
      conversationId: "7",
      text: "failed",
      kind: "terminal",
      attempts: 6,
      nextAttemptAt: 0,
      failed: true,
    });
    await f.service.receive(event("work"));
    expect(f.run).not.toHaveBeenCalled();
  });
});

describe("one-time approvals and platform capability fallbacks", () => {
  it.each([
    { channel: "telegram", buttons: true },
    { channel: "fake-second", buttons: false },
  ])("authorizes one action using %j", async (options) => {
    let allowed: boolean | undefined;
    const f = await fixture({
      ...options,
      run: async (context) => {
        allowed = await context.approvalChannel.request(
          action,
          context.signal,
          toolContext,
        );
        return { state: "completed", text: String(allowed) };
      },
    });
    const send = (text: string, patch: Partial<ChannelEvent> = {}) =>
      f.service.receive(event(text, { channel: options.channel, ...patch }));
    await send("work");
    const approval = await waitForApproval(f.service);
    const data = options.buttons
      ? approval?.buttons?.[0]?.data
      : approval?.text.match(/\/approve [a-f0-9]{32}/u)?.[0];
    expect(data).toBeTruthy();
    await send(data ?? "", { senderId: "8", kind: "approval" });
    expect(allowed).toBeUndefined();
    await send(data ?? "", { conversationId: "99", kind: "approval" });
    expect(allowed).toBeUndefined();
    await send(data ?? "", { kind: "approval" });
    await f.service.idle();
    expect(allowed).toBe(true);
    await send(data ?? "", { kind: "approval" });
    expect(f.run).toHaveBeenCalledOnce();
    expect(f.state.outbox.at(-1)?.text).toContain("invalid or expired");
  });
  it.each(["deny", "cancel", "expire"])("fails closed on %s", async (mode) => {
    let allowed: boolean | undefined;
    const f = await fixture({
      approvalMs: mode === "expire" ? 100 : 10000,
      run: async (context) => {
        allowed = await context.approvalChannel.request(
          action,
          context.signal,
          toolContext,
        );
        return { state: "completed", text: "done" };
      },
    });
    await f.service.receive(event("work"));
    const approval = await waitForApproval(f.service);
    if (mode === "deny")
      await f.service.receive(
        event(approval?.buttons?.[1]?.data ?? "", { kind: "approval" }),
      );
    if (mode === "cancel") await f.service.receive(event("/cancel"));
    await f.service.idle();
    expect(allowed).toBe(false);
  });
  it("does not ask for approval when the complete action cannot be shown", async () => {
    const results: boolean[] = [];
    const f = await fixture({
      run: async (context) => {
        for (const content of ["x".repeat(5000), "very-secret-token"])
          results.push(
            await context.approvalChannel.request(
              { ...action, input: { content } },
              context.signal,
              toolContext,
            ),
          );
        return { state: "completed", text: "very-secret-token" };
      },
    });
    await f.service.receive(event("work"));
    await f.service.idle();
    expect(results).toEqual([false, false]);
    expect(JSON.stringify(f.state)).not.toContain("very-secret-token");
  });
});

describe("delivery", () => {
  it("persists retry attempts without replaying the task", async () => {
    const f = await fixture();
    await f.service.receive(event("work"));
    await f.service.idle();
    vi.mocked(f.adapter.send).mockRejectedValueOnce(
      new ChannelError(false, 90000),
    );
    const first = f.state.outbox[0];
    await f.service.flush(new AbortController().signal);
    expect(first?.attempts).toBe(1);
    expect(first?.nextAttemptAt).toBeGreaterThan(Date.now() + 80000);
    if (first) first.nextAttemptAt = 0;
    await f.service.flush(new AbortController().signal);
    expect(f.run).toHaveBeenCalledOnce();
    expect(f.sent.length).toBe(1);
  });
  it("caps final text and never splits emoji surrogate pairs", async () => {
    const f = await fixture({
      run: async () => ({ state: "completed", text: "😀".repeat(10000) }),
    });
    await f.service.receive(event("work"));
    await f.service.idle();
    const output = f.state.outbox.filter((x) => x.kind === "terminal");
    expect(output.length).toBeLessThanOrEqual(10);
    for (const item of output) {
      expect(item.text.length).toBeLessThanOrEqual(3500);
      expect(item.text).not.toMatch(/^[\uDC00-\uDFFF]|[\uD800-\uDBFF]$/u);
    }
    expect(output.at(-1)?.text).toContain("Truncated");
  });
});

it("runs the native application, persists history, and resumes it with a fake provider", async () => {
  const f = await fixture();
  const prompts: unknown[] = [];
  const model: ModelAdapter = {
    async *stream(request): AsyncIterable<ModelStreamEvent> {
      prompts.push(request.conversation);
      yield { type: "text.delta", text: "native answer" };
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
  const runner = new NativeGatewayRunner(
    f.config,
    { FORGE_HOME: f.home },
    () => model,
  );
  const sessionId = await runner.prepare();
  const lease = await acquireWorkspaceLease(f.root);
  try {
    for (const prompt of ["first", "second"]) {
      const context: GatewayRunContext = {
        id: randomUUID(),
        sessionId,
        prompt,
        lease,
        signal: new AbortController().signal,
        approvalChannel: { request: async () => false },
        progress: async () => {},
      };
      expect((await runner.run(context)).state).toBe("completed");
    }
  } finally {
    await lease.release();
  }
  expect(JSON.stringify(prompts[1])).toContain("native answer");
  expect(
    await readFile(join(f.home, "sessions", `${sessionId}.json`), "utf8"),
  ).toContain("second");
});

it("validates local configuration and refuses an empty allowlist or secret-bearing config", async () => {
  const f = await fixture();
  expect(() =>
    parseGatewayConfig({ ...f.config, allowedUserIds: [] }),
  ).toThrow();
  expect(() => parseGatewayConfig({ ...f.config, token: "secret" })).toThrow();
  const env = { FORGE_HOME: f.home, FORGE_TELEGRAM_BOT_TOKEN: "123:example" };
  await setupGateway(
    { owner: "7", workspace: f.root, alias: "test", permissionProfile: "safe" },
    env,
  );
  expect(await readGatewayConfig(env)).toEqual(f.config);
  expect(
    await readFile(join(f.home, "gateway", "config.json"), "utf8"),
  ).not.toContain("123:example");
  await expect(
    setupGateway(
      {
        owner: "8",
        workspace: f.root,
        alias: "test",
        permissionProfile: "safe",
      },
      env,
    ),
  ).rejects.toThrow("already configured");
});

it("normalizes Telegram identity and refuses forwarded, edited, bot and attachment tasks", () => {
  const message = {
    from: { id: 7, is_bot: false },
    chat: { id: 7, type: "private" },
    date: Date.now() / 1000,
    text: "hi",
  };
  expect(telegramEvent({ update_id: 4, message }, "123")?.senderId).toBe("7");
  for (const extra of [
    { forward_origin: {} },
    { document: {} },
    { photo: [] },
    { via_bot: {} },
  ])
    expect(
      telegramEvent({ update_id: 4, message: { ...message, ...extra } }, "123")
        ?.kind,
    ).toBe("unsupported");
  expect(
    telegramEvent({ update_id: 4, edited_message: message }, "123")?.kind,
  ).toBe("unsupported");
  expect(
    telegramEvent(
      { update_id: 4, message: { ...message, from: { id: 7, is_bot: true } } },
      "123",
    )?.private,
  ).toBe(false);
});

it("uses Telegram plain text, bounded transport and sanitized retry errors", async () => {
  const fetcher = vi
    .fn<typeof fetch>()
    .mockResolvedValueOnce(
      new Response(JSON.stringify({ ok: true, result: [] })),
    )
    .mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          ok: false,
          error_code: 429,
          parameters: { retry_after: 5 },
        }),
        { status: 429 },
      ),
    );
  const adapter = new TelegramAdapter("123", "123:secret", fetcher);
  await adapter.send(
    { conversationId: "7", text: "<untrusted>" },
    new AbortController().signal,
  );
  expect(
    JSON.parse(String(fetcher.mock.calls[0]?.[1]?.body)),
  ).not.toHaveProperty("parse_mode");
  await expect(
    adapter.poll(10, new AbortController().signal),
  ).rejects.toMatchObject({ fatal: false, retryAfterMs: 5000 });
  expect(fetcher.mock.calls[0]?.[1]?.redirect).toBe("error");
});

it("denies a changed action and an old token on a later approval", async () => {
  const mutable = { ...action, input: { path: "one" } };
  const decisions: boolean[] = [];
  const f = await fixture({
    run: async (context) => {
      decisions.push(
        await context.approvalChannel.request(
          mutable,
          context.signal,
          toolContext,
        ),
      );
      decisions.push(
        await context.approvalChannel.request(
          action,
          context.signal,
          toolContext,
        ),
      );
      return { state: "completed", text: "done" };
    },
  });
  await f.service.receive(event("run"));
  const first = (await waitForApproval(f.service))?.buttons?.[0]?.data ?? "";
  mutable.input.path = "changed";
  await f.service.receive(event(first, { kind: "approval" }));
  await vi.waitFor(() => expect(decisions).toEqual([false]));
  const second = (await waitForApproval(f.service))?.buttons?.[1]?.data ?? "";
  await f.service.receive(event(first, { kind: "approval" }));
  expect(decisions).toEqual([false]);
  await f.service.receive(event(second, { kind: "approval" }));
  await f.service.idle();
  expect(decisions).toEqual([false, false]);
});

it("recovers uncertain post-effect completion without automatically replaying it", async () => {
  let effects = 0;
  const f = await fixture({
    run: async () => {
      effects++;
      return { state: "completed", text: "effect happened" };
    },
  });
  const save = f.store.save.bind(f.store);
  const spy = vi
    .spyOn(f.store, "save")
    .mockImplementation((state) =>
      state.task?.state === "completed"
        ? Promise.reject(new Error("disk failed after effect"))
        : save(state),
    );
  const input = event("run");
  await f.service.receive(input, 2);
  await expect(f.service.idle()).rejects.toThrow("disk failed after effect");
  const restartedStore = new GatewayStore(f.home);
  const state = await restartedStore.load(gatewayBinding(f.config));
  const restarted = new GatewayService(
    state,
    restartedStore,
    f.config,
    f.adapter,
    f.runner,
  );
  services.push(restarted);
  await restarted.recover();
  await restarted.receive(input, 2);
  await restarted.idle();
  expect(state.task?.state).toBe("interrupted");
  expect(effects).toBe(1);
  spy.mockRestore();
});

it("honors the overall task deadline while awaiting approval", async () => {
  let decision: boolean | undefined;
  const f = await fixture({
    taskMs: 100,
    run: async (context) => {
      decision = await context.approvalChannel.request(
        action,
        context.signal,
        toolContext,
      );
      return {
        state: context.signal.aborted ? "cancelled" : "completed",
        text: "settled",
      };
    },
  });
  await f.service.receive(event("run"));
  await f.service.idle();
  expect(decision).toBe(false);
  expect(f.state.task?.state).toBe("cancelled");
});

it("performs real native file edits only after each separate remote approval", async () => {
  const f = await fixture();
  let step = 0;
  const usage = {
    inputTokens: 1,
    outputTokens: 1,
    reasoningTokens: 0,
    cachedInputTokens: 0,
    cacheWriteTokens: 0,
    totalTokens: 2,
  };
  const model: ModelAdapter = {
    async *stream(): AsyncIterable<ModelStreamEvent> {
      step++;
      if (step <= 2) {
        yield {
          type: "tool.call",
          call: {
            id: `edit-${step}`,
            name: "edit_file",
            input: {
              operation: "create",
              path: `file-${step}.txt`,
              content: "approved",
            },
          },
        };
        yield {
          type: "finish",
          finishReason: "tool-calls",
          usage,
          continuation: { provider: "fake", data: { step } },
        };
        return;
      }
      yield { type: "text.delta", text: "done" };
      yield { type: "finish", finishReason: "stop", usage };
    },
  };
  const runner = new NativeGatewayRunner(
    { ...f.config, permissionProfile: "workspace-write" },
    { FORGE_HOME: f.home },
    () => model,
  );
  const state = await new GatewayStore(await directory()).load(
    "native-write-test",
  );
  const service = new GatewayService(
    state,
    new GatewayStore(await directory()),
    f.config,
    f.adapter,
    runner,
  );
  services.push(service);
  await service.recover();
  await service.receive(event("write two files"));
  const first = await waitForApproval(service);
  await expect(readFile(join(f.root, "file-1.txt"))).rejects.toThrow();
  await service.receive(
    event(first?.buttons?.[0]?.data ?? "", { kind: "approval" }),
  );
  await vi.waitFor(async () =>
    expect(await readFile(join(f.root, "file-1.txt"), "utf8")).toBe("approved"),
  );
  const second = await waitForApproval(service);
  await service.receive(
    event(second?.buttons?.[1]?.data ?? "", { kind: "approval" }),
  );
  await service.idle();
  await expect(readFile(join(f.root, "file-2.txt"))).rejects.toThrow();
});

it("stops retrying failed deliveries and allows explicit local delivery-only recovery", async () => {
  const f = await fixture();
  await f.service.receive(event("work"));
  await f.service.idle();
  vi.mocked(f.adapter.send).mockRejectedValue(new ChannelError(false));
  const item = f.state.outbox[0];
  if (!item) throw new Error("missing delivery");
  for (let i = 0; i < 6; i++) {
    item.nextAttemptAt = 0;
    await f.service.flush(new AbortController().signal);
  }
  expect(item.failed).toBe(true);
  expect(f.run).toHaveBeenCalledOnce();
});

it("checks Telegram bot identity/webhook and handles authentication failure without leaking URLs", async () => {
  const fetcher = vi
    .fn<typeof fetch>()
    .mockResolvedValueOnce(
      new Response(
        JSON.stringify({ ok: true, result: { id: 123, is_bot: true } }),
      ),
    )
    .mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          ok: true,
          result: { url: "https://other.example/hook" },
        }),
      ),
    );
  const adapter = new TelegramAdapter("123", "123:secret", fetcher);
  await expect(adapter.verify(new AbortController().signal)).rejects.toThrow(
    "webhook configured",
  );
  fetcher.mockRejectedValueOnce(
    new Error("https://api.telegram.org/bot123:secret/getUpdates"),
  );
  await expect(adapter.poll(1, new AbortController().signal)).rejects.toThrow(
    "channel-temporarily-unavailable",
  );
  fetcher.mockResolvedValueOnce(
    new Response(JSON.stringify({ ok: false, error_code: 401 }), {
      status: 401,
    }),
  );
  await expect(
    adapter.poll(1, new AbortController().signal),
  ).rejects.toMatchObject({ fatal: true });
});

it("keeps cancellation responsive when the deduplication journal reaches its cap", async () => {
  const f = await fixture({
    run: async (context) => {
      await new Promise<void>((resolve) =>
        context.signal.addEventListener("abort", () => resolve(), {
          once: true,
        }),
      );
      return { state: "cancelled", text: "done" };
    },
  });
  await f.service.receive(event("run"));
  await vi.waitFor(() => expect(f.run).toHaveBeenCalledOnce());
  f.state.inbox = Array.from({ length: 10000 }, (_, i) => ({
    key: String(i),
    at: Date.now(),
  }));
  await f.service.receive(event("/cancel"));
  await f.service.idle();
  expect(f.state.task?.state).toBe("cancelled");
  expect(f.state.inbox).toHaveLength(10000);
});

it("does not send a seventh attempt after a crash persisted the sixth attempt", async () => {
  const f = await fixture();
  await f.service.receive(event("run"));
  await f.service.idle();
  const first = f.state.outbox[0];
  if (!first) throw new Error("missing delivery");
  first.attempts = 6;
  first.failed = false;
  await f.service.flush(new AbortController().signal);
  expect(first.failed).toBe(true);
  expect(first.attempts).toBe(6);
  expect(f.adapter.send).not.toHaveBeenCalled();
});

it("rejects restored outbox destinations that are not the configured Telegram owner", async () => {
  const f = await fixture();
  f.state.outbox.push({
    id: randomUUID(),
    conversationId: "8",
    text: "should not leak",
    kind: "terminal",
    attempts: 0,
    nextAttemptAt: 0,
    failed: false,
  });
  await expect(f.service.recover()).rejects.toThrow("destination-mismatch");
  expect(f.adapter.send).not.toHaveBeenCalled();
  f.state.outbox = [];
});
