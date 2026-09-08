import {
  parseRunCommand,
  parseRunEvent,
  parseRunReply,
  type RunCommand,
  type RunEvent,
} from "../shared/run-protocol.js";

export class RunChannel {
  readonly #send: (value: RunCommand) => void;
  readonly #onFault: () => void;
  readonly #pending = new Map<
    string,
    { resolve: (ok: boolean) => void; timer: ReturnType<typeof setTimeout> }
  >();
  readonly #listeners = new Set<(event: RunEvent) => void>();
  readonly #seen = new Set<string>();
  #active: { request: RunCommand; sequence: number } | undefined;
  #closed = false;
  constructor(
    send: (value: RunCommand) => void,
    onFault: () => void = () => undefined,
  ) {
    this.#send = send;
    this.#onFault = onFault;
  }
  subscribe(listener: (event: RunEvent) => void): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }
  request(value: unknown): Promise<boolean> {
    const request = parseRunCommand(value);
    if (
      !request ||
      this.#closed ||
      this.#seen.has(request.requestId) ||
      this.#seen.size >= 100_000
    )
      return Promise.resolve(false);
    if (request.type === "start") {
      if (this.#active) return Promise.resolve(false);
      this.#active = { request, sequence: 0 };
    } else if (
      this.#active?.request.runId !== request.runId ||
      this.#active.request.sessionId !== request.sessionId
    )
      return Promise.resolve(false);
    this.#seen.add(request.requestId);
    return new Promise((resolve) => {
      const timer = setTimeout(() => this.#fault(), 5_000);
      this.#pending.set(request.requestId, { resolve, timer });
      try {
        this.#send(request);
      } catch {
        this.#fault();
      }
    });
  }
  receive(value: unknown): void {
    if (this.#closed) return;
    const reply = parseRunReply(value);
    if (reply) {
      const pending = this.#pending.get(reply.requestId);
      if (!pending) return;
      clearTimeout(pending.timer);
      this.#pending.delete(reply.requestId);
      if (!reply.ok && this.#active?.request.requestId === reply.requestId)
        this.#active = undefined;
      pending.resolve(reply.ok);
      return;
    }
    const event = parseRunEvent(value);
    const active = this.#active;
    if (
      !event ||
      !active ||
      event.requestId !== active.request.requestId ||
      event.sessionId !== active.request.sessionId ||
      event.runId !== active.request.runId ||
      event.sequence <= active.sequence
    )
      return;
    if (event.sequence !== active.sequence + 1) {
      this.#fault();
      return;
    }
    active.sequence = event.sequence;
    if (event.payload.type === "complete") this.#active = undefined;
    for (const listener of this.#listeners) listener(event);
  }
  #fault(): void {
    this.disconnect();
    this.#onFault();
  }

  disconnect(): void {
    if (this.#closed) return;
    this.#closed = true;
    const active = this.#active;
    this.#active = undefined;
    for (const pending of this.#pending.values()) {
      clearTimeout(pending.timer);
      pending.resolve(false);
    }
    this.#pending.clear();
    if (active) {
      const event: RunEvent = {
        type: "run-event",
        requestId: active.request.requestId,
        sessionId: active.request.sessionId,
        runId: active.request.runId,
        sequence: active.sequence + 1,
        payload: { type: "complete", outcome: "interrupted" },
      };
      for (const listener of this.#listeners) listener(event);
    }
    this.#listeners.clear();
  }
}
