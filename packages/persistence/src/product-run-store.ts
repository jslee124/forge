import { randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { lstat, mkdir, open, realpath, rename, unlink } from "node:fs/promises";
import { join, resolve } from "node:path";
import { z } from "zod";
import {
  productIdSchema as id,
  type ProductRecordEvent,
  type ProductRecordPayload,
  type ProductRunRecord,
  type ProductRunSummary,
  productCompletionSchema,
  productRecordEventSchema,
  productRunSummarySchema,
  productTimestampSchema as timestamp,
} from "./product-run-schema.js";
import { redactValue } from "./redaction.js";

const indexEntrySchema = z.object({ runId: id, startedAt: timestamp }).strict();
const MAX_SUMMARY = 256 * 1024;
export const MAX_PRODUCT_JOURNAL = 16 * 1024 * 1024;
const CONTROL_RESERVE = 1024 * 1024;
const noFollow = constants.O_NOFOLLOW ?? 0;
function missing(error: unknown) {
  return error instanceof Error && "code" in error && error.code === "ENOENT";
}
export class ProductRunStorageError extends Error {
  constructor(options?: ErrorOptions) {
    super("product-run-storage-failed", options);
  }
}

/** Local presentation records only: no approval grants, continuations, or replay API. */
export class FileProductRunStore {
  readonly #home: string;
  readonly #secrets: readonly string[];
  #canonicalHome: string | undefined;
  constructor(home: string, options: { secrets?: readonly string[] } = {}) {
    this.#home = resolve(home);
    this.#secrets = options.secrets ?? [];
  }
  async #directory(parts: string[], create: boolean): Promise<string> {
    for (const part of parts) id.parse(part);
    if (create) await mkdir(this.#home, { recursive: true, mode: 0o700 });
    const home = await realpath(this.#home);
    if (this.#canonicalHome && this.#canonicalHome !== home)
      throw new ProductRunStorageError();
    this.#canonicalHome = home;
    let directory = home;
    for (const part of ["run-records", ...parts]) {
      directory = join(directory, part);
      if (create)
        await mkdir(directory, { mode: 0o700 }).catch((error: unknown) => {
          if (
            !(
              error instanceof Error &&
              "code" in error &&
              error.code === "EEXIST"
            )
          )
            throw error;
        });
      await this.#assertDirectory(directory);
    }
    return directory;
  }
  async #assertDirectory(directory: string) {
    const metadata = await lstat(directory);
    if (
      !metadata.isDirectory() ||
      metadata.isSymbolicLink() ||
      (await realpath(directory)) !== directory
    )
      throw new ProductRunStorageError();
  }
  async #openRegular(file: string, flags: number, allowMissing = false) {
    // O_NOFOLLOW is unavailable on Windows. Check the directory entry as well
    // as the opened handle before reading or writing any user-controlled file.
    const checkEntry = async () => {
      const metadata = await lstat(file);
      if (
        !metadata.isFile() ||
        metadata.isSymbolicLink() ||
        (await realpath(file)) !== file
      )
        throw new ProductRunStorageError();
      return metadata;
    };
    await checkEntry().catch((error) => {
      if (!allowMissing || !missing(error)) throw error;
    });
    const handle = await open(file, flags | noFollow, 0o600);
    try {
      const entry = await checkEntry();
      const opened = await handle.stat();
      if (
        !opened.isFile() ||
        opened.dev !== entry.dev ||
        opened.ino !== entry.ino
      )
        throw new ProductRunStorageError();
      return handle;
    } catch (error) {
      await handle.close();
      throw error;
    }
  }
  async #read(file: string, max: number): Promise<string> {
    const handle = await this.#openRegular(file, constants.O_RDONLY);
    try {
      const metadata = await handle.stat();
      if (!metadata.isFile() || metadata.size > max)
        throw new ProductRunStorageError();
      const buffer = Buffer.alloc(metadata.size);
      let offset = 0;
      while (offset < buffer.length) {
        const { bytesRead } = await handle.read(
          buffer,
          offset,
          buffer.length - offset,
          offset,
        );
        if (!bytesRead) throw new ProductRunStorageError();
        offset += bytesRead;
      }
      return buffer.toString("utf8");
    } finally {
      await handle.close();
    }
  }
  async #atomic(directory: string, value: ProductRunSummary) {
    await this.#assertDirectory(directory);
    const serialized = `${JSON.stringify(productRunSummarySchema.parse(redactValue(value, this.#secrets)))}\n`;
    if (Buffer.byteLength(serialized) > MAX_SUMMARY)
      throw new ProductRunStorageError();
    const target = join(directory, "summary.json");
    const existing = await lstat(target).catch((error: unknown) => {
      if (!missing(error)) throw error;
    });
    if (existing && (!existing.isFile() || existing.isSymbolicLink()))
      throw new ProductRunStorageError();
    const temporary = join(directory, `${randomUUID()}.tmp`);
    try {
      const handle = await open(
        temporary,
        constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | noFollow,
        0o600,
      );
      try {
        await handle.writeFile(serialized);
        await handle.sync();
      } finally {
        await handle.close();
      }
      await this.#assertDirectory(directory);
      await rename(temporary, target);
      await this.#syncDirectory(directory);
    } finally {
      await unlink(temporary).catch(() => {});
    }
  }
  async #syncDirectory(directory: string) {
    if (process.platform === "win32") return;
    const handle = await open(directory, constants.O_RDONLY | noFollow);
    try {
      await handle.sync();
    } finally {
      await handle.close();
    }
  }
  async #append(directory: string, name: string, line: string, max: number) {
    await this.#assertDirectory(directory);
    const handle = await this.#openRegular(
      join(directory, name),
      constants.O_WRONLY | constants.O_APPEND | constants.O_CREAT,
      true,
    );
    try {
      const metadata = await handle.stat();
      if (!metadata.isFile() || metadata.size + Buffer.byteLength(line) > max)
        throw new ProductRunStorageError();
      await handle.writeFile(line);
      await handle.sync();
    } finally {
      await handle.close();
    }
  }
  async create(
    input: Pick<
      ProductRunSummary,
      "sessionId" | "runId" | "engine" | "prompt" | "recovery"
    >,
  ): Promise<ProductRunWriter> {
    try {
      const session = await this.#directory([input.sessionId], true);
      const directory = join(session, id.parse(input.runId));
      await mkdir(directory, { mode: 0o700 }); // Never overwrite/reopen an existing run.
      const now = new Date().toISOString();
      const summary = productRunSummarySchema.parse(
        redactValue(
          {
            ...input,
            prompt: input.prompt.slice(0, 2048),
            schemaVersion: 1,
            startedAt: now,
            updatedAt: now,
            state: "running",
            sequence: 0,
            omittedCharacters: 0,
            omittedEvents: 0,
          },
          this.#secrets,
        ),
      );
      await this.#atomic(directory, summary);
      await this.#append(
        session,
        "index.jsonl",
        `${JSON.stringify({ runId: summary.runId, startedAt: now })}\n`,
        Number.MAX_SAFE_INTEGER,
      );
      return new ProductRunWriter(
        summary,
        async (event, critical) => {
          const clean = productRecordEventSchema.parse(
            redactValue(event, this.#secrets),
          );
          await this.#append(
            await this.#directory([input.sessionId, input.runId], false),
            "events.jsonl",
            `${JSON.stringify(clean)}\n`,
            critical
              ? MAX_PRODUCT_JOURNAL
              : MAX_PRODUCT_JOURNAL - CONTROL_RESERVE,
          );
        },
        async (next) =>
          this.#atomic(
            await this.#directory([input.sessionId, input.runId], false),
            next,
          ),
      );
    } catch (cause) {
      throw new ProductRunStorageError({ cause });
    }
  }
  /** Reads a bounded tail of the ASCII index, then only this page's summaries. */
  async list(
    sessionId: string,
    before?: number,
  ): Promise<{ runs: ProductRunSummary[]; nextCursor?: number }> {
    let indexAvailable = false;
    try {
      const directory = await this.#directory([sessionId], false);
      const handle = await this.#openRegular(
        join(directory, "index.jsonl"),
        constants.O_RDONLY,
      );
      indexAvailable = true;
      let entries: { runId: string; start: number }[];
      try {
        const metadata = await handle.stat();
        if (!metadata.isFile()) throw new ProductRunStorageError();
        const end = before ?? metadata.size;
        if (!Number.isSafeInteger(end) || end < 0 || end > metadata.size)
          throw new ProductRunStorageError();
        const start = Math.max(0, end - 16_384);
        const buffer = Buffer.alloc(end - start);
        const { bytesRead } = await handle.read(
          buffer,
          0,
          buffer.length,
          start,
        );
        if (bytesRead !== buffer.length) throw new ProductRunStorageError();
        const content = buffer.toString("utf8");
        entries = [];
        let position = start;
        for (const [index, line] of content.split("\n").entries()) {
          const lineStart = position;
          position += Buffer.byteLength(line) + 1;
          if ((start > 0 && index === 0) || !line) continue;
          if (position > end) throw new ProductRunStorageError();
          const entry = indexEntrySchema.parse(JSON.parse(line));
          entries.push({ runId: entry.runId, start: lineStart });
        }
      } finally {
        await handle.close();
      }
      const page = entries.slice(-20).reverse();
      const runs = await Promise.all(
        page.map(async ({ runId }) => await this.#summary(sessionId, runId)),
      );
      const cursor = page.at(-1)?.start;
      return { runs, ...(cursor ? { nextCursor: cursor } : {}) };
    } catch (cause) {
      if (!indexAvailable && before === undefined && missing(cause))
        return { runs: [] };
      throw new ProductRunStorageError({ cause });
    }
  }
  async #summary(sessionId: string, runId: string): Promise<ProductRunSummary> {
    const directory = await this.#directory([sessionId, runId], false);
    const summary = productRunSummarySchema.parse(
      JSON.parse(
        await this.#read(join(directory, "summary.json"), MAX_SUMMARY),
      ),
    );
    if (summary.sessionId !== sessionId || summary.runId !== runId)
      throw new ProductRunStorageError();
    return summary;
  }
  async read(sessionId: string, runId: string): Promise<ProductRunRecord> {
    try {
      const summary = await this.#summary(sessionId, runId);
      const directory = await this.#directory([sessionId, runId], false);
      let content: string;
      try {
        content = await this.#read(
          join(directory, "events.jsonl"),
          MAX_PRODUCT_JOURNAL,
        );
      } catch (cause) {
        if (!missing(cause)) throw cause;
        content = "";
      }
      const events: ProductRecordEvent[] = [];
      let incomplete = false;
      const lines = content.split("\n");
      for (let index = 0; index < lines.length; index++) {
        const line = lines[index];
        if (!line && index === lines.length - 1) break;
        try {
          if (index === lines.length - 1) throw new Error("partial-last-line");
          const event = productRecordEventSchema.parse(JSON.parse(line ?? ""));
          if (event.sequence !== events.length + 1)
            throw new Error("sequence-gap");
          events.push(event);
        } catch {
          incomplete = true;
          break;
        }
      }
      if (summary.state === "finished" && summary.sequence !== events.length)
        incomplete = true;
      return {
        summary: redactValue(summary, this.#secrets) as ProductRunSummary,
        events: redactValue(events, this.#secrets) as ProductRecordEvent[],
        incomplete,
      };
    } catch (cause) {
      throw new ProductRunStorageError({ cause });
    }
  }
  /** Caller holds the session execution lease; this never starts/resumes an effect. */
  async reconcile(
    sessionId: string,
    canonicalRunIds: readonly string[],
  ): Promise<void> {
    let cursor: number | undefined;
    do {
      const page = await this.list(sessionId, cursor);
      for (const summary of page.runs) {
        if (summary.state === "finished") {
          if (
            summary.completion?.outcome === "completed" &&
            !canonicalRunIds.includes(summary.runId)
          ) {
            await this.#atomic(
              await this.#directory([sessionId, summary.runId], false),
              {
                ...summary,
                updatedAt: new Date().toISOString(),
                completion: { outcome: "interrupted", reason: "storage_error" },
              },
            );
          }
          continue;
        }
        const record = await this.read(sessionId, summary.runId);
        const last = record.events.at(-1)?.payload;
        const completion =
          !record.incomplete &&
          canonicalRunIds.includes(summary.runId) &&
          last?.type === "result"
            ? last.completion
            : {
                outcome: "interrupted" as const,
                reason: "disconnected" as const,
              };
        await this.#atomic(
          await this.#directory([sessionId, summary.runId], false),
          {
            ...summary,
            sequence: record.events.length,
            state: "finished",
            updatedAt: new Date().toISOString(),
            completion,
            ...(record.incomplete ? { journalIncomplete: true } : {}),
          },
        );
      }
      cursor = page.nextCursor;
    } while (cursor !== undefined);
  }
}

/** Coalesces noncritical fragments. Every awaited control write flushes preceding text. */
export class ProductRunWriter {
  #summary: ProductRunSummary;
  #bytes = 0;
  #failed = false;
  #finished = false;
  #buffer:
    | Extract<ProductRecordPayload, { type: "text" | "detail" }>
    | undefined;
  readonly #segmentCharacters = new Map<string, number>();
  constructor(
    summary: ProductRunSummary,
    readonly append: (
      event: ProductRecordEvent,
      critical: boolean,
    ) => Promise<void>,
    readonly save: (summary: ProductRunSummary) => Promise<void>,
  ) {
    this.#summary = summary;
  }
  get failed() {
    return this.#failed;
  }
  get summary() {
    return this.#summary;
  }
  noteOmission(characters: number, event = false): void {
    this.#summary.omittedCharacters += characters;
    if (event) this.#summary.omittedEvents++;
  }
  async record(payload: ProductRecordPayload): Promise<void> {
    if (this.#failed || this.#finished) throw new ProductRunStorageError();
    try {
      if (
        payload.type === "text" ||
        (payload.type === "detail" && payload.kind === "reasoning")
      ) {
        const key =
          payload.type === "text" ? "answer" : `reasoning:${payload.step ?? 0}`;
        const used = this.#segmentCharacters.get(key) ?? 0;
        const limit = payload.type === "text" ? 1_048_576 : 65_536;
        const text = payload.text.slice(0, Math.max(0, limit - used));
        this.#segmentCharacters.set(key, used + text.length);
        this.#summary.omittedCharacters += payload.text.length - text.length;
        if (!text) return;
        if (
          this.#buffer &&
          (this.#buffer.type !== payload.type ||
            (this.#buffer.type === "detail" &&
              payload.type === "detail" &&
              this.#buffer.step !== payload.step))
        )
          await this.#flush();
        for (let offset = 0; offset < text.length; ) {
          const capacity = 16_384 - (this.#buffer?.text.length ?? 0);
          const fragment = text.slice(offset, offset + capacity);
          offset += fragment.length;
          const truncated = text.length < payload.text.length;
          this.#buffer = this.#buffer
            ? {
                ...this.#buffer,
                text: this.#buffer.text + fragment,
                truncated: Boolean(this.#buffer.truncated || truncated),
              }
            : {
                ...payload,
                text: fragment,
                ...(truncated ? { truncated: true } : {}),
              };
          if (this.#buffer.text.length >= 16_384) await this.#flush();
        }
        return;
      }
      await this.#flush();
      await this.#write(payload, true);
    } catch (cause) {
      this.#failed = true;
      throw new ProductRunStorageError({ cause });
    }
  }
  async #flush() {
    const buffer = this.#buffer;
    this.#buffer = undefined;
    if (buffer) await this.#write(buffer, false);
  }
  async #write(payload: ProductRecordPayload, critical: boolean) {
    const event = productRecordEventSchema.parse({
      sequence: this.#summary.sequence + 1,
      occurredAt: new Date().toISOString(),
      payload,
    });
    const bytes = Buffer.byteLength(JSON.stringify(event)) + 1;
    if (
      !critical &&
      this.#bytes + bytes > MAX_PRODUCT_JOURNAL - CONTROL_RESERVE
    ) {
      this.#summary.omittedEvents++;
      return;
    }
    await this.append(event, critical);
    this.#bytes += bytes;
    this.#summary.sequence = event.sequence;
  }
  /** Canonical session must already have committed before finishing successfully. */
  async finish(
    completion: z.infer<typeof productCompletionSchema>,
  ): Promise<void> {
    if (this.#failed || this.#finished) throw new ProductRunStorageError();
    try {
      await this.#flush();
      this.#summary = {
        ...this.#summary,
        state: "finished",
        updatedAt: new Date().toISOString(),
        completion: productCompletionSchema.parse(completion),
      };
      await this.save(this.#summary);
      this.#finished = true;
    } catch (cause) {
      this.#failed = true;
      throw new ProductRunStorageError({ cause });
    }
  }
}
