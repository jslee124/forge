import { randomUUID } from "node:crypto";
import { mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createPersistentInteractiveSession } from "@forge/application";
import type { ModelAdapter, ModelRequest, ModelStreamEvent } from "@forge/core";
import { afterEach, describe, expect, it, vi } from "vitest";
import { RunChannel } from "../main/run-channel.js";
import type { RunEvent } from "../shared/run-protocol.js";
import { DesktopApplication } from "./application.js";
import { RunService } from "./run-service.js";

const roots: string[] = [];
afterEach(async () => {
  vi.unstubAllGlobals();
  for (const root of roots.splice(0))
    await rm(root, { recursive: true, force: true });
});
const finish = (finishReason: "stop" | "tool-calls"): ModelStreamEvent => ({
  type: "finish",
  finishReason,
  ...(finishReason === "tool-calls"
    ? { continuation: { provider: "fake", data: {} } }
    : {}),
  usage: {
    inputTokens: 1,
    outputTokens: 1,
    totalTokens: 2,
    reasoningTokens: 0,
    cachedInputTokens: 0,
    cacheWriteTokens: 0,
  },
});
const call = (name: string, input: unknown): ModelStreamEvent => ({
  type: "tool.call",
  call: { id: randomUUID(), name, input },
});
async function fixture(steps: ModelStreamEvent[][]) {
  const cwd = await mkdtemp(join(tmpdir(), "forge-desktop-execute-"));
  roots.push(cwd);
  const env = {
    FORGE_HOME: join(cwd, "home"),
    FORGE_WEB_PLUGIN_ROOT: fileURLToPath(
      new URL("../../../../examples/plugins/web-tools", import.meta.url),
    ),
  };
  const requests: ModelRequest[] = [];
  const model: ModelAdapter = {
    async *stream(request) {
      requests.push(request);
      yield* steps.shift() ?? [
        { type: "text.delta", text: "done" },
        finish("stop"),
      ];
    },
  };
  const application = new DesktopApplication(env, cwd, {
    createAdapter: () => model,
  });
  await application.manage({ type: "workspace", cwd });
  const state = await application.manage({ type: "create", prompt: "test" });
  return { application, cwd, env, requests, sessionId: state.sessionId };
}
async function run(
  application: DesktopApplication,
  sessionId: string,
  decision: "allow" | "deny" | "cancel" = "allow",
) {
  const events: RunEvent[] = [];
  const channel = new RunChannel((command) => service.handle(command));
  const service = new RunService(
    (event) => channel.receive(event),
    application.execute,
  );
  const identity = { sessionId, runId: randomUUID(), requestId: randomUUID() };
  const completed = new Promise<RunEvent>((resolve) =>
    channel.subscribe((event) => {
      events.push(event);
      if (event.payload.type === "approval")
        void channel.request(
          decision === "cancel"
            ? { ...identity, requestId: randomUUID(), type: "cancel" }
            : {
                ...identity,
                requestId: randomUUID(),
                type: "approve",
                approvalId: event.payload.approvalId,
                allow: decision === "allow",
              },
        );
      if (event.payload.type === "complete") resolve(event);
    }),
  );
  expect(
    await channel.request({
      ...identity,
      type: "start",
      prompt: "test",
      engine: "native",
    }),
  ).toBe(true);
  const final = await completed;
  service.close();
  channel.disconnect();
  return { events, final };
}
describe("desktop native execution", () => {
  it("loads the installed web plugin and requires a separate approval for every network call", async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response("Consulted source body", {
          headers: { "content-type": "text/plain" },
        }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const f = await fixture([
      [
        call("web_fetch", { url: "https://93.184.216.34/one" }),
        finish("tool-calls"),
      ],
      [
        call("web_fetch", { url: "https://93.184.216.34/two" }),
        finish("tool-calls"),
      ],
      [
        call("edit_file", {
          operation: "create",
          path: "report.md",
          content:
            "# Report\n\nConsulted source body. [Source](https://93.184.216.34/one)\n\n## Sources\n\nRetrieved text; see tool provenance for access time.\n",
        }),
        finish("tool-calls"),
      ],
      [
        {
          type: "text.delta",
          text: "Source: [Consulted page](https://93.184.216.34/one)",
        },
        finish("stop"),
      ],
    ]);
    await f.application.manage({ type: "web-install" });
    await f.application.manage({ type: "web-enable", enabled: true });
    const result = await run(f.application, f.sessionId);
    expect(
      result.events.filter((e) => e.payload.type === "approval"),
    ).toHaveLength(3);
    expect(await readFile(join(f.cwd, "report.md"), "utf8")).toContain(
      "[Source](https://93.184.216.34/one)",
    );
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(JSON.stringify(f.requests)).toContain(
      "Search snippets are not retrieved page bodies",
    );
    expect(JSON.stringify(result.events)).toContain("retrieved-text");
    f.application.close();
  });

  it("denies web access before fetching and keeps an installed plugin disabled by default", async () => {
    const fetchMock = vi.fn(async () => new Response("must not run"));
    vi.stubGlobal("fetch", fetchMock);
    const f = await fixture([
      [
        call("web_fetch", { url: "https://93.184.216.34/" }),
        finish("tool-calls"),
      ],
    ]);
    await f.application.manage({ type: "web-install" });
    expect((await f.application.state()).web?.enabled).toBe(false);
    await f.application.manage({ type: "web-enable", enabled: true });
    const result = await run(f.application, f.sessionId, "deny");
    expect(
      result.events.filter((e) => e.payload.type === "approval"),
    ).toHaveLength(1);
    expect(fetchMock).not.toHaveBeenCalled();
    f.application.close();
  });

  it("performs real read/write/command tools, two turns, and restores complete exchanges", async () => {
    const f = await fixture([
      [
        call("edit_file", {
          operation: "create",
          path: "hello.txt",
          content: "hello",
        }),
        finish("tool-calls"),
      ],
      [call("read_file", { path: "hello.txt" }), finish("tool-calls")],
      [
        call("edit_file", {
          operation: "replace",
          path: "hello.txt",
          edits: [{ oldText: "hello", newText: "updated" }],
        }),
        finish("tool-calls"),
      ],
      [call("run_command", { program: "pwd", args: [] }), finish("tool-calls")],
      [{ type: "text.delta", text: "done" }, finish("stop")],
    ]);
    const first = await run(f.application, f.sessionId);
    expect(first.final.payload, JSON.stringify(first.events)).toEqual({
      type: "complete",
      outcome: "completed",
    });
    expect(await readFile(join(f.cwd, "hello.txt"), "utf8")).toBe("updated");
    expect(
      first.events.filter((e) => e.payload.type === "approval"),
    ).toHaveLength(3);
    const restored = await createPersistentInteractiveSession({
      cwd: f.cwd,
      env: f.env,
      sessionId: f.sessionId,
    });
    expect(restored.history.filter((m) => m.role === "tool")).toHaveLength(4);
    const restarted = new DesktopApplication(f.env, f.cwd, {
      createAdapter: () => ({
        async *stream(request) {
          expect(request.conversation?.some((m) => m.role === "tool")).toBe(
            true,
          );
          yield { type: "text.delta", text: "second" };
          yield finish("stop");
        },
      }),
    });
    await restarted.manage({ type: "workspace", cwd: f.cwd });
    await restarted.manage({ type: "resume", sessionId: f.sessionId });
    expect((await run(restarted, f.sessionId)).final.payload).toEqual({
      type: "complete",
      outcome: "completed",
    });
    expect((await restarted.state()).messages.at(-1)?.content).toBe("second");
  });
  it.each(["deny", "cancel"] as const)(
    "%s never writes the requested file",
    async (decision) => {
      const f = await fixture([
        [
          call("edit_file", {
            operation: "create",
            path: "denied.txt",
            content: "no",
          }),
          finish("tool-calls"),
        ],
      ]);
      const result = await run(f.application, f.sessionId, decision);
      await expect(readFile(join(f.cwd, "denied.txt"))).rejects.toThrow();
      expect(result.final.payload).toEqual({
        type: "complete",
        outcome: decision === "cancel" ? "cancelled" : "completed",
      });
    },
  );
  it("rejects a session occupied by another process", async () => {
    const f = await fixture([]);
    await run(f.application, f.sessionId);
    const snapshot = join(f.env.FORGE_HOME, "sessions", `${f.sessionId}.json`);
    const before = await readFile(snapshot, "utf8");
    await writeFile(
      join(f.env.FORGE_HOME, "sessions", `${f.sessionId}.desktop-lock`),
      "busy",
    );
    expect((await run(f.application, f.sessionId)).final.payload).toEqual({
      type: "complete",
      outcome: "failed",
    });
    expect(await readFile(snapshot, "utf8")).toBe(before);
  });
  it("restores a persisted engine boundary without transferring tool history", async () => {
    const f = await fixture([
      [call("read_file", { path: "missing.txt" }), finish("tool-calls")],
      [{ type: "text.delta", text: "native answer" }, finish("stop")],
    ]);
    await run(f.application, f.sessionId);
    const session = await createPersistentInteractiveSession({
      cwd: f.cwd,
      env: f.env,
      sessionId: f.sessionId,
    });
    expect(session.history.some((m) => m.role === "tool")).toBe(true);
    await session.recordRun(
      "codex turn",
      {
        status: "completed",
        exitCode: 0,
        finalText: "codex answer",
        events: [],
        modelSteps: 1,
        toolCalls: 0,
      },
      { runId: randomUUID(), engine: "codex", tracePersisted: false },
    );
    const restored = await createPersistentInteractiveSession({
      cwd: f.cwd,
      env: f.env,
      sessionId: f.sessionId,
    });
    expect(restored.history.some((m) => m.role === "tool")).toBe(true);
    expect(
      restored.conversationForEngine("native").some((m) => m.role === "tool"),
    ).toBe(false);
    await restored.recordRun(
      "native turn",
      {
        status: "completed",
        exitCode: 0,
        finalText: "new answer",
        events: [],
        modelSteps: 1,
        toolCalls: 0,
      },
      { runId: randomUUID(), engine: "native", tracePersisted: false },
    );
    const final = await createPersistentInteractiveSession({
      cwd: f.cwd,
      env: f.env,
      sessionId: f.sessionId,
    });
    expect(
      final.conversationForEngine("native").some((m) => m.role === "tool"),
    ).toBe(false);
  });

  it("detects changes since resume and preserves the other writer's snapshot", async () => {
    const f = await fixture([]);
    await run(f.application, f.sessionId);
    const snapshot = join(f.env.FORGE_HOME, "sessions", `${f.sessionId}.json`);
    const changed = `${await readFile(snapshot, "utf8")} `;
    await writeFile(snapshot, changed);
    const result = await run(f.application, f.sessionId);
    expect(result.final.payload).toEqual({
      type: "complete",
      outcome: "failed",
    });
    expect(await readFile(snapshot, "utf8")).toBe(changed);
  });

  it("creates an automatic workspace only on valid submission", async () => {
    const f = await fixture([]);
    const app = new DesktopApplication(f.env, f.cwd, {
      createAdapter: () => ({
        async *stream() {
          yield { type: "text.delta", text: "auto answer" };
          yield finish("stop");
        },
      }),
    });
    expect((await app.state()).cwd).toBe("");
    const state = await app.manage({ type: "create", prompt: "hello" });
    expect(
      state.cwd.startsWith(
        join(await realpath(f.env.FORGE_HOME), "workspaces"),
      ),
    ).toBe(true);
    expect(state.sessionId).toMatch(/^[a-f0-9-]+$/);
    expect((await run(app, state.sessionId)).final.payload).toEqual({
      type: "complete",
      outcome: "completed",
    });
    const next = await app.manage({ type: "create", prompt: "new" });
    expect(next.cwd).not.toBe(state.cwd);
  });
});
