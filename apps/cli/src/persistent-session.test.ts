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
import path from "node:path";
import { FileSessionStore, JsonlTraceWriter } from "@forge/persistence";
import { afterEach, describe, expect, it } from "vitest";

import {
  createPersistentInteractiveSession,
  PersistentInteractiveSession,
} from "./persistent-session.js";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe("persistent interactive session", () => {
  it("restores completed history after restart and appends a fresh run", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "forge-session-"));
    temporaryDirectories.push(root);
    await mkdir(path.join(root, ".git"));
    const env = { FORGE_HOME: path.join(root, "forge-home") };
    const first = await createPersistentInteractiveSession({ cwd: root, env });
    const sessionId = await first.prepareRun();
    const firstRunId = randomUUID();
    await first.recordRun(
      "first task",
      completed("first answer", "first reasoning"),
      {
        runId: firstRunId,
        sessionId,
        tracePersisted: true,
      },
    );

    const resumed = await createPersistentInteractiveSession({
      cwd: root,
      env,
      sessionId,
    });

    expect(resumed).toBeInstanceOf(PersistentInteractiveSession);
    expect(resumed.messages).toEqual([
      { role: "user", content: "first task" },
      { role: "assistant", content: "first answer" },
    ]);
    expect(resumed.reasoning).toEqual([
      { assistantMessageIndex: 1, content: "first reasoning" },
    ]);
    expect(resumed.historyEvents).toEqual([]);
    expect(await resumed.prepareRun()).toBe(sessionId);

    const secondRunId = randomUUID();
    await resumed.recordRun("second task", completed("second answer"), {
      runId: secondRunId,
      sessionId,
      tracePersisted: true,
    });
    const latest = await createPersistentInteractiveSession({
      cwd: root,
      env,
      last: true,
    });
    expect(latest.messages.at(-1)).toEqual({
      role: "assistant",
      content: "second answer",
    });
  });

  it("restores failed run intent and partial side effects after restart", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "forge-session-failed-"));
    temporaryDirectories.push(root);
    await mkdir(path.join(root, ".git"));
    const env = { FORGE_HOME: path.join(root, "forge-home") };
    const first = await createPersistentInteractiveSession({ cwd: root, env });
    const sessionId = await first.prepareRun();
    await first.recordRun(
      "Delete the old file and switch to retro styling",
      {
        status: "denied",
        exitCode: 4,
        finalText: "Deletion completed; styling remains.",
        modelSteps: 2,
        toolCalls: 2,
        message: "A later action was not approved.",
        events: [
          {
            type: "tool.completed",
            step: 1,
            call: {
              id: "delete-old",
              name: "run_command",
              input: { program: "rm", args: ["old.html"] },
            },
            result: { ok: true, output: {}, truncated: false },
          },
          {
            type: "tool.failed",
            step: 2,
            call: {
              id: "create-existing",
              name: "create_file",
              input: { path: "style.css", content: "omitted body" },
            },
            result: {
              ok: false,
              error: {
                code: "already_exists",
                message: "Use apply_patch instead.",
                retryable: true,
              },
            },
          },
        ],
      },
      {
        runId: randomUUID(),
        sessionId,
        tracePersisted: true,
      },
    );

    const resumed = await createPersistentInteractiveSession({
      cwd: root,
      env,
      sessionId,
    });

    expect(resumed.messages[0]?.content).toContain("retro styling");
    expect(resumed.messages[1]?.content).toContain(
      "Completed tools: run_command (program rm)",
    );
    expect(resumed.messages[1]?.content).toContain(
      "create_file (style.css) [already_exists]",
    );
    expect(resumed.messages[1]?.content).not.toContain("omitted body");
  });

  it("backfills legacy missing failed turns from complete run traces", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "forge-session-legacy-"));
    temporaryDirectories.push(root);
    await mkdir(path.join(root, ".git"));
    const forgeHome = path.join(root, "forge-home");
    const env = { FORGE_HOME: forgeHome };
    const sessionStore = new FileSessionStore(forgeHome);
    const workspaceRoot = await realpath(root);
    const snapshot = sessionStore.create({
      root: workspaceRoot,
      cwd: workspaceRoot,
    });
    const firstRunId = randomUUID();
    const deniedRunId = randomUUID();
    const retryRunId = randomUUID();
    await sessionStore.save({
      ...snapshot,
      messages: [
        { role: "user", content: "Create the game" },
        { role: "assistant", content: "Created." },
        { role: "user", content: "retry" },
        { role: "assistant", content: "Everything looks fine." },
      ],
      runIds: [firstRunId, deniedRunId, retryRunId],
    });

    const firstTrace = new JsonlTraceWriter({
      forgeHome,
      runId: firstRunId,
      sessionId: snapshot.id,
    });
    await firstTrace.append({ type: "run.started", prompt: "Create the game" });
    await firstTrace.append({ type: "model.text", step: 1, text: "Created." });
    await firstTrace.append({ type: "run.completed" });

    const deniedTrace = new JsonlTraceWriter({
      forgeHome,
      runId: deniedRunId,
      sessionId: snapshot.id,
    });
    await deniedTrace.append({
      type: "run.started",
      prompt: "Delete the old file and use retro styling",
    });
    await deniedTrace.append({
      type: "tool.completed",
      step: 1,
      call: {
        id: "delete-old",
        name: "run_command",
        input: { program: "rm", args: ["old.html"] },
      },
      result: { ok: true, output: {}, truncated: false },
    });
    await deniedTrace.append({
      type: "tool.failed",
      step: 2,
      call: {
        id: "create-existing",
        name: "create_file",
        input: { path: "style.css", content: "legacy body omitted" },
      },
      result: {
        ok: false,
        error: {
          code: "already_exists",
          message: "legacy raw error omitted",
          retryable: true,
        },
      },
    });
    await deniedTrace.append({
      type: "run.denied",
      message: "The action was not approved.",
    });

    const retryTrace = new JsonlTraceWriter({
      forgeHome,
      runId: retryRunId,
      sessionId: snapshot.id,
    });
    await retryTrace.append({ type: "run.started", prompt: "retry" });
    await retryTrace.append({
      type: "model.text",
      step: 1,
      text: "Everything looks fine.",
    });
    await retryTrace.append({ type: "run.completed" });

    const resumed = await createPersistentInteractiveSession({
      cwd: root,
      env,
      sessionId: snapshot.id,
    });

    expect(resumed.messages.map(({ content }) => content)).toEqual([
      "Create the game",
      "Created.",
      "Delete the old file and use retro styling",
      expect.stringContaining("Status: denied"),
      "retry",
      "Everything looks fine.",
    ]);
    expect(resumed.messages[3]?.content).toContain(
      "Completed tools: run_command (program rm)",
    );
    expect(resumed.messages[3]?.content).toContain(
      "create_file (style.css) [already_exists]",
    );
    expect(resumed.messages[3]?.content).not.toContain("legacy body omitted");
    expect(resumed.messages[3]?.content).not.toContain("legacy raw error");
    expect(resumed.historyEvents?.map(({ type }) => type)).toEqual([
      "run.started",
      "model.text",
      "run.completed",
      "run.started",
      "tool.completed",
      "tool.failed",
      "run.denied",
      "run.started",
      "model.text",
      "run.completed",
    ]);

    const migrated = await sessionStore.load(snapshot.id);
    expect(migrated.messages).toEqual(resumed.messages);
  });

  it("backfills reasoning from older run traces during resume", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "forge-session-trace-"));
    temporaryDirectories.push(root);
    await mkdir(path.join(root, ".git"));
    const workspaceRoot = await realpath(root);
    const forgeHome = path.join(root, "forge-home");
    const env = { FORGE_HOME: forgeHome };
    const sessionStore = new FileSessionStore(forgeHome);
    const snapshot = sessionStore.create({
      root: workspaceRoot,
      cwd: workspaceRoot,
    });
    const runId = randomUUID();
    await sessionStore.save({
      ...snapshot,
      messages: [
        { role: "user", content: "old task" },
        { role: "assistant", content: "old answer" },
      ],
      runIds: [runId],
    });
    const trace = new JsonlTraceWriter({
      forgeHome,
      runId,
      sessionId: snapshot.id,
    });
    await trace.append({ type: "run.started", prompt: "old task" });
    await trace.append({
      type: "model.reasoning",
      step: 1,
      text: "old reasoning",
    });
    await trace.append({ type: "model.text", step: 1, text: "old answer" });
    await trace.append({ type: "run.completed" });

    const resumed = await createPersistentInteractiveSession({
      cwd: root,
      env,
      sessionId: snapshot.id,
    });

    expect(resumed.reasoning).toEqual([
      { assistantMessageIndex: 1, content: "old reasoning" },
    ]);
  });

  it("persists the original unavailable-reasoning status for resume", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "forge-session-hidden-"));
    temporaryDirectories.push(root);
    await mkdir(path.join(root, ".git"));
    const env = { FORGE_HOME: path.join(root, "forge-home") };
    const session = await createPersistentInteractiveSession({
      cwd: root,
      env,
    });

    await session.recordRun(
      "hidden reasoning task",
      {
        ...completed("hidden reasoning answer"),
        events: [
          {
            type: "model.reasoning-unavailable",
            step: 1,
            reasoningTokens: 42,
          },
        ],
      },
      {
        runId: randomUUID(),
        sessionId: await session.prepareRun(),
        tracePersisted: false,
      },
    );

    expect(session.reasoning).toEqual([
      {
        assistantMessageIndex: 1,
        content:
          "Provider used 42 reasoning tokens but did not return reasoning text.",
      },
    ]);
  });

  it("enables pressure-driven compaction for one session without restoring the mode", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "forge-session-auto-"));
    temporaryDirectories.push(root);
    await mkdir(path.join(root, ".git"));
    const env = { FORGE_HOME: path.join(root, "forge-home") };
    const session = await createPersistentInteractiveSession({
      cwd: root,
      env,
    });
    session.selectModel("fake", "fake-small", 20_000);
    for (let turn = 0; turn < 10; turn += 1) {
      await session.recordRun(
        `Goal and constraints ${turn}: ${"repository context ".repeat(180)}`,
        completed(
          `Touched src/file-${turn}.ts. Unresolved work remains. ${"verification provenance ".repeat(180)}`,
        ),
        {
          runId: randomUUID(),
          sessionId: await session.prepareRun(),
          tracePersisted: false,
        },
      );
    }
    expect(session.contextDetails("continue").pressure.ratio).toBeGreaterThan(
      0.78,
    );
    session.setContextModeForSession("automatic");
    expect(session.contextDetails().pressure.mode).toBe("automatic-session");

    const id = await session.prepareRun("continue");
    expect(session.contextCheckpoint).toBeDefined();

    const resumed = await createPersistentInteractiveSession({
      cwd: root,
      env,
      sessionId: id,
    });
    expect(resumed.contextDetails().pressure.mode).toBe("manual");
    expect(resumed.contextCheckpoint).toBeDefined();
  });

  it("persists automatic compaction only after an explicit user action", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "forge-session-default-"));
    temporaryDirectories.push(root);
    await mkdir(path.join(root, ".git"));
    const forgeHome = path.join(root, "forge-home");
    const env = { FORGE_HOME: forgeHome };
    const session = await createPersistentInteractiveSession({
      cwd: root,
      env,
    });
    session.setContextModeForSession("automatic");
    await expect(
      readFile(path.join(forgeHome, "config.json"), "utf8"),
    ).rejects.toThrow();
    const saved = await session.saveContextModeDefault("automatic");
    expect(saved.path).toBe(path.join(forgeHome, "config.json"));
    expect(saved.effectiveMode).toBe("automatic");
    expect(JSON.parse(await readFile(saved.path, "utf8"))).toMatchObject({
      context: { mode: "automatic" },
    });

    session.setContextModeForSession("manual");
    expect(session.contextDetails().pressure.mode).toBe("manual");
    const manualSaved = await session.saveContextModeDefault("manual");
    expect(manualSaved.savedMode).toBe("manual");
    expect(JSON.parse(await readFile(manualSaved.path, "utf8"))).toMatchObject({
      context: { mode: "manual" },
    });
  });

  it("preserves unrelated user config and reports stricter project provenance", async () => {
    const root = await mkdtemp(
      path.join(tmpdir(), "forge-session-provenance-"),
    );
    temporaryDirectories.push(root);
    const forgeHome = path.join(root, "forge-home");
    await mkdir(path.join(root, ".git"));
    await mkdir(path.join(root, ".forge"));
    await mkdir(forgeHome);
    await writeFile(
      path.join(forgeHome, "config.json"),
      `${JSON.stringify({ schemaVersion: 1, context: { mode: "automatic" }, limits: { maxSteps: 9 } }, null, 2)}\n`,
    );
    await writeFile(
      path.join(root, ".forge", "config.json"),
      `${JSON.stringify({ schemaVersion: 1, context: { mode: "automatic" } }, null, 2)}\n`,
    );
    const session = await createPersistentInteractiveSession({
      cwd: root,
      env: { FORGE_HOME: forgeHome },
    });

    const saved = await session.saveContextModeDefault("manual");

    expect(saved).toMatchObject({
      savedMode: "manual",
      effectiveMode: "automatic",
    });
    expect(saved.effectiveSource).toContain(".forge/config.json");
    expect(JSON.parse(await readFile(saved.path, "utf8"))).toMatchObject({
      context: { mode: "manual" },
      limits: { maxSteps: 9 },
    });
  });
});

function completed(finalText: string, reasoning = "") {
  return {
    status: "completed" as const,
    exitCode: 0,
    finalText,
    modelSteps: 1,
    toolCalls: 0,
    events: reasoning
      ? [{ type: "model.reasoning" as const, step: 1, text: reasoning }]
      : [],
  };
}
