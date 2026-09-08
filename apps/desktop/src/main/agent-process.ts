import type { UtilityProcess } from "electron";
import type { AgentRequest, AgentResponse } from "../agent/runtime.js";
import type { AgentHealth } from "../shared/desktop-api.js";
import { ManagementChannel } from "./management-channel.js";

import { RunChannel } from "./run-channel.js";

const RESPONSE_TIMEOUT_MS = 5_000;

interface PendingRequest {
  readonly resolve: (message: AgentResponse) => void;
  readonly reject: (error: Error) => void;
  readonly timeout: ReturnType<typeof setTimeout>;
}

export class AgentProcess {
  readonly #child: UtilityProcess;
  readonly runs: RunChannel;
  readonly management: ManagementChannel;
  readonly #pending = new Map<string, PendingRequest>();
  readonly #onMessage: (message: unknown) => void;
  readonly #onExit: (code: number) => void;
  readonly #ready: Promise<void>;
  readonly #exited: Promise<void>;
  #resolveReady!: () => void;
  #rejectReady!: (error: Error) => void;
  #resolveExited!: () => void;
  #requestSequence = 0;
  #closed = false;
  #stopping = false;
  #closing: Promise<void> | undefined;

  constructor(child: UtilityProcess) {
    this.#child = child;
    this.management = new ManagementChannel((message) =>
      child.postMessage(message),
    );
    this.runs = new RunChannel(
      (message) => child.postMessage(message),
      () => {
        child.kill();
      },
    );
    this.#ready = new Promise((resolve, reject) => {
      this.#resolveReady = resolve;
      this.#rejectReady = reject;
    });
    void this.#ready.catch(() => undefined);
    this.#exited = new Promise((resolve) => {
      this.#resolveExited = resolve;
    });
    this.#onMessage = (message) => this.#receive(message);
    this.#onExit = (code) => {
      this.#resolveExited();
      if (this.#stopping) {
        this.#cleanup();
      } else {
        this.#fail(new Error(`Desktop Agent exited with code ${code}`));
      }
    };
    child.on("message", this.#onMessage);
    child.on("exit", this.#onExit);
  }

  async waitUntilReady(): Promise<void> {
    await this.#withTimeout(
      this.#ready,
      "Timed out waiting for Desktop Agent startup",
    );
  }

  async ping(): Promise<AgentHealth> {
    const response = await this.#request("ping");
    if (response.type !== "pong") {
      throw new Error("Desktop Agent returned an unexpected ping response");
    }
    return {
      pid: response.pid,
      resourcesAvailable: response.resourcesAvailable,
    };
  }

  close(): Promise<void> {
    this.#closing ??= this.#close();
    return this.#closing;
  }

  async #close(): Promise<void> {
    if (this.#closed) return;
    this.#stopping = true;
    try {
      const response = await this.#request("shutdown");
      if (response.type !== "shutdown-complete") {
        throw new Error("Desktop Agent rejected shutdown");
      }
      await this.#withTimeout(
        this.#exited,
        "Timed out waiting for Desktop Agent shutdown",
      );
    } catch {
      this.#child.kill();
      await this.#withTimeout(
        this.#exited,
        "Desktop Agent did not exit after kill",
      );
    } finally {
      this.#cleanup();
    }
  }

  #request(type: AgentRequest["type"]): Promise<AgentResponse> {
    if (this.#closed)
      return Promise.reject(new Error("Desktop Agent is closed"));
    const requestId = `desktop-${++this.#requestSequence}`;
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.#pending.delete(requestId);
        reject(new Error(`Timed out waiting for Desktop Agent ${type}`));
      }, RESPONSE_TIMEOUT_MS);
      this.#pending.set(requestId, { resolve, reject, timeout });
      try {
        this.#child.postMessage({ type, requestId } satisfies AgentRequest);
      } catch {
        clearTimeout(timeout);
        this.#pending.delete(requestId);
        reject(new Error("Desktop Agent transport disconnected"));
      }
    });
  }

  #receive(value: unknown): void {
    this.runs.receive(value);
    this.management.receive(value);
    if (typeof value !== "object" || value === null) return;
    const message = value as Partial<AgentResponse>;
    if (message.type === "ready" && typeof message.pid === "number") {
      this.#resolveReady();
      return;
    }
    const requestId = "requestId" in message ? message.requestId : undefined;
    if (typeof requestId !== "string") return;
    const pending = this.#pending.get(requestId);
    if (!pending) return;
    if (
      message.type !== "shutdown-complete" &&
      !(
        message.type === "pong" &&
        typeof message.pid === "number" &&
        typeof message.resourcesAvailable === "boolean"
      )
    )
      return;
    clearTimeout(pending.timeout);
    this.#pending.delete(requestId);
    pending.resolve(message as AgentResponse);
  }

  #fail(error: Error): void {
    this.#rejectReady(error);
    for (const pending of this.#pending.values()) {
      clearTimeout(pending.timeout);
      pending.reject(error);
    }
    this.#pending.clear();
    this.#cleanup();
  }

  #cleanup(): void {
    if (this.#closed) return;
    this.#closed = true;
    this.runs.disconnect();
    this.management.close();
    for (const pending of this.#pending.values()) {
      clearTimeout(pending.timeout);
      pending.reject(new Error("Desktop Agent is closed"));
    }
    this.#pending.clear();
    this.#child.off("message", this.#onMessage);
    this.#child.off("exit", this.#onExit);
  }

  async #withTimeout<T>(promise: Promise<T>, message: string): Promise<T> {
    let timeout: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([
        promise,
        new Promise<T>((_, reject) => {
          timeout = setTimeout(
            () => reject(new Error(message)),
            RESPONSE_TIMEOUT_MS,
          );
        }),
      ]);
    } finally {
      if (timeout) clearTimeout(timeout);
    }
  }
}
