import {
  parseRunCommand,
  type RunCommand,
  type RunEvent,
  type RunPayload,
  type RunReply,
} from "../shared/run-protocol.js";

export interface ExecutionContext {
  readonly signal: AbortSignal;
  text(text: string): void;
  detail(
    kind: "reasoning" | "tool" | "context" | "error" | "system",
    text: string,
  ): void;
  approve(description: string): Promise<boolean>;
}
export type RunExecutor = (
  request: Extract<RunCommand, { type: "start" }>,
  context: ExecutionContext,
) => Promise<void> | Promise<"completed" | "cancelled" | undefined>;

/** One execution at a time. No retries, persisted authority, or effect replay. */
export class RunService {
  readonly #send: (value: RunEvent | RunReply) => void;
  readonly #execute: RunExecutor | undefined;
  readonly #seen = new Set<string>();
  #active:
    | {
        request: RunCommand;
        controller: AbortController;
        sequence: number;
        approvals: Map<string, (allow: boolean) => void>;
      }
    | undefined;
  #closed = false;
  #execution: Promise<void> = Promise.resolve();
  constructor(
    send: (value: RunEvent | RunReply) => void,
    execute?: RunExecutor,
  ) {
    this.#send = send;
    this.#execute = execute;
  }
  handle(value: unknown): void {
    const request = parseRunCommand(value);
    if (!request) return;
    const reply = (ok: boolean) =>
      this.#send({ type: "run-reply", requestId: request.requestId, ok });
    // Bound lifetime memory. Exhaustion requires a fresh process, never eviction/replay.
    if (
      this.#closed ||
      this.#seen.has(request.requestId) ||
      this.#seen.size >= 100_000
    ) {
      reply(false);
      return;
    }
    this.#seen.add(request.requestId);
    if (request.type === "start") {
      if (
        this.#active ||
        !this.#execute ||
        this.#seen.has(`run:${request.runId}`)
      ) {
        reply(false);
        return;
      }
      this.#seen.add(`run:${request.runId}`);
      const active = {
        request,
        controller: new AbortController(),
        sequence: 0,
        approvals: new Map<string, (allow: boolean) => void>(),
      };
      this.#active = active;
      const emit = (payload: RunPayload) => {
        if (this.#active !== active || this.#closed) return;
        this.#send({
          type: "run-event",
          requestId: request.requestId,
          sessionId: request.sessionId,
          runId: request.runId,
          sequence: ++active.sequence,
          payload,
        });
      };
      reply(true);
      this.#execution = Promise.resolve()
        .then(async () => {
          if (active.controller.signal.aborted) return;
          return await this.#execute?.(request, {
            signal: active.controller.signal,
            detail: (kind, text) =>
              emit({ type: "detail", kind, text: text.slice(0, 100_000) }),
            text: (text) => {
              if (!active.controller.signal.aborted) {
                for (let offset = 0; offset < text.length; offset += 100_000)
                  emit({
                    type: "text",
                    text: text.slice(offset, offset + 100_000),
                  });
              }
            },
            approve: (description) => {
              if (description.length > 100_000) {
                emit({
                  type: "detail",
                  kind: "error",
                  text: "approval-description-too-large",
                });
                return Promise.resolve(false);
              }
              if (active.controller.signal.aborted || this.#active !== active)
                return Promise.resolve(false);
              const approvalId = `approval-${active.sequence + 1}`;
              return new Promise<boolean>((resolve) => {
                active.approvals.set(approvalId, resolve);
                emit({
                  type: "approval",
                  approvalId,
                  description: description.slice(0, 100_000),
                });
              });
            },
          });
        })
        .then(
          (outcome) =>
            emit({
              type: "complete",
              outcome:
                outcome ??
                (active.controller.signal.aborted ? "cancelled" : "completed"),
            }),
          () =>
            emit({
              type: "complete",
              outcome: active.controller.signal.aborted
                ? "cancelled"
                : "failed",
            }),
        )
        .finally(() => {
          for (const resolve of active.approvals.values()) resolve(false);
          active.approvals.clear();
          if (this.#active === active) this.#active = undefined;
        });
      return;
    }
    const active = this.#active;
    if (
      !active ||
      active.request.runId !== request.runId ||
      active.request.sessionId !== request.sessionId
    ) {
      reply(false);
      return;
    }
    if (request.type === "cancel") {
      this.#cancel();
      reply(true);
    } else {
      const resolve = active.approvals.get(request.approvalId);
      if (!resolve || active.controller.signal.aborted) {
        reply(false);
        return;
      }
      active.approvals.delete(request.approvalId);
      resolve(request.allow);
      reply(true);
    }
  }
  async drain(): Promise<void> {
    this.close();
    await this.#execution;
  }

  get busy(): boolean {
    return this.#active !== undefined;
  }

  close(): void {
    this.#closed = true;
    this.#cancel();
  }
  #cancel(): void {
    this.#active?.controller.abort();
    for (const resolve of this.#active?.approvals.values() ?? [])
      resolve(false);
    this.#active?.approvals.clear();
  }
}
