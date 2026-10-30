import {
  appendFile,
  lstat,
  mkdtemp,
  readFile,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { ProductRecordEvent } from "./product-run-schema.js";
import {
  FileProductRunStore,
  MAX_PRODUCT_JOURNAL,
  ProductRunStorageError,
  ProductRunWriter,
} from "./product-run-store.js";

const roots: string[] = [];
async function fixture() {
  const home = await mkdtemp(join(tmpdir(), "forge-product-record-"));
  roots.push(home);
  const store = new FileProductRunStore(home, {
    secrets: ["very-private-key"],
  });
  return {
    home,
    store,
    path: (runId = "run") => join(home, "run-records", "session", runId),
  };
}
afterEach(async () => {
  for (const root of roots.splice(0))
    await rm(root, { recursive: true, force: true });
});
describe("private product run records", () => {
  it.each(["summary", "index"])(
    "rejects a symlinked %s even when its target contains valid record data",
    async (kind) => {
      const f = await fixture();
      await f.store.create({
        sessionId: "session",
        runId: "run",
        engine: "native",
        prompt: "links",
      });
      const source =
        kind === "summary"
          ? join(f.path(), "summary.json")
          : join(f.home, "run-records", "session", "index.jsonl");
      const bytes = await readFile(source);
      const target = join(f.home, "outside-record");
      await writeFile(target, bytes);
      await rm(source);
      await symlink(target, source);
      await expect(
        kind === "summary"
          ? f.store.read("session", "run")
          : f.store.list("session"),
      ).rejects.toBeInstanceOf(ProductRunStorageError);
      expect(await readFile(target)).toEqual(bytes);
    },
  );
  it("saves redacted ordered facts privately and never reopens an existing run", async () => {
    const f = await fixture();
    const writer = await f.store.create({
      sessionId: "session",
      runId: "run",
      engine: "native",
      prompt: "very-private-key",
    });
    await writer.record({
      type: "action",
      action: {
        actionId: "call",
        tool: "edit_file",
        step: 1,
        status: "running",
        input: "very-private-key",
      },
    });
    await writer.record({
      type: "approval",
      approvalId: "approval",
      description: "very-private-key",
    });
    await writer.record({
      type: "decision",
      approvalId: "approval",
      allow: false,
    });
    await writer.record({ type: "result", completion: { outcome: "denied" } });
    await writer.finish({ outcome: "denied" });
    const record = await f.store.read("session", "run");
    expect(record.events.map((e) => e.sequence)).toEqual([1, 2, 3, 4]);
    expect(record.summary.completion?.outcome).toBe("denied");
    expect(JSON.stringify(record)).not.toContain("very-private-key");
    if (process.platform !== "win32") {
      expect((await lstat(f.path())).mode & 0o777).toBe(0o700);
      expect((await lstat(join(f.path(), "events.jsonl"))).mode & 0o777).toBe(
        0o600,
      );
      expect((await lstat(join(f.path(), "summary.json"))).mode & 0o777).toBe(
        0o600,
      );
    }
    await expect(
      f.store.create({
        sessionId: "session",
        runId: "run",
        engine: "native",
        prompt: "duplicate",
      }),
    ).rejects.toBeInstanceOf(ProductRunStorageError);
  });
  it("recovers an unfinished run as interrupted, including partial trailing data", async () => {
    const f = await fixture();
    const writer = await f.store.create({
      sessionId: "session",
      runId: "run",
      engine: "native",
      prompt: "crash",
    });
    await writer.record({
      type: "action",
      action: {
        actionId: "call",
        tool: "run_command",
        step: 1,
        status: "running",
        input: "{}",
      },
    });
    await appendFile(join(f.path(), "events.jsonl"), '{"sequence":2');
    await f.store.reconcile("session", []);
    const restored = await f.store.read("session", "run");
    expect(restored.summary.completion).toMatchObject({
      outcome: "interrupted",
      reason: "disconnected",
    });
    expect(restored.summary.journalIncomplete).toBe(true);
    expect(restored.events).toHaveLength(1);
  });
  it("only recovers a terminal intent when canonical history confirms that run", async () => {
    const f = await fixture();
    for (const runId of ["committed", "uncommitted"]) {
      const writer = await f.store.create({
        sessionId: "session",
        runId,
        engine: "native",
        prompt: "intent",
      });
      await writer.record({
        type: "result",
        completion: { outcome: "completed", modelSteps: 2 },
      });
    }
    await f.store.reconcile("session", ["committed"]);
    expect(
      (await f.store.read("session", "committed")).summary.completion?.outcome,
    ).toBe("completed");
    expect(
      (await f.store.read("session", "uncommitted")).summary.completion
        ?.outcome,
    ).toBe("interrupted");
  });
  it("does not hide an indexed missing record as empty history or trust uncommitted completion", async () => {
    const f = await fixture();
    const writer = await f.store.create({
      sessionId: "session",
      runId: "run",
      engine: "native",
      prompt: "uncommitted",
    });
    await writer.record({
      type: "result",
      completion: { outcome: "completed" },
    });
    await writer.finish({ outcome: "completed" });
    await f.store.reconcile("session", []);
    expect(
      (await f.store.read("session", "run")).summary.completion,
    ).toMatchObject({ outcome: "interrupted", reason: "storage_error" });
    await rm(join(f.path(), "summary.json"));
    await expect(f.store.list("session")).rejects.toBeInstanceOf(
      ProductRunStorageError,
    );
  });
  it("splits oversized text fragments into bounded journal records", async () => {
    const f = await fixture();
    const writer = await f.store.create({
      sessionId: "session",
      runId: "run",
      engine: "native",
      prompt: "large chunk",
    });
    await writer.record({ type: "text", text: "x".repeat(100_000) });
    await writer.finish({ outcome: "completed" });
    const record = await f.store.read("session", "run");
    expect(
      record.events
        .filter((e) => e.payload.type === "text")
        .map((e) => (e.payload.type === "text" ? e.payload.text : ""))
        .join(""),
    ).toHaveLength(100_000);
  });
  it("coalesces 10,000 fragments, labels truncation, and preserves the terminal event", async () => {
    const f = await fixture();
    const writer = await f.store.create({
      sessionId: "session",
      runId: "run",
      engine: "native",
      prompt: "pressure",
    });
    for (let index = 0; index < 10_000; index++)
      await writer.record({
        type: "detail",
        kind: "reasoning",
        step: 1,
        text: "x".repeat(10),
      });
    await writer.record({
      type: "result",
      completion: { outcome: "limit_reached" },
    });
    await writer.finish({ outcome: "limit_reached" });
    const record = await f.store.read("session", "run");
    expect(record.events.length).toBeLessThan(10);
    expect(record.summary.omittedCharacters).toBe(100_000 - 65_536);
    expect(record.events.at(-1)?.payload.type).toBe("result");
  });
  it("keeps critical space when optional journal output reaches its quota", async () => {
    const f = await fixture();
    const seed = await f.store.create({
      sessionId: "session",
      runId: "run",
      engine: "native",
      prompt: "quota",
    });
    const events: ProductRecordEvent[] = [];
    const writer = new ProductRunWriter(
      seed.summary,
      async (event) => {
        events.push(event);
      },
      async () => {},
    );
    for (let index = 1; index <= 100; index++)
      await writer.record({
        type: "detail",
        kind: "reasoning",
        step: index,
        text: "中".repeat(65_536),
      });
    await writer.record({
      type: "approval",
      approvalId: "critical",
      description: "decision required",
    });
    await writer.record({
      type: "result",
      completion: { outcome: "limit_reached" },
    });
    await writer.finish({ outcome: "limit_reached" });
    expect(writer.summary.omittedEvents).toBeGreaterThan(0);
    expect(events.at(-2)?.payload.type).toBe("approval");
    expect(events.at(-1)?.payload.type).toBe("result");
    expect(
      Buffer.byteLength(events.map((e) => JSON.stringify(e)).join("\n")),
    ).toBeLessThan(MAX_PRODUCT_JOURNAL);
  });
  it("paginates the index without returning duplicates or loading all journals", async () => {
    const f = await fixture();
    for (let index = 0; index < 25; index++)
      await f.store.create({
        sessionId: "session",
        runId: `run-${index}`,
        engine: "native",
        prompt: "page",
      });
    const first = await f.store.list("session");
    const second = await f.store.list("session", first.nextCursor);
    expect(first.runs).toHaveLength(20);
    expect(second.runs).toHaveLength(5);
    expect(
      new Set([...first.runs, ...second.runs].map((r) => r.runId)).size,
    ).toBe(25);
    expect(second.nextCursor).toBeUndefined();
  });
  it("rejects path traversal and symlinked directories or files without touching targets", async () => {
    const f = await fixture();
    await expect(
      f.store.create({
        sessionId: "../outside",
        runId: "run",
        engine: "native",
        prompt: "invalid",
      }),
    ).rejects.toThrow();
    const writer = await f.store.create({
      sessionId: "session",
      runId: "run",
      engine: "native",
      prompt: "links",
    });
    const target = join(f.home, "target");
    await writeFile(target, "do not touch");
    await symlink(target, join(f.path(), "events.jsonl"));
    await expect(
      writer.record({
        type: "action",
        action: {
          actionId: "call",
          tool: "edit_file",
          step: 1,
          status: "running",
          input: "{}",
        },
      }),
    ).rejects.toBeInstanceOf(ProductRunStorageError);
    expect(await readFile(target, "utf8")).toBe("do not touch");
    await rm(join(f.home, "run-records"), { recursive: true });
    await symlink(f.home, join(f.home, "run-records"), "dir");
    await expect(
      f.store.create({
        sessionId: "session",
        runId: "second",
        engine: "native",
        prompt: "links",
      }),
    ).rejects.toBeInstanceOf(ProductRunStorageError);
  });
  it("fails closed after any critical write error", async () => {
    const f = await fixture();
    const seed = await f.store.create({
      sessionId: "session",
      runId: "run",
      engine: "native",
      prompt: "failure",
    });
    let writes = 0;
    const writer = new ProductRunWriter(
      seed.summary,
      async () => {
        writes++;
        throw new Error("disk unavailable");
      },
      async () => {},
    );
    await expect(
      writer.record({
        type: "approval",
        approvalId: "once",
        description: "test",
      }),
    ).rejects.toBeInstanceOf(ProductRunStorageError);
    await expect(
      writer.record({ type: "decision", approvalId: "once", allow: true }),
    ).rejects.toBeInstanceOf(ProductRunStorageError);
    expect(writes).toBe(1);
    expect(writer.failed).toBe(true);
  });
});
