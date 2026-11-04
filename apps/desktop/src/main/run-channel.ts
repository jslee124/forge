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
  #active = new Map<string, { request: RunCommand; sequence: number }>();
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
      if (this.#active.has(request.sessionId)) return Promise.resolve(false);
      this.#active.set(request.sessionId, { request, sequence: 0 });
    } else if (
      this.#active.get(request.sessionId)?.request.runId !== request.runId ||
      this.#active.get(request.sessionId)?.request.sessionId !==
        request.sessionId
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
      if (!reply.ok) {
        for (const [id, active] of this.#active)
          if (active.request.requestId === reply.requestId)
            this.#active.delete(id);
      }
      pending.resolve(reply.ok);
      return;
    }
    const event = parseRunEvent(value);
    const candidateSession =
      typeof value === "object" && value !== null
        ? (value as Record<string, unknown>)["sessionId"]
        : undefined;
    const active =
      typeof candidateSession === "string"
        ? this.#active.get(candidateSession)
        : undefined;
    if (!event && active && typeof value === "object" && value !== null) {
      const candidate = value as Record<string, unknown>;
      if (
        candidate["type"] === "run-event" &&
        candidate["requestId"] === active.request.requestId &&
        candidate["runId"] === active.request.runId &&
        candidate["sessionId"] === active.request.sessionId
      ) {
        this.#fault();
        return;
      }
    }
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
    if (event.payload.type === "complete") this.#active.delete(event.sessionId);
    for (const listener of this.#listeners) listener(event);
  }
  #fault(): void {
    this.disconnect();
    this.#onFault();
  }

  disconnect(): void {
    if (this.#closed) return;
    this.#closed = true;
    const activeRuns = [...this.#active.values()];
    this.#active.clear();
    for (const pending of this.#pending.values()) {
      clearTimeout(pending.timer);
      pending.resolve(false);
    }
    this.#pending.clear();
    for (const active of activeRuns) {
      const event: RunEvent = {
        type: "run-event",
        schemaVersion: 2,
        occurredAt: new Date().toISOString(),
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
