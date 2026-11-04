export type SessionRunState = "queued" | "running";
interface ScheduledRun {
  readonly sessionId: string;
  readonly runId: string;
  readonly controller: AbortController;
  state: SessionRunState;
  start(): void;
  cancelQueued(): void;
}

/** Process-local scheduling only. Policy, approvals and persistence remain run-owned. */
export class SessionScheduler {
  readonly #runs = new Map<string, ScheduledRun>();
  readonly #queue: ScheduledRun[] = [];
  readonly #tasks = new Set<Promise<void>>();
  readonly maxConcurrent: number;
  #closed = false;
  constructor(options: { maxConcurrent?: number } = {}) {
    this.maxConcurrent = options.maxConcurrent ?? 2;
    if (
      !Number.isInteger(this.maxConcurrent) ||
      this.maxConcurrent < 1 ||
      this.maxConcurrent > 16
    )
      throw new Error("invalid-concurrency-limit");
  }
  get busy(): boolean {
    return this.#runs.size > 0;
  }
  hasSession(sessionId: string): boolean {
    return this.#runs.has(sessionId);
  }
  get running(): number {
    return [...this.#runs.values()].filter((run) => run.state === "running")
      .length;
  }
  get queued(): number {
    return this.#queue.length;
  }
  submit<T>(options: {
    sessionId: string;
    runId: string;
    signal?: AbortSignal;
    execute(signal: AbortSignal): Promise<T>;
    onState?(state: SessionRunState): void;
  }): Promise<T> {
    if (this.#closed) return Promise.reject(new Error("scheduler-closed"));
    if (this.#runs.has(options.sessionId))
      return Promise.reject(new Error("session-busy"));
    if (this.#queue.length >= 32)
      return Promise.reject(new Error("session-queue-full"));
    if (options.signal?.aborted) return Promise.reject(new Error("cancelled"));
    return new Promise<T>((resolve, reject) => {
      const controller = new AbortController();
      const signal = options.signal
        ? AbortSignal.any([controller.signal, options.signal])
        : controller.signal;
      const cleanup = () => {
        signal.removeEventListener("abort", abort);
        this.#runs.delete(options.sessionId);
        const index = this.#queue.indexOf(run);
        if (index >= 0) this.#queue.splice(index, 1);
        this.#pump();
      };
      const abort = () => {
        if (run.state === "queued") run.cancelQueued();
      };
      const run: ScheduledRun = {
        sessionId: options.sessionId,
        runId: options.runId,
        controller,
        state: "queued",
        start: () => {
          run.state = "running";
          const task = Promise.resolve()
            .then(async () => {
              try {
                options.onState?.("running");
                if (signal.aborted) throw new Error("cancelled");
                const result = await options.execute(signal);
                cleanup();
                resolve(result);
              } catch (error) {
                cleanup();
                reject(error);
              }
            })
            .finally(() => this.#tasks.delete(task));
          this.#tasks.add(task);
        },
        cancelQueued: () => {
          cleanup();
          reject(new Error("cancelled"));
        },
      };
      this.#runs.set(options.sessionId, run);
      signal.addEventListener("abort", abort, { once: true });
      if (this.running < this.maxConcurrent) run.start();
      else {
        this.#queue.push(run);
        try {
          options.onState?.("queued");
        } catch (error) {
          cleanup();
          reject(error);
        }
      }
    });
  }
  #pump(): void {
    while (
      !this.#closed &&
      this.#queue.length &&
      this.running < this.maxConcurrent
    )
      this.#queue.shift()?.start();
  }
  cancel(sessionId: string, runId: string): boolean {
    const run = this.#runs.get(sessionId);
    if (!run || run.runId !== runId) return false;
    run.controller.abort();
    return true;
  }
  close(): void {
    this.#closed = true;
    for (const run of [...this.#runs.values()]) run.controller.abort();
  }
  async drain(): Promise<void> {
    this.close();
    await Promise.all(this.#tasks);
  }
}

/** The desktop-specific name remains an alias for existing development launchers. */
export function sessionConcurrency(env: NodeJS.ProcessEnv): number {
  const { FORGE_MAX_CONCURRENT_RUNS, FORGE_DESKTOP_MAX_CONCURRENT_RUNS } = env;
  return Number(
    FORGE_MAX_CONCURRENT_RUNS ?? FORGE_DESKTOP_MAX_CONCURRENT_RUNS ?? 2,
  );
}
