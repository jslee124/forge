import type {
  ProductActionUpdate,
  ProductRunCompletion,
} from "@forge/application";
import {
  type ApprovalView,
  approvalViewSchema,
  parseRunCommand,
  type RunCommand,
  type RunEvent,
  type RunPayload,
  type RunReply,
} from "../shared/run-protocol.js";

export interface ExecutionContext {
  ready?(): void;
  readonly signal: AbortSignal;
  text(text: string): void;
  detail(
    kind: "reasoning" | "tool" | "context" | "error" | "system",
    text: string,
    step?: number,
  ): void;
  action(action: ProductActionUpdate): void;
  phase(phase: "responding" | "executing" | "finalizing"): void;
  approve(description: string, descriptor?: ApprovalView): Promise<boolean>;
}
export type RunExecutor = ((
  request: Extract<RunCommand, { type: "start" }>,
  context: ExecutionContext,
) =>
  | Promise<void>
  | Promise<"completed" | "cancelled" | ProductRunCompletion | undefined>) & {
  readonly deferStartReply?: boolean;
};

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
        approvals: Map<
          string,
          { resolve: (allow: boolean) => void; actionId?: string }
        >;
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
        approvals: new Map<
          string,
          { resolve: (allow: boolean) => void; actionId?: string }
        >(),
      };
      this.#active = active;
      let buffered:
        | Extract<RunPayload, { type: "detail" | "text" }>
        | undefined;
      let timer: ReturnType<typeof setTimeout> | undefined;
      const send = (payload: RunPayload) => {
        if (this.#active !== active || this.#closed) return;
        this.#send({
          type: "run-event",
          schemaVersion: 2,
          occurredAt: new Date().toISOString(),
          requestId: request.requestId,
          sessionId: request.sessionId,
          runId: request.runId,
          sequence: ++active.sequence,
          payload,
        });
      };
      const flush = () => {
        if (timer) clearTimeout(timer);
        timer = undefined;
        if (buffered) send(buffered);
        buffered = undefined;
      };
      const emit = (payload: RunPayload) => {
        flush();
        send(payload);
      };
      const append = (
        payload: Extract<RunPayload, { type: "detail" | "text" }>,
      ) => {
        if (active.controller.signal.aborted) return;
        const same =
          buffered?.type === payload.type &&
          (payload.type === "text" ||
            (buffered.type === "detail" &&
              buffered.kind === payload.kind &&
              buffered.step === payload.step));
        if (
          !same ||
          (buffered?.text.length ?? 0) + payload.text.length > 100_000
        )
          flush();
        buffered = buffered
          ? { ...buffered, text: buffered.text + payload.text }
          : payload;
        timer ??= setTimeout(flush, 32);
      };
      let admitted = !this.#execute.deferStartReply;
      if (admitted) reply(true);
      const ready = () => {
        if (!admitted) {
          admitted = true;
          reply(true);
        }
      };
      const complete = (payload: Extract<RunPayload, { type: "complete" }>) => {
        emit(payload);
        if (!admitted) reply(false);
      };
      this.#execution = Promise.resolve()
        .then(async () => {
          if (active.controller.signal.aborted) return;
          return await this.#execute?.(request, {
            ready,
            signal: active.controller.signal,
            detail: (kind, text, step) => {
              const payload = {
                type: "detail" as const,
                kind,
                text: text.slice(0, 100_000),
                ...(step ? { step } : {}),
              };
              if (kind === "reasoning") append(payload);
              else emit(payload);
            },
            action: (action) => emit({ type: "action", action }),
            phase: (phase) => emit({ type: "phase", phase }),
            text: (text) => {
              if (!active.controller.signal.aborted) {
                for (let offset = 0; offset < text.length; offset += 100_000)
                  append({
                    type: "text",
                    text: text.slice(offset, offset + 100_000),
                  });
              }
            },
            approve: (description, descriptor) => {
              if (
                description.length > 100_000 ||
                (descriptor &&
                  !approvalViewSchema.safeParse(descriptor).success)
              ) {
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
                active.approvals.set(approvalId, {
                  resolve,
                  ...(descriptor ? { actionId: descriptor.actionId } : {}),
                });
                emit({
                  type: "approval",
                  approvalId,
                  description: description.slice(0, 100_000),
                  ...(descriptor ? { descriptor } : {}),
                });
              });
            },
          });
        })
        .then(
          (outcome) =>
            complete({
              type: "complete",
              ...(typeof outcome === "object"
                ? outcome
                : {
                    outcome:
                      outcome ??
                      (active.controller.signal.aborted
                        ? "cancelled"
                        : "completed"),
                  }),
            }),
          () =>
            complete({
              type: "complete",
              outcome: active.controller.signal.aborted
                ? "cancelled"
                : "failed",
            }),
        )
        .finally(() => {
          if (timer) clearTimeout(timer);
          for (const approval of active.approvals.values())
            approval.resolve(false);
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
      const approval = active.approvals.get(request.approvalId);
      if (
        !approval ||
        active.controller.signal.aborted ||
        (approval.actionId && request.actionId !== approval.actionId)
      ) {
        reply(false);
        return;
      }
      active.approvals.delete(request.approvalId);
      this.#send({
        type: "run-event",
        schemaVersion: 2,
        occurredAt: new Date().toISOString(),
        requestId: active.request.requestId,
        sessionId: active.request.sessionId,
        runId: active.request.runId,
        sequence: ++active.sequence,
        payload: {
          type: "approval-resolved",
          approvalId: request.approvalId,
          allow: request.allow,
        },
      });
      approval.resolve(request.allow);
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
    for (const approval of this.#active?.approvals.values() ?? [])
      approval.resolve(false);
    this.#active?.approvals.clear();
  }
}
