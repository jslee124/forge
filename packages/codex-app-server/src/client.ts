import { type ChildProcessWithoutNullStreams, spawn } from "node:child_process";
import { createInterface, type Interface } from "node:readline";

import type {
  JsonRpcId,
  JsonRpcNotification,
  JsonRpcServerRequest,
} from "./types.js";

interface PendingRequest {
  readonly resolve: (value: unknown) => void;
  readonly reject: (error: Error) => void;
  readonly timeout: NodeJS.Timeout;
}

export interface CodexProcessFactoryOptions {
  readonly command: string;
  readonly cwd: string;
  readonly env: NodeJS.ProcessEnv;
}

export type CodexProcessFactory = (
  options: CodexProcessFactoryOptions,
) => ChildProcessWithoutNullStreams;

export interface CodexAppServerClientOptions {
  readonly cwd: string;
  readonly env?: NodeJS.ProcessEnv;
  readonly command?: string;
  readonly requestTimeoutMs?: number;
  readonly processFactory?: CodexProcessFactory;
}

export class CodexAppServerError extends Error {
  readonly code = "CODEX_APP_SERVER_ERROR";

  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "CodexAppServerError";
  }
}

export class CodexAppServerClient {
  readonly #process: ChildProcessWithoutNullStreams;
  readonly #lines: Interface;
  readonly #requestTimeoutMs: number;
  readonly #pending = new Map<number, PendingRequest>();
  readonly #notificationListeners = new Set<
    (notification: JsonRpcNotification) => void
  >();
  readonly #requestListeners = new Set<
    (request: JsonRpcServerRequest) => void
  >();
  readonly #failureListeners = new Set<(error: Error) => void>();
  #nextId = 1;
  #closed = false;
  #stderr = "";

  private constructor(
    process: ChildProcessWithoutNullStreams,
    requestTimeoutMs: number,
  ) {
    this.#process = process;
    this.#requestTimeoutMs = requestTimeoutMs;
    this.#lines = createInterface({ input: process.stdout });
    this.#lines.on("line", (line) => this.#handleLine(line));
    process.stderr.setEncoding("utf8");
    process.stderr.on("data", (chunk: string) => {
      this.#stderr = `${this.#stderr}${chunk}`.slice(-8_192);
    });
    process.once("error", (error) => {
      this.#failAll(
        new CodexAppServerError(
          `Could not start Codex App Server: ${error.message}. Install the Codex CLI or set FORGE_CODEX_PATH.`,
          { cause: error },
        ),
      );
    });
    process.once("exit", (code, signal) => {
      if (this.#closed) return;
      const detail = this.#safeStderr();
      this.#failAll(
        new CodexAppServerError(
          `Codex App Server exited before completing the request (${signal ?? `code ${code ?? "unknown"}`})${detail ? `: ${detail}` : "."}`,
        ),
      );
    });
  }

  static async connect(
    options: CodexAppServerClientOptions,
  ): Promise<CodexAppServerClient> {
    const effectiveEnv = options.env ?? process.env;
    const { FORGE_CODEX_PATH: configuredCommand } = effectiveEnv;
    const command = options.command ?? (configuredCommand?.trim() || "codex");
    const processFactory = options.processFactory ?? defaultProcessFactory;
    const child = processFactory({
      command,
      cwd: options.cwd,
      env: effectiveEnv,
    });
    const client = new CodexAppServerClient(
      child,
      options.requestTimeoutMs ?? 30_000,
    );
    try {
      await client.request("initialize", {
        clientInfo: { name: "forge", title: "Forge", version: "0.2.0" },
        capabilities: null,
      });
      client.notify("initialized");
      return client;
    } catch (error) {
      client.close();
      throw error;
    }
  }

  request<T>(
    method: string,
    params?: unknown,
    timeoutMs = this.#requestTimeoutMs,
  ): Promise<T> {
    if (this.#closed) {
      return Promise.reject(
        new CodexAppServerError("Codex App Server connection is closed."),
      );
    }
    const id = this.#nextId;
    this.#nextId += 1;
    return new Promise<T>((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.#pending.delete(id);
        reject(
          new CodexAppServerError(
            `Codex App Server request timed out: ${method}.`,
          ),
        );
      }, timeoutMs);
      this.#pending.set(id, {
        resolve: (value) => resolve(value as T),
        reject,
        timeout,
      });
      this.#write({ method, id, ...(params === undefined ? {} : { params }) });
    });
  }

  notify(method: string, params?: unknown): void {
    this.#write({ method, ...(params === undefined ? {} : { params }) });
  }

  respond(id: JsonRpcId, result: unknown): void {
    this.#write({ id, result });
  }

  respondError(id: JsonRpcId, code: number, message: string): void {
    this.#write({ id, error: { code, message } });
  }

  onNotification(
    listener: (notification: JsonRpcNotification) => void,
  ): () => void {
    this.#notificationListeners.add(listener);
    return () => this.#notificationListeners.delete(listener);
  }

  onServerRequest(
    listener: (request: JsonRpcServerRequest) => void,
  ): () => void {
    this.#requestListeners.add(listener);
    return () => this.#requestListeners.delete(listener);
  }

  onFailure(listener: (error: Error) => void): () => void {
    this.#failureListeners.add(listener);
    return () => this.#failureListeners.delete(listener);
  }

  waitForNotification<T>(options: {
    readonly method: string;
    readonly predicate?: (params: T) => boolean;
    readonly timeoutMs?: number;
    readonly signal?: AbortSignal;
  }): Promise<T> {
    if (this.#closed) {
      return Promise.reject(
        new CodexAppServerError("Codex App Server connection is closed."),
      );
    }
    return new Promise<T>((resolve, reject) => {
      let timeout: NodeJS.Timeout | undefined;
      let unsubscribeFailure: () => void = () => undefined;
      const cleanup = () => {
        unsubscribe();
        unsubscribeFailure();
        if (timeout) clearTimeout(timeout);
        options.signal?.removeEventListener("abort", onAbort);
      };
      const onAbort = () => {
        cleanup();
        reject(new CodexAppServerError("Codex operation was cancelled."));
      };
      const unsubscribe = this.onNotification((notification) => {
        if (notification.method !== options.method) return;
        const params = notification.params as T;
        if (options.predicate && !options.predicate(params)) return;
        cleanup();
        resolve(params);
      });
      unsubscribeFailure = this.onFailure((error) => {
        cleanup();
        reject(error);
      });
      if (options.timeoutMs !== undefined) {
        timeout = setTimeout(() => {
          cleanup();
          reject(
            new CodexAppServerError(`Timed out waiting for ${options.method}.`),
          );
        }, options.timeoutMs);
      }
      options.signal?.addEventListener("abort", onAbort, { once: true });
      if (options.signal?.aborted) onAbort();
    });
  }

  close(): void {
    if (this.#closed) return;
    this.#closed = true;
    this.#lines.close();
    this.#process.stdin.end();
    if (!this.#process.killed) this.#process.kill("SIGTERM");
    this.#failAll(new CodexAppServerError("Codex App Server was closed."));
  }

  #handleLine(line: string): void {
    let message: unknown;
    try {
      message = JSON.parse(line);
    } catch {
      return;
    }
    if (!isRecord(message)) return;
    const { id, error: rpcError, result, method, params } = message;
    if (typeof id === "number" && this.#pending.has(id)) {
      const pending = this.#pending.get(id);
      if (!pending) return;
      this.#pending.delete(id);
      clearTimeout(pending.timeout);
      if (isRecord(rpcError)) {
        const { message: errorMessage } = rpcError;
        const detail =
          typeof errorMessage === "string"
            ? errorMessage
            : "Unknown JSON-RPC error";
        pending.reject(new CodexAppServerError(detail));
      } else {
        pending.resolve(result);
      }
      return;
    }
    if (typeof method !== "string") return;
    if (typeof id === "number" || typeof id === "string") {
      const request = {
        id,
        method,
        params,
      } satisfies JsonRpcServerRequest;
      if (this.#requestListeners.size === 0) {
        this.respondError(id, -32_601, "Forge does not support this request.");
        return;
      }
      for (const listener of this.#requestListeners) listener(request);
      return;
    }
    const notification = {
      method,
      params,
    } satisfies JsonRpcNotification;
    for (const listener of this.#notificationListeners) listener(notification);
  }

  #write(message: unknown): void {
    if (this.#closed) {
      throw new CodexAppServerError("Codex App Server connection is closed.");
    }
    this.#process.stdin.write(`${JSON.stringify(message)}\n`);
  }

  #failAll(error: Error): void {
    for (const pending of this.#pending.values()) {
      clearTimeout(pending.timeout);
      pending.reject(error);
    }
    this.#pending.clear();
    for (const listener of this.#failureListeners) listener(error);
  }

  #safeStderr(): string {
    return this.#stderr
      .replace(/\bsk-[A-Za-z0-9_-]{8,}\b/gu, "[REDACTED]")
      .replace(/\bBearer\s+\S+/giu, "Bearer [REDACTED]")
      .replace(
        /\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/gu,
        "[REDACTED]",
      )
      .trim()
      .slice(-1_000);
  }
}

function defaultProcessFactory(
  options: CodexProcessFactoryOptions,
): ChildProcessWithoutNullStreams {
  return spawn(options.command, ["app-server", "--listen", "stdio://"], {
    cwd: options.cwd,
    env: options.env,
    stdio: ["pipe", "pipe", "pipe"],
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
