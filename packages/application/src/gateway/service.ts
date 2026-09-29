import { createHash, randomBytes, randomUUID } from "node:crypto";
import type { ApprovalChannel, ProposedAction } from "@forge/core";
import {
  acquireWorkspaceLease,
  type ExecutionLease,
  type GatewayDelivery,
  type GatewayState,
  type GatewayStore,
  redactValue,
} from "@forge/persistence";
import {
  boundedText,
  type ChannelAdapter,
  ChannelError,
  type ChannelEvent,
} from "./channel.js";
import type { GatewayConfig } from "./config.js";
import type { GatewayRunner } from "./runner.js";

const terminal = new Set(["completed", "failed", "cancelled", "interrupted"]);
interface ActiveTask {
  id: string;
  controller: AbortController;
  done: Promise<void>;
  lease: ExecutionLease;
}
interface PendingApproval {
  token: string;
  taskId: string;
  conversationId: string;
  expires: number;
  resolve: (allow: boolean) => void;
}

export class GatewayService {
  #active: ActiveTask | undefined;
  #approval: PendingApproval | undefined;
  #queue: Promise<void> = Promise.resolve();
  #queued = 0;
  #closed = false;
  #fatal: unknown;
  #lastProgress = 0;
  #flushing = false;
  constructor(
    readonly state: GatewayState,
    private readonly store: GatewayStore,
    private readonly config: GatewayConfig,
    private readonly adapter: ChannelAdapter,
    private readonly runner: GatewayRunner,
    private readonly secrets: readonly string[] = [],
    private readonly limits = { approvalMs: 300000, taskMs: 1800000 },
  ) {}

  async recover(): Promise<void> {
    // Restored delivery metadata cannot grant authority to a new recipient.
    if (this.adapter.channel === "telegram") {
      const owner = this.config.allowedUserIds[0];
      const destinations = [
        this.state.conversationId,
        this.state.task?.conversationId,
        ...this.state.outbox.map((item) => item.conversationId),
      ];
      if (
        destinations.some(
          (destination) => destination !== undefined && destination !== owner,
        )
      )
        throw new Error("gateway-destination-mismatch");
    }
    this.state.outbox = this.state.outbox.filter(
      (item) => item.kind !== "approval" && item.kind !== "progress",
    );
    if (this.state.task && !terminal.has(this.state.task.state)) {
      this.state.task.state = "interrupted";
      this.state.task.updatedAt = Date.now();
      this.enqueue(
        this.state.task.conversationId,
        `Task ${this.state.task.id}: interrupted. Effects may already exist; inspect before submitting new work.`,
        "terminal",
      );
    }
    this.state.connection = "disconnected";
    await this.persist();
  }
  receive(event: ChannelEvent | undefined, offset?: number): Promise<void> {
    if (this.#queued >= 100)
      return Promise.reject(new Error("gateway-control-queue-full"));
    this.#queued++;
    const operation = this.#queue.then(async () => {
      if (this.#fatal) throw this.#fatal;
      if (this.#closed) throw new Error("gateway-stopping");
      // Persist both disposition and checkpoint in one snapshot before the next poll.
      await this.handle(event);
      if (offset !== undefined)
        this.state.offset = Math.max(this.state.offset, offset);
      await this.persist();
    });
    this.#queue = operation.catch((error) => {
      this.#fatal = error;
      this.#active?.controller.abort();
    });
    return operation.finally(() => {
      this.#queued--;
    });
  }
  private authorized(event: ChannelEvent): boolean {
    return (
      event.channel === this.adapter.channel &&
      event.accountId === this.adapter.accountId &&
      event.private &&
      (event.channel !== "telegram" ||
        event.conversationId === event.senderId) &&
      !event.threadId &&
      this.config.allowedUserIds.includes(event.senderId) &&
      (!this.state.conversationId ||
        this.state.conversationId === event.conversationId)
    );
  }
  private async handle(event: ChannelEvent | undefined): Promise<void> {
    if (!event || !this.authorized(event)) return;
    const key = JSON.stringify([
      event.channel,
      event.accountId,
      event.senderId,
      event.conversationId,
      event.threadId ?? "",
      event.eventId,
    ]);
    if (Buffer.byteLength(key) > 1024) return;
    const now = Date.now();
    this.state.inbox = this.state.inbox.filter(
      (item) => item.at >= now - 7 * 86400000,
    );
    if (this.state.inbox.some((item) => item.key === key)) return;
    // Keep control reception responsive even when the task deduplication journal is full.
    // Cancellation/status are idempotent; approval tokens are consumed independently.
    const control =
      event.kind === "approval" ||
      /^(?:\/(?:cancel|status|help|start)|\/(?:approve|deny) [a-f0-9]{32})$/u.test(
        event.text.trim(),
      );
    if (this.state.inbox.length >= 10000 && !control) {
      this.enqueue(
        event.conversationId,
        "Task journal is full; new work is paused. /status and /cancel remain available.",
      );
      return;
    }
    if (this.state.inbox.length < 10000)
      this.state.inbox.push({ key, at: now });
    if (event.kind === "unsupported") {
      this.enqueue(
        event.conversationId,
        "Only new private text messages are supported.",
      );
      return;
    }
    if (
      event.kind !== "approval" &&
      (event.receivedAt < now - 300000 || event.receivedAt > now + 60000)
    ) {
      this.enqueue(
        event.conversationId,
        "Stale message rejected. Send a new message.",
      );
      return;
    }
    if (Buffer.byteLength(event.text) > 16384) {
      this.enqueue(event.conversationId, "Message exceeds 16 KiB.");
      return;
    }
    const text = event.text.trim();
    if (event.kind === "approval" || /^\/(approve|deny) /u.test(text)) {
      const match = /^(?:\/)?(approve|deny)[: ]([a-f0-9]{32})$/u.exec(text);
      const pending = this.#approval;
      if (
        match &&
        pending &&
        pending.token === match[2] &&
        pending.conversationId === event.conversationId &&
        pending.taskId === this.#active?.id &&
        pending.expires > now &&
        !this.#active.controller.signal.aborted
      ) {
        // Consume synchronously; callbacks never restore this record after restart.
        this.#approval = undefined;
        this.state.outbox = this.state.outbox.filter(
          (item) => item.kind !== "approval",
        );
        pending.resolve(match[1] === "approve");
        this.enqueue(
          event.conversationId,
          match[1] === "approve" ? "Approved once." : "Denied.",
        );
      } else
        this.enqueue(event.conversationId, "Approval is invalid or expired.");
      return;
    }
    if (text === "/help" || text === "/start") {
      this.enqueue(
        event.conversationId,
        "/new /status /cancel /help\nSend text to start a task. The host must be awake and online. Workspace: " +
          this.config.workspaceAlias,
      );
      return;
    }
    if (text === "/status") {
      const task = this.state.task;
      this.enqueue(
        event.conversationId,
        `${this.config.workspaceAlias}: ${this.state.connection}\n${task ? `Task ${task.id}: ${this.#active?.controller.signal.aborted ? "cancelling" : task.state}` : "Idle"}\nPending deliveries: ${this.state.outbox.length}`,
      );
      return;
    }
    if (text === "/cancel") {
      this.#active?.controller.abort();
      this.#approval?.resolve(false);
      this.#approval = undefined;
      this.enqueue(
        event.conversationId,
        this.#active
          ? "Cancelling; waiting for the runner to settle."
          : "No active task.",
      );
      return;
    }
    if (text === "/new") {
      if (this.#active)
        this.enqueue(event.conversationId, `Busy: ${this.#active.id}`);
      else {
        delete this.state.sessionId;
        this.enqueue(
          event.conversationId,
          "New conversation. Previous records are retained locally.",
        );
      }
      return;
    }
    if (!text || text.startsWith("/")) {
      this.enqueue(event.conversationId, "Unknown command. Use /help.");
      return;
    }
    if (this.#active) {
      this.enqueue(
        event.conversationId,
        `Busy: ${this.#active.id}. Use /status or /cancel.`,
      );
      return;
    }
    if (
      this.state.outbox.length >= 80 ||
      this.state.outbox.some((item) => item.failed)
    ) {
      this.enqueue(
        event.conversationId,
        "Delivery backlog; repair the connection locally before starting work.",
      );
      return;
    }
    let lease: ExecutionLease;
    try {
      lease = await acquireWorkspaceLease(this.config.workspaceRoot);
    } catch {
      this.enqueue(
        event.conversationId,
        "Workspace busy or unavailable. No task started.",
      );
      return;
    }
    let handedOff = false;
    try {
      const sessionId = await this.runner.prepare(this.state.sessionId);
      this.state.sessionId = sessionId;
      this.state.conversationId = event.conversationId;
      const id = randomUUID();
      this.state.task = {
        id,
        conversationId: event.conversationId,
        state: "accepted",
        updatedAt: now,
      };
      this.enqueue(
        event.conversationId,
        `Accepted ${id} · ${this.config.workspaceAlias}`,
      );
      await this.persist();
      const active: ActiveTask = {
        id,
        controller: new AbortController(),
        lease,
        done: Promise.resolve(),
      };
      this.#active = active;
      handedOff = true;
      active.done = this.execute(
        active,
        sessionId,
        text,
        event.conversationId,
      ).catch((error) => {
        this.#fatal = error;
      });
    } finally {
      if (!handedOff) await lease.release();
    }
  }
  private async execute(
    active: ActiveTask,
    sessionId: string,
    prompt: string,
    conversationId: string,
  ): Promise<void> {
    const deadline = setTimeout(
      () => active.controller.abort(),
      this.limits.taskMs,
    );
    try {
      if (this.state.task) this.state.task.state = "running";
      await this.persist();
      const approve = (action: ProposedAction, scope?: string) =>
        this.approve(active, conversationId, action, scope);
      const approvalChannel: ApprovalChannel = {
        request: (action) => approve(action),
        requestStructured: async (action, _signal, _context, descriptor) => ({
          kind: (await approve(action, descriptor.preview))
            ? "allow-once"
            : "deny",
        }),
      };
      const result = await this.runner.run({
        id: active.id,
        sessionId,
        prompt,
        lease: active.lease,
        signal: active.controller.signal,
        approvalChannel,
        progress: async (text) => {
          if (Date.now() - this.#lastProgress < 2000) return;
          this.#lastProgress = Date.now();
          this.enqueue(
            conversationId,
            `Task ${active.id}: ${text}`,
            "progress",
          );
          await this.persist();
        },
      });
      if (this.state.task) {
        this.state.task.state = result.state;
        this.state.task.updatedAt = Date.now();
      }
      this.enqueue(
        conversationId,
        `Task ${active.id}: ${result.state}\n${boundedText(result.text, 14000)}${Buffer.byteLength(result.text) > 14000 ? "\n[Truncated; inspect the local session.]" : ""}\nLocal session: ${sessionId}`,
        "terminal",
      );
    } catch {
      if (this.state.task) {
        this.state.task.state = "interrupted";
        this.state.task.updatedAt = Date.now();
      }
      this.enqueue(
        conversationId,
        `Task ${active.id}: interrupted. Effects may already exist; inspect the local session before retrying.`,
        "terminal",
      );
    } finally {
      clearTimeout(deadline);
      this.#approval?.resolve(false);
      this.#approval = undefined;
      this.state.outbox = this.state.outbox.filter(
        (item) => item.kind !== "approval" && item.kind !== "progress",
      );
      try {
        await this.persist();
      } finally {
        await active.lease.release();
        this.#active = undefined;
      }
    }
  }
  private async approve(
    active: ActiveTask,
    conversationId: string,
    action: ProposedAction,
    scope?: string,
  ): Promise<boolean> {
    if (active.controller.signal.aborted) return false;
    const actionDigest = () =>
      createHash("sha256")
        .update(
          JSON.stringify([action.call.id, action.tool.name, action.input]),
        )
        .digest("hex");
    const expectedDigest = actionDigest();
    const description = `Workspace: ${this.config.workspaceAlias}\n${scope ?? action.tool.name}\n${JSON.stringify(action.input, null, 2)}`;
    const sanitized = String(redactValue(description, this.secrets));
    // Redaction can change the action shown: fail closed instead of asking for blind consent.
    if (
      sanitized !== description ||
      description.length >
        Math.min(1700, this.adapter.capabilities.textLimit) - 250
    )
      return false;
    const token = randomBytes(16).toString("hex");
    let finish: (allow: boolean) => void = () => {};
    const answer = new Promise<boolean>((resolve) => {
      finish = resolve;
    });
    this.#approval = {
      token,
      taskId: active.id,
      conversationId,
      expires: Date.now() + this.limits.approvalMs,
      resolve: finish,
    };
    if (this.state.task) this.state.task.state = "awaiting_approval";
    const buttons = [
      { label: "Allow once", data: `approve:${token}` },
      { label: "Deny", data: `deny:${token}` },
    ];
    this.enqueue(
      conversationId,
      `Task ${active.id} requests one action:\n${description}${this.adapter.capabilities.buttons ? "" : `\n/approve ${token}\n/deny ${token}`}`,
      "approval",
      this.adapter.capabilities.buttons ? buttons : undefined,
    );
    const abort = () => finish(false);
    active.controller.signal.addEventListener("abort", abort, { once: true });
    const timer = setTimeout(abort, this.limits.approvalMs);
    try {
      await this.persist();
      return (await answer) && actionDigest() === expectedDigest;
    } finally {
      clearTimeout(timer);
      active.controller.signal.removeEventListener("abort", abort);
      this.#approval = undefined;
      this.state.outbox = this.state.outbox.filter(
        (item) => item.kind !== "approval",
      );
      if (this.state.task) this.state.task.state = "running";
      await this.persist();
    }
  }
  private enqueue(
    conversationId: string,
    text: string,
    kind: GatewayDelivery["kind"] = "notice",
    buttons?: GatewayDelivery["buttons"],
  ): void {
    const sanitized = String(redactValue(text, this.secrets));
    let bounded = boundedText(sanitized, 16000);
    if (bounded !== sanitized)
      bounded += "\n[Truncated; inspect the local session.]";
    if (kind === "progress")
      this.state.outbox = this.state.outbox.filter(
        (item) => item.kind !== "progress",
      );
    const limit = kind === "terminal" || kind === "approval" ? 100 : 85;
    // Array.from avoids splitting surrogate pairs; Telegram receives plain text, no markup parsing.
    const chars = Array.from(bounded);
    const chunkSize = Math.max(
      1,
      Math.floor(Math.min(3400, this.adapter.capabilities.textLimit) / 2),
    );
    for (let i = 0; i < chars.length; i += chunkSize) {
      if (this.state.outbox.length >= limit) {
        if (kind === "terminal" || kind === "approval")
          throw new Error("gateway-outbox-full");
        return;
      }
      this.state.outbox.push({
        id: randomUUID(),
        conversationId,
        text: chars.slice(i, i + chunkSize).join(""),
        kind,
        ...(buttons && i + chunkSize >= chars.length ? { buttons } : {}),
        attempts: 0,
        nextAttemptAt: 0,
        failed: false,
      });
    }
  }
  async flush(signal: AbortSignal): Promise<void> {
    if (this.#flushing || signal.aborted) return;
    if (this.#fatal) throw this.#fatal;
    this.#flushing = true;
    try {
      const item = this.state.outbox.find(
        (value) => !value.failed && value.nextAttemptAt <= Date.now(),
      );
      if (!item) return;
      // A crash after persisting the final attempt must not permit another send.
      if (item.attempts >= 6) {
        item.failed = true;
        await this.persist();
        return;
      }
      item.attempts++;
      // Persist attempt before the ambiguous network send, bounding crash/retry loops.
      await this.persist();
      try {
        await this.adapter.send(
          { ...item, text: String(redactValue(item.text, this.secrets)) },
          signal,
        );
        this.state.outbox = this.state.outbox.filter(
          (value) => value.id !== item.id,
        );
      } catch (error) {
        item.failed =
          item.attempts >= 6 || (error instanceof ChannelError && error.fatal);
        item.nextAttemptAt =
          Date.now() +
          Math.max(
            1000 * 2 ** item.attempts,
            error instanceof ChannelError ? error.retryAfterMs : 1000,
          );
        if (error instanceof ChannelError && error.fatal) {
          await this.persist();
          throw error;
        }
      }
      await this.persist();
    } finally {
      this.#flushing = false;
    }
  }
  async connection(value: GatewayState["connection"]): Promise<void> {
    this.state.connection = value;
    await this.persist();
  }
  async idle(): Promise<void> {
    await this.#queue;
    await this.#active?.done;
    if (this.#fatal) throw this.#fatal;
  }
  async stop(): Promise<void> {
    this.#closed = true;
    this.#active?.controller.abort();
    this.#approval?.resolve(false);
    await this.#queue;
    this.#active?.controller.abort();
    await this.#active?.done;
    this.state.connection = "disconnected";
    await this.persist();
  }
  private async persist(): Promise<void> {
    this.state.updatedAt = Date.now();
    try {
      await this.store.save(this.state);
    } catch (error) {
      this.#fatal = error;
      this.#active?.controller.abort();
      throw error;
    }
  }
}
