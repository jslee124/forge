import { randomUUID } from "node:crypto";
import { mkdir, open, readFile, rename, unlink } from "node:fs/promises";
import { dirname, join } from "node:path";
import { z } from "zod";

const taskSchema = z
  .object({
    id: z.string().uuid(),
    conversationId: z.string().max(256),
    state: z.enum([
      "accepted",
      "running",
      "awaiting_approval",
      "completed",
      "failed",
      "cancelled",
      "interrupted",
    ]),
    updatedAt: z.number(),
  })
  .strict();
const deliverySchema = z
  .object({
    id: z.string().uuid(),
    conversationId: z.string().max(256),
    text: z.string().max(20000),
    kind: z.enum(["notice", "progress", "approval", "terminal"]),
    buttons: z
      .array(z.object({ label: z.string(), data: z.string().max(64) }).strict())
      .max(2)
      .optional(),
    attempts: z.number().int().min(0).max(6),
    nextAttemptAt: z.number(),
    failed: z.boolean(),
  })
  .strict();
export const gatewayStateSchema = z
  .object({
    schemaVersion: z.literal(1),
    binding: z.string(),
    offset: z.number().int().min(0),
    sessionId: z.string().uuid().optional(),
    conversationId: z.string().max(256).optional(),
    task: taskSchema.optional(),
    inbox: z
      .array(z.object({ key: z.string().max(1024), at: z.number() }).strict())
      .max(10000),
    outbox: z.array(deliverySchema).max(100),
    connection: z.enum(["disconnected", "reconnecting", "connected"]),
    updatedAt: z.number(),
  })
  .strict();
export type GatewayState = z.infer<typeof gatewayStateSchema>;
export type GatewayDelivery = GatewayState["outbox"][number];
export type GatewayTask = NonNullable<GatewayState["task"]>;

export async function writePrivateJson(
  file: string,
  value: unknown,
): Promise<void> {
  await mkdir(dirname(file), { recursive: true, mode: 0o700 });
  const temporary = `${file}.${randomUUID()}.tmp`;
  const handle = await open(temporary, "wx", 0o600);
  try {
    await handle.writeFile(`${JSON.stringify(value)}\n`);
    await handle.sync();
  } finally {
    await handle.close();
  }
  try {
    await rename(temporary, file);
  } finally {
    await unlink(temporary).catch(() => {});
  }
  // Persist the rename where the platform supports directory fsync.
  if (process.platform !== "win32") {
    const directory = await open(dirname(file), "r");
    try {
      await directory.sync();
    } finally {
      await directory.close();
    }
  }
}

export class GatewayStore {
  readonly path: string;
  #tail: Promise<void> = Promise.resolve();
  constructor(home: string) {
    this.path = join(home, "gateway", "state.json");
  }
  async load(binding: string): Promise<GatewayState> {
    let raw: string;
    try {
      raw = await readFile(this.path, "utf8");
    } catch (error) {
      if (
        !(error instanceof Error && "code" in error && error.code === "ENOENT")
      )
        throw error;
      return {
        schemaVersion: 1,
        binding,
        offset: 0,
        inbox: [],
        outbox: [],
        connection: "disconnected",
        updatedAt: Date.now(),
      };
    }
    if (Buffer.byteLength(raw) > 4 * 1024 * 1024)
      throw new Error("gateway-state-too-large");
    const state = gatewayStateSchema.parse(JSON.parse(raw));
    if (state.binding !== binding)
      throw new Error(
        "gateway-binding-changed: restore original configuration or archive gateway state locally",
      );
    return state;
  }
  save(state: GatewayState): Promise<void> {
    const snapshot = gatewayStateSchema.parse(state);
    if (Buffer.byteLength(JSON.stringify(snapshot)) > 4 * 1024 * 1024)
      return Promise.reject(new Error("gateway-state-too-large"));
    // Poison the queue after a failed write: never persist a later checkpoint past lost work.
    this.#tail = this.#tail.then(() => writePrivateJson(this.path, snapshot));
    return this.#tail;
  }
}
