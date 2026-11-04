import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import {
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import type { ModelAdapter } from "@forge/core";
import { afterEach, expect, it } from "vitest";
import { RunChannel } from "../main/run-channel.js";
import type { RunCommand, RunEvent } from "../shared/run-protocol.js";
import { RunService } from "./run-service.js";
import { SessionApplication } from "./session-application.js";

const exec = promisify(execFile);
const roots: string[] = [];
afterEach(async () => {
  for (const root of roots.splice(0))
    await rm(root, { recursive: true, force: true });
});
const flush = () => new Promise((resolve) => setImmediate(resolve));

it("creates independent Git branches/worktrees, executes in parallel and preserves session histories", async () => {
  const root = await realpath(await mkdtemp(join(tmpdir(), "forge-parallel-")));
  roots.push(root);
  const cwd = join(root, "project");
  await mkdir(cwd);
  await exec("git", ["init", cwd]);
  await writeFile(join(cwd, "tracked.txt"), "committed\n");
  await exec("git", ["-C", cwd, "add", "tracked.txt"]);
  await exec("git", [
    "-C",
    cwd,
    "-c",
    "user.name=Fixture",
    "-c",
    "user.email=fixture@example.invalid",
    "commit",
    "-m",
    "fixture",
  ]);
  await writeFile(join(cwd, "tracked.txt"), "uncommitted\n");
  const releases: (() => void)[] = [];
  let entered = 0;
  const model: ModelAdapter = {
    async *stream() {
      entered++;
      await new Promise<void>((resolve) => releases.push(resolve));
      yield { type: "text.delta", text: "independent answer" };
      yield {
        type: "finish",
        finishReason: "stop",
        usage: {
          inputTokens: 1,
          outputTokens: 1,
          totalTokens: 2,
          reasoningTokens: 0,
          cachedInputTokens: 0,
          cacheWriteTokens: 0,
        },
      };
    },
  };
  const app = new SessionApplication(
    { FORGE_HOME: join(root, "home") },
    cwd,
    { createAdapter: () => model },
    (id) => (id ? service.hasSession(id) : service.busy),
  );
  const events: RunEvent[] = [];
  const channel = new RunChannel((command) => service.handle(command));
  const service = new RunService(
    (event) => channel.receive(event),
    app.execute,
  );
  let decision = 0;
  channel.subscribe((event) => {
    events.push(event);
    if (event.payload.type === "approval")
      void channel.request({
        type: "approve",
        sessionId: event.sessionId,
        runId: event.runId,
        requestId: `decision-${++decision}`,
        approvalId: event.payload.approvalId,
        ...(event.payload.descriptor
          ? { actionId: event.payload.descriptor.actionId }
          : {}),
        allow: true,
      });
  });
  try {
    await app.manage({ type: "workspace", cwd });
    const a = await app.manage({ type: "create", prompt: "task A" });
    const identity = (
      sessionId: string,
      suffix: string,
    ): Extract<RunCommand, { type: "start" }> => ({
      type: "start",
      sessionId,
      runId: randomUUID(),
      requestId: `request-${suffix}`,
      prompt: `task ${suffix}`,
      engine: "native",
    });
    expect(await channel.request(identity(a.sessionId, "A"))).toBe(true);
    await app.manage({ type: "reset", mode: "new" });
    const b = await app.manage({ type: "create", prompt: "task B" });
    expect(a.cwd).not.toBe(b.cwd);
    expect(await readFile(join(a.cwd, "tracked.txt"), "utf8")).toBe(
      "committed\n",
    );
    expect(await readFile(join(b.cwd, "tracked.txt"), "utf8")).toBe(
      "committed\n",
    );
    expect(await readFile(join(cwd, "tracked.txt"), "utf8")).toBe(
      "uncommitted\n",
    );
    expect(
      (
        await exec("git", ["-C", a.cwd, "branch", "--show-current"])
      ).stdout.trim(),
    ).toMatch(/^codex\/session-/);
    expect(await channel.request(identity(b.sessionId, "B"))).toBe(true);
    await flush();
    await expect.poll(() => entered).toBe(2);
    expect(
      (await app.manage({ type: "resume", sessionId: a.sessionId })).sessionId,
    ).toBe(a.sessionId);
    expect(
      (await app.manage({ type: "resume", sessionId: b.sessionId })).sessionId,
    ).toBe(b.sessionId);
    await expect(
      app.manage({ type: "delete-session", sessionId: a.sessionId }),
    ).rejects.toThrow("session-busy");
    for (const release of releases) release();
    await expect
      .poll(
        () =>
          events.filter((event) => event.payload.type === "complete").length,
      )
      .toBe(2);
    await expect.poll(() => service.busy).toBe(false);
    expect(
      events
        .filter((event) => event.payload.type === "complete")
        .map((event) => event.payload),
    ).toEqual([
      expect.objectContaining({ outcome: "completed" }),
      expect.objectContaining({ outcome: "completed" }),
    ]);
    expect((await app.state()).sessionId).toBe(b.sessionId);
    for (const session of [a, b]) {
      const resumed = await app.manage({
        type: "resume",
        sessionId: session.sessionId,
      });
      expect(
        resumed.messages.map((message) => message.content).join(" "),
      ).toContain("independent answer");
      expect(resumed.cwd).toBe(session.cwd);
    }
    await writeFile(join(a.cwd, "review-me.txt"), "A only");
    await expect(readFile(join(b.cwd, "review-me.txt"))).rejects.toThrow();
    await app.manage({ type: "delete-session", sessionId: a.sessionId });
    expect(await readFile(join(a.cwd, "review-me.txt"), "utf8")).toBe("A only");
  } finally {
    for (const release of releases) release();
    await service.drain();
    app.close();
    channel.disconnect();
  }
});
