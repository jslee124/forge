import { createHash, randomUUID } from "node:crypto";
import {
  mkdir,
  open,
  readFile,
  realpath,
  stat,
  unlink,
} from "node:fs/promises";
import { join } from "node:path";
import {
  type CodexClient,
  createPersistentInteractiveSession,
  discoverCodexModels,
  loadForgeConfig,
  type PersistentInteractiveSession,
  type RunDependencies,
  runCodexAuthCommand,
  runCodexTask,
  runTask,
} from "@forge/application";
import { CodexAppServerClient } from "@forge/codex-app-server";
import { canonicalText, type RunEvent, type RunResult } from "@forge/core";
import {
  configuredSecrets,
  FileSessionStore,
  redactValue,
} from "@forge/persistence";
import type {
  DesktopState,
  ManagementCommand,
} from "../shared/application-protocol.js";
import type { RunExecutor } from "./run-service.js";
import { WebPluginSettings } from "./web-plugin-settings.js";

/** Electron-free orchestration. All credentials, configuration and persistence stay here. */
export class DesktopApplication {
  readonly #env: NodeJS.ProcessEnv;
  readonly #initialCwd: string;
  readonly #overrides: {
    createAdapter?: RunDependencies["createAdapter"];
    connect?: () => Promise<CodexClient>;
  };
  #cwd = "";
  #root = "";
  #automaticWorkspace = false;
  #home = "";
  #session: PersistentInteractiveSession | undefined;
  #auth: DesktopState["auth"] = "unknown";
  #loginUrl = "";
  #loginCode = "";
  #models: string[] = [];
  #login: AbortController | undefined;
  readonly #clients = new Set<CodexClient>();
  #busy = false;
  #revision = "";
  constructor(
    env: NodeJS.ProcessEnv,
    cwd: string,
    overrides: {
      createAdapter?: RunDependencies["createAdapter"];
      connect?: () => Promise<CodexClient>;
    } = {},
  ) {
    this.#env = env;
    this.#initialCwd = cwd;
    this.#overrides = overrides;
  }
  async state(): Promise<DesktopState> {
    const loaded = await loadForgeConfig({
      env: this.#env,
      cwd: this.#cwd || this.#initialCwd,
    });
    this.#home = loaded.forgeHome;
    const sessions = await new FileSessionStore(this.#home).list();
    return {
      web: await new WebPluginSettings(
        this.#env,
        this.#cwd || this.#initialCwd,
      ).state(),
      forgeHome: this.#home,
      cwd: this.#cwd,
      sessionId: this.#session?.sessionId ?? "",
      model: loaded.config.model.id,
      provider: loaded.config.model.provider,
      sessions: sessions.map((s) => ({ id: s.id, title: s.title })),
      messages: (this.#session?.messages ?? []).flatMap((m, index) =>
        m.role === "tool"
          ? []
          : [
              {
                id: `${this.#session?.sessionId}-${index}`,
                role: m.role,
                content: String(
                  redactValue(canonicalText(m), configuredSecrets(this.#env)),
                ),
              },
            ],
      ),
      context: this.#session?.contextStatus() ?? "",
      auth: this.#auth,
      loginUrl: this.#loginUrl,
      loginCode: this.#loginCode,
      codexModels: this.#models,
    };
  }
  async manage(command: ManagementCommand): Promise<DesktopState> {
    if (command.type === "state") return this.state();
    if (command.type === "cancel-login") {
      this.#login?.abort();
      return this.state();
    }
    if (this.#busy) throw new Error("busy");
    if (
      command.type === "web-install" ||
      command.type === "web-enable" ||
      command.type === "web-configure"
    ) {
      await new WebPluginSettings(
        this.#env,
        this.#cwd || this.#initialCwd,
      ).manage(command);
    } else if (command.type === "workspace") {
      const cwd = await directoryPath(command.cwd);
      const session = await createPersistentInteractiveSession({
        cwd,
        env: this.#env,
      });
      this.#root = (
        await loadForgeConfig({ cwd, env: this.#env })
      ).workspaceRoot;
      this.#cwd = cwd;
      this.#automaticWorkspace = false;
      this.#session = session;
      this.#revision = "";
    } else if (command.type === "create") {
      if (!command.prompt.trim()) throw new Error("prompt-required");
      const automatic = !this.#cwd || this.#automaticWorkspace;
      let cwd = this.#cwd;
      if (automatic) {
        await this.state();
        cwd = join(this.#home, "workspaces", randomUUID());
        await mkdir(cwd, { recursive: true, mode: 0o700 });
      }
      cwd = await directoryPath(cwd);
      const loaded = await loadForgeConfig({ cwd, env: this.#env });
      if (automatic && loaded.workspaceRoot !== cwd)
        throw new Error("auto-workspace-boundary");
      const session = await createPersistentInteractiveSession({
        cwd,
        env: this.#env,
      });
      await session.prepareRun(command.prompt);
      this.#cwd = cwd;
      this.#root = loaded.workspaceRoot;
      this.#automaticWorkspace = automatic;
      this.#session = session;
      this.#revision = "";
    } else if (command.type === "resume") {
      await this.state();
      const file = join(this.#home, "sessions", `${command.sessionId}.json`);
      const lockPath = join(
        this.#home,
        "sessions",
        `${command.sessionId}.desktop-lock`,
      );
      const handle = await open(lockPath, "wx", 0o600).catch(() => {
        throw new Error("session-busy");
      });
      try {
        const saved = await new FileSessionStore(this.#home).load(
          command.sessionId,
        );
        const cwd = await directoryPath(saved.workingDirectory);
        const loaded = await loadForgeConfig({ cwd, env: this.#env });
        if (
          cwd !== saved.workingDirectory ||
          loaded.workspaceRoot !== saved.workspaceRoot
        )
          throw new Error("workspace-changed");
        const session = await createPersistentInteractiveSession({
          cwd,
          env: this.#env,
          sessionId: command.sessionId,
        });
        this.#cwd = cwd;
        this.#root = loaded.workspaceRoot;
        this.#automaticWorkspace =
          cwd.startsWith(`${await realpath(this.#home)}/workspaces/`) &&
          loaded.workspaceRoot === cwd;
        this.#session = session;
        this.#revision = await snapshotHash(file);
      } finally {
        await handle.close();
        await unlink(lockPath);
      }
    } else if (command.type === "compact") {
      const session = this.#session;
      if (!session?.sessionId) throw new Error("session-required");
      const file = join(this.#home, "sessions", `${session.sessionId}.json`);
      const lock = join(
        this.#home,
        "sessions",
        `${session.sessionId}.desktop-lock`,
      );
      const handle = await open(lock, "wx", 0o600);
      try {
        if ((await snapshotHash(file)) !== this.#revision)
          throw new Error("session-conflict");
        await session.compact(false);
        this.#revision = await snapshotHash(file);
      } finally {
        await handle.close();
        await unlink(lock);
      }
    } else if (command.type === "auth-status") {
      if (this.#login) return this.state();
      const dependencies = this.#codexDependencies(
        new AbortController().signal,
      );
      let client: CodexClient | undefined;
      try {
        client = await dependencies.connect();
        const result = await client.request<{
          account: { type?: string } | null;
        }>("account/read", { refreshToken: false });
        if (!result || !("account" in result))
          throw new Error("invalid-account-response");
        // Native API-key authentication does not authorize the ChatGPT execution path.
        this.#auth =
          result.account?.type === "chatgpt" ? "authenticated" : "signed-out";
        this.#models = [];
        if (this.#auth === "authenticated") {
          this.#models = await discoverCodexModels({ ...dependencies, client })
            .then((models) => models.map((model) => model.id))
            .catch(() => []);
        }
      } catch {
        this.#auth = "unavailable";
        this.#models = [];
      } finally {
        client?.close();
      }
    } else if (command.type === "login") {
      if (!this.#login) {
        const controller = new AbortController();
        const previousAuth = this.#auth;
        this.#login = controller;
        this.#auth = "signing-in";
        void runCodexAuthCommand(
          "login",
          "openai",
          {},
          {
            ...this.#codexDependencies(controller.signal),
            onOutput: (event) => {
              if (event.type === "login" && !controller.signal.aborted) {
                this.#loginUrl = event.url;
                this.#loginCode = event.userCode ?? "";
              }
            },
          },
        )
          .then((code) => {
            this.#auth = controller.signal.aborted
              ? previousAuth
              : code === 0
                ? "authenticated"
                : "failed";
          })
          .finally(() => {
            this.#login = undefined;
            this.#loginUrl = "";
            this.#loginCode = "";
          });
      }
    }
    return this.state();
  }
  close(): void {
    this.#login?.abort();
    for (const client of this.#clients) client.close();
    this.#clients.clear();
  }
  readonly execute: RunExecutor = async (request, context) => {
    if (
      this.#busy ||
      !this.#session ||
      this.#session.sessionId !== request.sessionId
    )
      throw new Error("session-mismatch");
    this.#busy = true;
    const session = this.#session;
    let release: (() => Promise<void>) | undefined;
    try {
      if ((await directoryPath(this.#cwd)) !== this.#cwd)
        throw new Error("workspace-changed");
      await this.state();
      const directory = join(this.#home, "sessions");
      await mkdir(directory, { recursive: true, mode: 0o700 });
      const lock = join(directory, `${request.sessionId}.desktop-lock`);
      const handle = await open(lock, "wx", 0o600).catch(() => {
        throw new Error("session-busy");
      });
      release = async () => {
        await handle.close();
        await unlink(lock);
      };
      const snapshotPath = join(directory, `${request.sessionId}.json`);
      let before = await snapshotHash(snapshotPath);
      if (before !== this.#revision) throw new Error("session-conflict");
      const loaded = await loadForgeConfig({ env: this.#env, cwd: this.#cwd });
      if (loaded.workspaceRoot !== this.#root)
        throw new Error("workspace-changed");
      const redact = (text: string) =>
        String(redactValue(text, configuredSecrets(this.#env)));
      const detail = (
        kind: "tool" | "context" | "error" | "system" | "reasoning",
        text: string,
      ) => context.detail(kind, redact(text));
      await session.prepareRun(request.prompt);
      before = await snapshotHash(snapshotPath);
      this.#revision = before;
      if (context.signal.aborted) return;
      let result: RunResult | undefined;
      const model = request.model;
      const { FORGE_DESKTOP_RESOURCE_ROOT: builtinResourceRoot } = this.#env;
      const shared = {
        env: this.#env,
        cwd: this.#cwd,
        signal: context.signal,
        stderr: { write: (text: string) => detail("error", text) },
      };
      if (request.engine === "native") {
        session.selectModel(
          loaded.config.model.provider,
          model ?? loaded.config.model.id,
        );
        const code = await runTask(
          request.prompt,
          { ...(model ? { model } : {}), permissionProfile: "safe" },
          {
            ...shared,
            ...(builtinResourceRoot ? { builtinResourceRoot } : {}),
            sessionId: request.sessionId,
            runId: request.runId,
            conversation: session.conversationForEngine("native"),
            ...(session.contextCheckpoint
              ? { contextCheckpoint: session.contextCheckpoint }
              : {}),
            ...(this.#overrides.createAdapter
              ? { createAdapter: this.#overrides.createAdapter }
              : {}),
            approvalChannel: {
              request: (action) =>
                context.approve(
                  redact(
                    `${action.tool.name}\n${JSON.stringify(action.input, null, 2)}`,
                  ),
                ),
              requestStructured: async (
                action,
                _signal,
                _toolContext,
                descriptor,
              ) => ({
                kind: (await context.approve(
                  redact(
                    `${descriptor.preview}\n${JSON.stringify(action.input, null, 2)}`,
                  ),
                ))
                  ? "allow-once"
                  : "deny",
              }),
            },
            onEvent: (event) => {
              if (event.type === "model.text") context.text(redact(event.text));
              else if (event.type === "model.reasoning")
                detail("reasoning", event.text);
              else if (event.type.startsWith("tool."))
                detail("tool", JSON.stringify(event));
              else if (event.type.startsWith("context."))
                detail("context", JSON.stringify(event));
            },
            onResult: (value) => {
              result = value;
            },
          },
        );
        if (!result)
          throw new Error(code === 130 ? "cancelled" : "native-start-failed");
      } else {
        let answer = "";
        const events: RunEvent[] = [];
        const code = await runCodexTask(
          request.prompt,
          { ...(model ? { model } : {}), permissionProfile: "workspace-write" },
          {
            ...this.#codexDependencies(context.signal),
            ...shared,
            conversation: session.messages,
            onOutput: (event) => {
              if (event.type === "answer") {
                answer += event.text;
                context.text(redact(event.text));
              } else if (event.type === "reasoning") {
                events.push({
                  type: "model.reasoning",
                  step: 1,
                  text: event.text,
                });
                detail("reasoning", event.text);
              } else
                detail(event.type === "tool" ? "tool" : "system", event.text);
            },
            approve: (description) => context.approve(redact(description)),
          },
        );
        result = {
          status:
            code === 0 ? "completed" : code === 130 ? "cancelled" : "failed",
          exitCode: code,
          finalText: answer,
          modelSteps: 1,
          toolCalls: 0,
          events,
        };
      }
      if (before !== (await snapshotHash(snapshotPath)))
        throw new Error("session-conflict");
      await session.recordRun(request.prompt, result, {
        runId: request.runId,
        engine: request.engine,
        sessionId: request.sessionId,
        tracePersisted:
          request.engine === "native" && loaded.config.trace.enabled,
      });
      this.#revision = await snapshotHash(snapshotPath);
      detail("context", session.contextStatus());
      if (result.message) detail("error", result.message);
      if (result.status !== "completed" && result.status !== "cancelled")
        throw new Error(`run-${result.status}`);
      return result.status;
    } catch (error) {
      context.detail("error", desktopError(error));
      throw error;
    } finally {
      try {
        await release?.();
      } finally {
        this.#busy = false;
      }
    }
  };
  #codexDependencies(signal: AbortSignal) {
    return {
      env: this.#env,
      cwd: this.#cwd || this.#initialCwd,
      signal,
      isTTY: false,
      stdout: { write: (_text: string) => undefined },
      stderr: { write: (_text: string) => undefined },
      connect: async () => {
        const client = await (this.#overrides.connect
          ? this.#overrides.connect()
          : CodexAppServerClient.connect({
              env: this.#env,
              cwd: this.#cwd || this.#initialCwd,
            }));
        const close = client.close.bind(client);
        client.close = () => {
          this.#clients.delete(client);
          close();
        };
        this.#clients.add(client);
        if (signal.aborted) {
          client.close();
          throw new Error("cancelled");
        }
        return client;
      },
    };
  }
}
async function snapshotHash(path: string): Promise<string> {
  try {
    return createHash("sha256")
      .update(await readFile(path))
      .digest("hex");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return "";
    throw error;
  }
}

async function directoryPath(path: string): Promise<string> {
  const resolved = await realpath(path).catch(() => {
    throw new Error("workspace-unavailable");
  });
  if (!(await stat(resolved)).isDirectory())
    throw new Error("workspace-unavailable");
  return resolved;
}

/** Only stable codes cross IPC; configuration/parser errors can contain secrets. */
export function desktopError(error: unknown): string {
  if (error instanceof Error) {
    if (/^[a-z-]+$/.test(error.message)) return error.message;
    if (error.name === "ForgeConfigError") return "configuration-invalid";
    if (error.name === "PersistenceError") return "session-storage-failed";
  }
  return "management-failed";
}
