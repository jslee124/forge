import {
  type DesktopState,
  type ManagementCommand,
  managementReplySchema,
} from "../shared/application-protocol.js";
export class ManagementChannel {
  readonly #send: (value: unknown) => void;
  readonly #pending = new Map<
    string,
    {
      resolve: (state: DesktopState) => void;
      reject: (error: Error) => void;
      timer: ReturnType<typeof setTimeout>;
    }
  >();
  #sequence = 0;
  #closed = false;
  constructor(send: (value: unknown) => void) {
    this.#send = send;
  }
  request(command: ManagementCommand): Promise<DesktopState> {
    if (this.#closed) return Promise.reject(new Error("disconnected"));
    const requestId = `management-${++this.#sequence}`;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.#pending.delete(requestId);
        reject(new Error("management-timeout"));
      }, 60_000);
      this.#pending.set(requestId, { resolve, reject, timer });
      try {
        this.#send({ type: "management", requestId, command });
      } catch {
        this.close();
      }
    });
  }
  receive(value: unknown): void {
    const parsed = managementReplySchema.safeParse(value);
    if (!parsed.success) return;
    const { requestId, state, error } = parsed.data;
    const pending = this.#pending.get(requestId);
    if (!pending) return;
    clearTimeout(pending.timer);
    this.#pending.delete(requestId);
    if (state) pending.resolve(state);
    else pending.reject(new Error(error ?? "management-failed"));
  }
  close(): void {
    this.#closed = true;
    for (const p of this.#pending.values()) {
      clearTimeout(p.timer);
      p.reject(new Error("disconnected"));
    }
    this.#pending.clear();
  }
}
