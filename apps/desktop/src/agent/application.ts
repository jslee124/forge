import { createHash, randomUUID } from "node:crypto";
import { lstat, mkdir, readFile, realpath, stat } from "node:fs/promises";
import { join } from "node:path";
import {
  AuthenticationManager,
  type CodexClient,
  changeProjectPluginTrust,
  createForgeModelAdapter,
  createPersistentInteractiveSession,
  detectStartupResources,
  discoverCodexModels,
  discoverPlugins,
  loadForgeConfig,
  type ModelCatalogEntry,
  nativeModelCatalog,
  type PersistentInteractiveSession,
  type PreparedRunRecovery,
  type ProductRunCompletion,
  ProductRunRecorder,
  prepareRunRecovery,
  projectActionEvent,
  projectRecordedActivity,
  projectRunCompletion,
  projectRunDelivery,
  projectSessionMessages,
  type RunDependencies,
  removeUserProviderModel,
  runCodexAuthCommand,
  runCodexTask,
  runTask,
  saveUserModelSelection,
  setUserPluginEnabled,
  summarizeRecordedRun,
} from "@forge/application";
import { CodexAppServerClient } from "@forge/codex-app-server";
import type { RunEvent, RunResult } from "@forge/core";
import {
  acquireWorkspaceLease,
  configuredSecrets,
  ExecutionLease,
  FileProductRunStore,
  FileSessionStore,
  type ProductRecordPayload,
  redactValue,
} from "@forge/persistence";
import type {
  DesktopState,
  ManagementCommand,
  ModelSelection,
  RecoveryPlan,
} from "../shared/application-protocol.js";
import type { RunCommand } from "../shared/run-protocol.js";
import type { ExecutionContext, RunExecutor } from "./run-service.js";
import { WebPluginSettings } from "./web-plugin-settings.js";

interface RecoveryPreparation {
  view: RecoveryPlan;
  prepared: PreparedRunRecovery;
  revision: string;
  configuration: string;
  executionConfiguration: string;
}

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
  #codexCatalog: ModelCatalogEntry[] = [];
  #catalogError = "";
  #operationResult = "";
  #management: DesktopState["management"];
  #login: AbortController | undefined;
  readonly #clients = new Set<CodexClient>();
  #busy = false;
  #managementBusy = false;
  #revision = "";
  #runHistory: DesktopState["runHistory"];
  #historyPageBefore: number | undefined;
  #recovery: RecoveryPreparation | undefined;
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
      management: this.#management,
      web: await new WebPluginSettings(
        this.#env,
        this.#cwd || this.#initialCwd,
      ).state(),
      modelCatalog: [
        ...nativeModelCatalog(loaded.config.providers),
        ...this.#codexCatalog,
      ],
      modelCatalogError: this.#catalogError,
      defaultSelection: {
        engine: loaded.config.model.engine === "codex" ? "codex" : "native",
        provider: loaded.config.model.provider,
        model: loaded.config.model.id,
        effort: loaded.config.model.reasoningEffort,
      },
      operationResult: this.#operationResult,
      ...(this.#runHistory ? { runHistory: this.#runHistory } : {}),
      ...(this.#recovery ? { recoveryPlan: this.#recovery.view } : {}),
      permissionGrants: [],
      contextUpdatedAt: new Date().toISOString(),
      forgeHome: this.#home,
      cwd: this.#cwd,
      automaticWorkspace: this.#automaticWorkspace,
      sessionId: this.#session?.sessionId ?? "",
      model: loaded.config.model.id,
      provider: loaded.config.model.provider,
      sessions: sessions.map((s) => ({
        id: s.id,
        title: s.title,
        cwd: s.workingDirectory,
      })),
      messages: projectSessionMessages(
        this.#session?.history ?? [],
        this.#session?.recordedRunIds ?? [],
      ).map((message) => ({
        ...message,
        content: String(
          redactValue(message.content, configuredSecrets(this.#env)),
        ),
      })),
      context: this.#session?.contextStatus() ?? "",
      ...(this.#session?.sessionId && this.#session.contextDetails
        ? {
            contextUsage: {
              used: this.#session.contextDetails().estimatedTranscriptTokens,
              total: this.#session.contextDetails().availableInputTokens,
            },
          }
        : {}),
      auth: this.#auth,
      loginUrl: this.#loginUrl,
      loginCode: this.#loginCode,
      codexModels: this.#models,
    };
  }
  async #refreshModels() {
    this.#catalogError = "";
    try {
      const models = await discoverCodexModels(
        this.#codexDependencies(new AbortController().signal),
      );
      this.#models = models.map((x) => x.id);
      this.#codexCatalog = models.map((x) => ({
        engine: "codex",
        provider: "openai",
        id: x.id,
        label: x.displayName,
        efforts: x.supportedReasoningEfforts.map((e) => e.reasoningEffort),
        defaultEffort: x.defaultReasoningEffort,
      }));
    } catch {
      this.#models = [];
      this.#codexCatalog = [];
      this.#catalogError = "codex-models-unavailable";
    }
  }
  async #validateSelection(selection: ModelSelection) {
    const loaded = await loadForgeConfig({
      env: this.#env,
      cwd: this.#cwd || this.#initialCwd,
    });
    if (selection.engine === "codex" && !this.#codexCatalog.length)
      await this.#refreshModels();
    const entry = [
      ...nativeModelCatalog(loaded.config.providers),
      ...this.#codexCatalog,
    ].find(
      (x) =>
        x.engine === selection.engine &&
        x.provider === selection.provider &&
        x.id === selection.model,
    );
    if (!entry) throw new Error("model-unavailable");
    if (selection.effort && !entry.efforts.includes(selection.effort))
      throw new Error("effort-unavailable");
    return entry;
  }
  async manage(command: ManagementCommand): Promise<DesktopState> {
    if (command.type === "browse-session") return this.#browseSession(command);
    if (command.type === "state" || command.type === "cancel-login")
      return this.#manage(command);
    if (this.#managementBusy || this.#busy) throw new Error("busy");
    this.#managementBusy = true;
    try {
      return await this.#manage(command);
    } finally {
      this.#managementBusy = false;
    }
  }
  async #manage(command: ManagementCommand): Promise<DesktopState> {
    if (command.type === "state") return this.state();
    if (command.type === "dismiss-recovery") {
      this.#recovery = undefined;
      return this.state();
    }
    if (command.type === "prepare-recovery") {
      const session = this.#session;
      if (!session?.sessionId) throw new Error("session-required");
      if (command.selection.engine !== "native")
        throw new Error("recovery-native-only");
      await this.state();
      const lease = await desktopSessionLease(this.#home, session.sessionId);
      try {
        const revision = await snapshotHash(
          join(this.#home, "sessions", `${session.sessionId}.json`),
        );
        if (revision !== this.#revision) throw new Error("session-conflict");
        const loaded = await loadForgeConfig({
          cwd: this.#cwd,
          env: this.#env,
        });
        const entry = await this.#validateSelection(command.selection);
        const selection = {
          ...command.selection,
          effort:
            command.selection.effort ??
            (entry.defaultEffort as import("../shared/application-protocol.js").ModelSelection["effort"]),
        };
        const store = new FileProductRunStore(this.#home, {
          secrets: configuredSecrets(this.#env),
        });
        await store.reconcile(session.sessionId, session.recordedRunIds);
        const prepared = prepareRunRecovery(
          await store.read(session.sessionId, command.sourceRunId),
          session.history,
          command.kind,
        );
        const view: RecoveryPlan = {
          token: randomUUID(),
          sessionId: session.sessionId,
          sourceRunId: command.sourceRunId,
          kind: command.kind,
          prompt: String(
            redactValue(prepared.prompt, configuredSecrets(this.#env)),
          ),
          selection,
          permissionProfile:
            command.kind === "summarize" ? "safe" : command.permissionProfile,
          maxModelSteps:
            command.kind === "summarize" ? 1 : loaded.config.limits.maxSteps,
          maxToolCalls:
            command.kind === "summarize"
              ? 0
              : loaded.config.limits.maxToolCalls,
          incomplete: prepared.incomplete,
        };
        const execution = await loadForgeConfig({
          cwd: this.#cwd,
          env: this.#env,
          cli: recoveryOptions(view),
        });
        this.#recovery = {
          view,
          prepared,
          revision,
          configuration: recoveryConfiguration(loaded.config),
          executionConfiguration: recoveryConfiguration(execution.config),
        };
      } finally {
        await lease.release();
      }
      return this.state();
    }
    if (command.type === "run-history") {
      if (this.#busy) throw new Error("busy");
      const session = this.#session;
      if (!session?.sessionId) throw new Error("session-required");
      const lease = await desktopSessionLease(this.#home, session.sessionId);
      try {
        await new FileProductRunStore(this.#home).reconcile(
          session.sessionId,
          session.recordedRunIds,
        );
        await this.#loadRunHistory(
          command.runId
            ? (command.before ?? this.#historyPageBefore)
            : command.before,
          command.runId,
        );
      } finally {
        await lease.release();
      }
      return this.state();
    }
    if (command.type === "cancel-login") {
      this.#login?.abort();
      return this.state();
    }
    if (this.#busy) throw new Error("busy");
    if (command.type === "check-readiness") {
      // Local validation only: no session creation, model request or authority grant.
      const selection = command.selection;
      if (selection && selection.engine !== command.engine)
        throw new Error("configuration-invalid");
      if (command.engine === "codex") {
        const current = await this.#manage({ type: "auth-status" });
        return {
          ...current,
          readiness:
            current.auth === "authenticated"
              ? { ready: true }
              : {
                  ready: false,
                  issue:
                    current.auth === "unavailable"
                      ? "codex_unavailable"
                      : "codex_sign_in",
                },
        };
      }
      const loaded = await loadForgeConfig({
        env: this.#env,
        cwd: this.#cwd || this.#initialCwd,
        cli: {
          engine: "forge",
          ...(selection
            ? {
                provider: selection.provider,
                model: selection.model,
                ...(selection.effort
                  ? { reasoningEffort: selection.effort }
                  : {}),
              }
            : {}),
        },
      }).catch(() => undefined);
      if (!loaded)
        return {
          ...(await this.state()),
          readiness: { ready: false, issue: "invalid_configuration" },
        };
      const provider = loaded.config.model.provider;
      const profile = loaded.config.providers[provider];
      let issue: "missing_credentials" | "invalid_configuration" | undefined;
      if (!this.#overrides.createAdapter) {
        if (!["deepseek", "openai"].includes(provider) && !profile)
          issue = "invalid_configuration";
        else if (
          profile?.auth.type !== "none" &&
          !new AuthenticationManager(this.#env).status(provider, {
            ...(profile ? { endpoint: profile.baseUrl } : {}),
            ...(profile?.auth.type === "bearer" && profile.auth.apiKeyEnv
              ? { environmentVariable: profile.auth.apiKeyEnv }
              : {}),
          }).authenticated
        )
          issue = "missing_credentials";
        if (!issue) {
          try {
            createForgeModelAdapter({
              env: this.#env,
              provider,
              model: loaded.config.model.id,
              thinking:
                loaded.config.model.thinking === "disabled"
                  ? "disabled"
                  : "enabled",
              reasoningEffort: loaded.config.model.reasoningEffort,
              providers: loaded.config.providers,
            });
          } catch {
            issue = "invalid_configuration";
          }
        }
      }
      return {
        ...(await this.state()),
        readiness: issue ? { ready: false, issue } : { ready: true },
      };
    }
    this.#operationResult = "";
    if (
      [
        "management-status",
        "native-login",
        "logout",
        "model-delete",
        "plugin-enable",
        "project-trust",
      ].includes(command.type)
    ) {
      const cwd = this.#cwd || this.#initialCwd;
      const loaded = await loadForgeConfig({ cwd, env: this.#env });
      const auth = new AuthenticationManager(this.#env);
      const providers = [
        "deepseek",
        "openai",
        ...Object.keys(loaded.config.providers),
      ];
      if (
        command.type === "native-login" ||
        (command.type === "logout" && command.engine === "native")
      ) {
        if (!providers.includes(command.provider))
          throw new Error("unknown-provider");
        const profile = loaded.config.providers[command.provider];
        if (profile?.auth.type === "none")
          throw new Error("provider-needs-no-key");
        if (command.type === "native-login") {
          await auth.storeApiKey(
            command.provider,
            command.apiKey,
            profile ? { endpoint: profile.baseUrl } : {},
          );
          this.#operationResult =
            "Credential saved locally; provider connection not tested.";
        } else {
          await auth.removeStoredApiKey(command.provider);
          this.#operationResult =
            "Stored credential removed. Environment credentials, if present, remain active.";
        }
      } else if (command.type === "logout") {
        if (command.provider !== "openai") throw new Error("unknown-provider");
        if (this.#login) throw new Error("busy");
        const code = await runCodexAuthCommand(
          "logout",
          "openai",
          {},
          this.#codexDependencies(new AbortController().signal),
        );
        if (code !== 0) throw new Error("logout-failed");
        this.#auth = "signed-out";
        this.#models = [];
        this.#codexCatalog = [];
        this.#operationResult =
          "Codex signed out; native credentials unchanged.";
      } else if (command.type === "model-delete") {
        if (
          loaded.config.model.provider === command.provider &&
          loaded.config.model.id === command.model
        )
          throw new Error("select-another-default-first");
        const result = await removeUserProviderModel({
          cwd,
          env: this.#env,
          route: command.provider,
          model: command.model,
        });
        if (!result.removed) throw new Error("model-not-user-configured");
        this.#operationResult =
          "User model removed. Project configuration may still supply this model.";
      } else if (command.type === "plugin-enable") {
        const installed = await discoverPlugins({
          root: join(loaded.forgeHome, "plugins"),
          scope: "user",
        });
        if (!installed.some((x) => x.manifest.name === command.name))
          throw new Error("plugin-not-installed");
        await setUserPluginEnabled({
          cwd,
          env: this.#env,
          name: command.name,
          enabled: command.enabled,
        });
      } else if (command.type === "project-trust") {
        await changeProjectPluginTrust({
          cwd,
          env: this.#env,
          trusted: command.trusted,
        });
      }
      await this.#readManagement();
      return this.state();
    }
    if (command.type === "models-refresh") {
      await this.#refreshModels();
      return this.state();
    }
    if (command.type === "model-save") {
      await this.#validateSelection(command.selection);
      const value = command.selection;
      await saveUserModelSelection({
        cwd: this.#cwd || this.#initialCwd,
        env: this.#env,
        selection: {
          engine: value.engine === "native" ? "forge" : "codex",
          provider: value.provider,
          id: value.model,
          ...(value.effort
            ? {
                reasoningEffort: value.effort,
                thinking:
                  value.effort === "none"
                    ? ("disabled" as const)
                    : ("enabled" as const),
              }
            : {}),
        },
      });
      this.#operationResult = "Default model saved";
      return this.state();
    }
    if (
      command.type === "web-install" ||
      command.type === "web-enable" ||
      command.type === "web-configure"
    ) {
      await new WebPluginSettings(
        this.#env,
        this.#cwd || this.#initialCwd,
      ).manage(command);
    } else if (command.type === "reset") {
      this.#recovery = undefined;
      this.#runHistory = undefined;
      this.#session?.clear();
      this.#revision = "";
    } else if (command.type === "workspace") {
      this.#recovery = undefined;
      this.#runHistory = undefined;
      this.#management = undefined;
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
      this.#recovery = undefined;
      this.#runHistory = undefined;
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
      this.#recovery = undefined;
      await this.state();
      const file = join(this.#home, "sessions", `${command.sessionId}.json`);
      const lease = await desktopSessionLease(this.#home, command.sessionId);
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
        try {
          await new FileProductRunStore(this.#home, {
            secrets: configuredSecrets(this.#env),
          }).reconcile(command.sessionId, session.recordedRunIds);
          await this.#loadRunHistory();
        } catch {
          this.#runHistory = { runs: [], error: "product-run-storage-failed" };
        }
      } finally {
        await lease.release();
      }
    } else if (command.type === "compact") {
      const session = this.#session;
      if (!session?.sessionId) throw new Error("session-required");
      const file = join(this.#home, "sessions", `${session.sessionId}.json`);
      const lease = await desktopSessionLease(this.#home, session.sessionId);
      try {
        if ((await snapshotHash(file)) !== this.#revision)
          throw new Error("session-conflict");
        this.#operationResult = await session.compact(command.dryRun ?? false);
        this.#revision = await snapshotHash(file);
      } finally {
        await lease.release();
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
        this.#codexCatalog = [];
        if (this.#auth === "authenticated") {
          this.#models = await discoverCodexModels({ ...dependencies, client })
            .then((models) => {
              this.#codexCatalog = models.map((x) => ({
                engine: "codex",
                provider: "openai",
                id: x.id,
                label: x.displayName,
                efforts: x.supportedReasoningEfforts.map(
                  (e) => e.reasoningEffort,
                ),
                defaultEffort: x.defaultReasoningEffort,
              }));
              return models.map((model) => model.id);
            })
            .catch(() => []);
        }
      } catch {
        this.#auth = "unavailable";
        this.#models = [];
        this.#codexCatalog = [];
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
  async #readManagement(): Promise<void> {
    const loaded = await loadForgeConfig({
      cwd: this.#cwd || this.#initialCwd,
      env: this.#env,
    });
    const auth = new AuthenticationManager(this.#env);
    const diagnostics: string[] = [];
    const resources = await detectStartupResources({
      forgeHome: loaded.forgeHome,
      workspaceRoot: loaded.workspaceRoot,
      enabledUserPlugins: loaded.config.plugins.enabled,
      disabledModelInvocation: loaded.config.resources.disabledModelInvocation,
    }).catch(() => {
      diagnostics.push("Resource discovery failed; inspect local manifests.");
      return { plugins: [], skills: [], diagnostics: [] };
    });
    const installed = await discoverPlugins({
      root: join(loaded.forgeHome, "plugins"),
      scope: "user",
    }).catch(() => {
      diagnostics.push("User plugin discovery failed.");
      return [];
    });
    this.#management = {
      providers: [
        ...new Set([
          "deepseek",
          "openai",
          ...Object.keys(loaded.config.providers),
        ]),
      ].map((id) => {
        const profile = loaded.config.providers[id];
        const status = auth.status(id, {
          ...(profile ? { endpoint: profile.baseUrl } : {}),
          ...(profile?.auth.type === "bearer" && profile.auth.apiKeyEnv
            ? { environmentVariable: profile.auth.apiKeyEnv }
            : {}),
        });
        return {
          id,
          authenticated: status.authenticated,
          source: status.source ?? "none",
          environmentVariable: status.environmentVariable,
        };
      }),
      models: Object.entries(loaded.config.providers).flatMap(
        ([provider, profile]) =>
          (profile.models ?? []).map((m) => ({ provider, id: m.id })),
      ),
      plugins: [
        ...installed.map((p) => ({
          name: p.manifest.name,
          version: p.manifest.version,
          scope: "user",
          state: loaded.config.plugins.enabled.includes(p.manifest.name)
            ? "enabled"
            : "disabled",
        })),
        ...resources.plugins
          .filter((p) => p.scope === "project")
          .map((p) => ({
            name: p.name,
            version: p.version,
            scope: p.scope,
            state: p.state,
          })),
      ],
      skills: resources.skills.map((s) => ({
        name: s.name,
        path: s.path,
        source: s.source,
        status: s.status ?? s.invocation,
      })),
      diagnostics: [...diagnostics, ...(resources.diagnostics ?? [])],
    };
  }
  close(): void {
    this.#login?.abort();
    for (const client of this.#clients) client.close();
    this.#clients.clear();
  }
  readonly execute: RunExecutor = Object.assign(
    async (
      request: Extract<RunCommand, { type: "start" }>,
      context: ExecutionContext,
    ): Promise<ProductRunCompletion> => {
      if (
        this.#busy ||
        this.#managementBusy ||
        !this.#session ||
        this.#session.sessionId !== request.sessionId
      )
        throw new Error("session-mismatch");
      this.#busy = true;
      const startedAt = performance.now();
      const session = this.#session;
      let lease: ExecutionLease | undefined;
      let workspaceLease: ExecutionLease | undefined;
      let recorder: ProductRunRecorder | undefined;
      let recoveryLink:
        | import("@forge/persistence").ProductRecoveryLink
        | undefined;
      const storageAbort = new AbortController();
      const signal = AbortSignal.any([context.signal, storageAbort.signal]);
      let finalCompletion: ProductRunCompletion | undefined;
      try {
        if ((await directoryPath(this.#cwd)) !== this.#cwd)
          throw new Error("workspace-changed");
        await this.state();
        const directory = join(this.#home, "sessions");
        await mkdir(directory, { recursive: true, mode: 0o700 });
        lease = await desktopSessionLease(this.#home, request.sessionId);
        const snapshotPath = join(directory, `${request.sessionId}.json`);
        let before = await snapshotHash(snapshotPath);
        if (before !== this.#revision) throw new Error("session-conflict");
        const loaded = await loadForgeConfig({
          env: this.#env,
          cwd: this.#cwd,
        });
        if (loaded.workspaceRoot !== this.#root)
          throw new Error("workspace-changed");
        const redact = (text: string) =>
          String(redactValue(text, configuredSecrets(this.#env)));
        const detail = (
          kind: "tool" | "context" | "error" | "system" | "reasoning",
          text: string,
        ) => context.detail(kind, redact(text));
        const matchingDefault =
          (loaded.config.model.engine === "codex" ? "codex" : "native") ===
          request.engine;
        if (request.engine === "native" && !matchingDefault && !request.model)
          throw new Error("model-required");
        const model =
          request.model ??
          (request.engine === "codex" && matchingDefault
            ? loaded.config.model.id
            : undefined);
        const effort =
          request.reasoningEffort ??
          (request.engine === "codex" &&
          matchingDefault &&
          (!request.model || request.model === loaded.config.model.id)
            ? loaded.config.model.reasoningEffort
            : undefined);
        const provider =
          request.provider ??
          (request.engine === "codex"
            ? "openai"
            : loaded.config.model.provider);
        if (model || request.provider || effort)
          await this.#validateSelection({
            engine: request.engine,
            provider,
            model: model ?? loaded.config.model.id,
            ...(effort ? { effort: effort as ModelSelection["effort"] } : {}),
          });
        workspaceLease = await acquireWorkspaceLease(this.#root);
        let recovery: RecoveryPreparation | undefined;
        let recoveryConfigurationSnapshot:
          | Awaited<ReturnType<typeof loadForgeConfig>>
          | undefined;
        if (request.recovery) {
          recovery = this.#recovery;
          if (
            !recovery ||
            recovery.view.token !== request.recovery.token ||
            recovery.view.sessionId !== request.sessionId ||
            recovery.view.kind !== request.recovery.kind ||
            recovery.view.sourceRunId !== request.recovery.sourceRunId ||
            recovery.revision !== before ||
            recovery.configuration !== recoveryConfiguration(loaded.config)
          )
            throw new Error("recovery-stale");
          const actualSelection = {
            engine: request.engine,
            provider,
            model: model ?? loaded.config.model.id,
            effort: effort ?? loaded.config.model.reasoningEffort,
          };
          if (
            actualSelection.engine !== recovery.view.selection.engine ||
            actualSelection.provider !== recovery.view.selection.provider ||
            actualSelection.model !== recovery.view.selection.model ||
            actualSelection.effort !== recovery.view.selection.effort ||
            (request.permissionProfile ?? "safe") !==
              recovery.view.permissionProfile ||
            (recovery.view.kind !== "retry" &&
              request.prompt !== recovery.view.prompt)
          )
            throw new Error("recovery-stale");
          const record = await new FileProductRunStore(this.#home, {
            secrets: configuredSecrets(this.#env),
          }).read(request.sessionId, request.recovery.sourceRunId);
          const current = prepareRunRecovery(
            record,
            session.history,
            request.recovery.kind,
          );
          if (current.sourceFingerprint !== recovery.prepared.sourceFingerprint)
            throw new Error("recovery-stale");
          recoveryConfigurationSnapshot = await loadForgeConfig({
            cwd: this.#cwd,
            env: this.#env,
            cli: recoveryOptions(recovery.view),
          });
          if (
            recoveryConfiguration(recoveryConfigurationSnapshot.config) !==
            recovery.executionConfiguration
          )
            throw new Error("recovery-stale");
          recoveryLink = recovery.prepared.link;
          this.#recovery = undefined;
        } else {
          this.#recovery = undefined;
        }
        await session.prepareRun(request.prompt);
        await session.persistPreparedSession();
        before = await snapshotHash(snapshotPath);
        this.#revision = before;
        if (signal.aborted)
          return { outcome: "cancelled", reason: "cancelled" };
        recorder = new ProductRunRecorder(
          await new FileProductRunStore(this.#home, {
            secrets: configuredSecrets(this.#env),
          }).create({
            sessionId: request.sessionId,
            runId: request.runId,
            engine: request.engine,
            prompt: request.prompt,
            ...(recovery ? { recovery: recovery.prepared.link } : {}),
          }),
        );
        recorder.controller.signal.addEventListener(
          "abort",
          () => storageAbort.abort(),
          { once: true },
        );
        context.ready?.();
        const record = recorder;
        const observe = (payload: ProductRecordPayload) =>
          record.observe(payload);
        const approve = async (
          description: string,
          descriptor?: import("../shared/run-protocol.js").ApprovalView,
        ) => {
          const approvalId = `request-${++approvalSequence}`;
          await record.record({
            type: "approval",
            approvalId,
            description: description.slice(0, 16_384),
            ...(descriptor ? { actionId: descriptor.actionId } : {}),
          });
          if (signal.aborted) return false;
          const allow = await context.approve(description, descriptor);
          await record.record({ type: "decision", approvalId, allow });
          return !signal.aborted && allow;
        };
        let approvalSequence = 0;
        let result: RunResult | undefined;
        let finalizing = false;
        const { FORGE_DESKTOP_RESOURCE_ROOT: builtinResourceRoot } = this.#env;
        const shared = {
          env: this.#env,
          cwd: this.#cwd,
          signal,
          workspaceLease,
          ...(recoveryConfigurationSnapshot
            ? { configurationSnapshot: recoveryConfigurationSnapshot }
            : {}),
          stderr: {
            write: (text: string) => {
              observe({
                type: "detail",
                kind: "error",
                text: redact(text).slice(0, 65_536),
              });
              detail("error", text);
            },
          },
        };
        const onRunEvent = async (event: RunEvent) => {
          const action = projectActionEvent(
            redactValue(event, configuredSecrets(this.#env)) as RunEvent,
          );
          if (action) {
            await record.record({ type: "action", action });
            context.action(action);
          }
          if (event.type === "run.finalizing") {
            finalizing = true;
            await record.record({
              type: "detail",
              kind: "system",
              text: `Finalizing within the total budget: ${event.reason}`,
            });
            context.phase("finalizing");
          }
          if (event.type === "model.started" && !finalizing)
            context.phase("responding");
          if (event.type === "model.warning") {
            await record.record({
              type: "detail",
              kind: "system",
              text: redact(event.message).slice(0, 65_536),
            });
            detail("system", event.message);
          }
          if (event.type === "tool.started") context.phase("executing");
          if (event.type === "model.text") {
            await record.record({
              type: "text",
              text: redact(event.text),
            });
            context.text(redact(event.text));
          } else if (event.type === "model.reasoning") {
            await record.record({
              type: "detail",
              kind: "reasoning",
              text: redact(event.text),
              step: event.step,
            });
            context.detail("reasoning", redact(event.text), event.step);
          } else if (event.type.startsWith("context.")) {
            const text = redact(JSON.stringify(event)).slice(0, 65_536);
            await record.record({
              type: "detail",
              kind: "context",
              text,
            });
            detail("context", text);
          }
        };
        if (request.engine === "native") {
          session.selectModel(provider, model ?? loaded.config.model.id);
          let code: number;
          if (recovery?.view.kind === "summarize") {
            context.phase("finalizing");
            finalizing = true;
            result = await summarizeRecordedRun(recovery.prepared, {
              env: this.#env,
              cwd: this.#cwd,
              runId: request.runId,
              sessionId: request.sessionId,
              signal,
              ...(recoveryConfigurationSnapshot
                ? { configurationSnapshot: recoveryConfigurationSnapshot }
                : {}),
              selection: {
                provider,
                model: model ?? loaded.config.model.id,
                ...(effort ? { effort } : {}),
              },
              onEvent: onRunEvent,
              ...(this.#overrides.createAdapter
                ? { createAdapter: this.#overrides.createAdapter }
                : {}),
            });
            code = result.exitCode;
          } else {
            code = await runTask(
              request.prompt,
              {
                ...(model ? { model } : {}),
                ...(request.engine === "native" ? { provider } : {}),
                ...(effort
                  ? {
                      reasoningEffort: effort,
                      thinking: effort === "none" ? "disabled" : "enabled",
                    }
                  : {}),
                permissionProfile: request.permissionProfile ?? "safe",
              },
              {
                ...shared,
                completionPolicy: "reserve-final-step",
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
                    approve(
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
                    kind: (await approve(redact(descriptor.preview), {
                      actionId: descriptor.actionId,
                      effect: descriptor.effect,
                      resource: redact(descriptor.resource),
                      preview: redact(descriptor.preview),
                      input: redact(JSON.stringify(action.input, null, 2)),
                      riskFlags: descriptor.riskFlags,
                    }))
                      ? "allow-once"
                      : "deny",
                  }),
                },
                onEvent: onRunEvent,
                onResult: (value) => {
                  result = value;
                },
              },
            );
          }
          if (record.failed) throw new Error("product-run-storage-failed");
          if (!result)
            throw new Error(
              code === 130
                ? "cancelled"
                : code === 2
                  ? "configuration-invalid"
                  : "native-start-failed",
            );
        } else {
          let answer = "";
          const events: RunEvent[] = [];
          const code = await runCodexTask(
            request.prompt,
            {
              ...(model ? { model } : {}),
              ...(effort
                ? {
                    reasoningEffort: effort,
                    thinking: effort === "none" ? "disabled" : "enabled",
                  }
                : {}),
              permissionProfile: request.permissionProfile ?? "workspace-write",
            },
            {
              ...this.#codexDependencies(context.signal),
              ...shared,
              conversation: session.messages,
              onOutput: (event) => {
                if (event.type === "answer") {
                  answer += event.text;
                  observe({ type: "text", text: redact(event.text) });
                  context.text(redact(event.text));
                } else if (event.type === "reasoning") {
                  events.push({
                    type: "model.reasoning",
                    step: 1,
                    text: event.text,
                  });
                  observe({
                    type: "detail",
                    kind: "reasoning",
                    text: redact(event.text),
                    step: 1,
                  });
                  detail("reasoning", event.text);
                } else {
                  observe({
                    type: "detail",
                    kind: event.type === "tool" ? "tool" : "system",
                    text: redact(event.text).slice(0, 65_536),
                  });
                  detail(event.type === "tool" ? "tool" : "system", event.text);
                }
              },
              approve: (description) => approve(redact(description)),
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
        if (record.failed) throw new Error("product-run-storage-failed");
        const projected = projectRunCompletion(result);
        const {
          modelSteps: _modelSteps,
          toolCalls: _toolCalls,
          ...opaqueCompletion
        } = projected;
        finalCompletion = await record.result({
          ...(request.engine === "native" ? projected : opaqueCompletion),
          ...(recovery ? { recovery: recovery.prepared.link } : {}),
          ...(projected.message ? { message: redact(projected.message) } : {}),
          durationMs: Math.max(0, performance.now() - startedAt),
        });
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
        await record.finish(finalCompletion);
        await this.#loadRunHistory(undefined, request.runId);
        return finalCompletion;
      } catch (error) {
        const code = recorder?.failed
          ? "product-run-storage-failed"
          : desktopError(error);
        context.detail("error", code);
        const failure: ProductRunCompletion = {
          outcome: context.signal.aborted ? "cancelled" : "failed",
          reason: context.signal.aborted
            ? "cancelled"
            : code === "configuration-invalid"
              ? "configuration_error"
              : code === "session-storage-failed" ||
                  code === "product-run-storage-failed"
                ? "storage_error"
                : [
                      "session-conflict",
                      "session-busy",
                      "workspace-busy",
                      "workspace-changed",
                    ].includes(code)
                  ? "workspace_conflict"
                  : "execution_error",
          message: code,
          ...(recoveryLink ? { recovery: recoveryLink } : {}),
          durationMs: Math.max(0, performance.now() - startedAt),
        };
        if (recorder && !recorder.failed) {
          try {
            await recorder.result(failure);
            await recorder.finish(failure);
            await this.#loadRunHistory(undefined, request.runId);
          } catch {
            return {
              ...failure,
              outcome: "failed",
              reason: "storage_error",
              message: "product-run-storage-failed",
            };
          }
        }
        return failure;
      } finally {
        try {
          await workspaceLease?.release();
        } finally {
          try {
            await lease?.release();
          } finally {
            this.#busy = false;
          }
        }
      }
    },
    { deferStartReply: true },
  );
  /** Snapshot observation only: never resume, reconcile, acquire execution authority, or change active state. */
  async #browseSession(
    command: Extract<ManagementCommand, { type: "browse-session" }>,
  ): Promise<DesktopState> {
    const state = await this.state();
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
    let remaining = 262_144;
    let truncated = false;
    const projected = projectSessionMessages(saved.history, saved.runIds);
    if (projected.length > 1000) truncated = true;
    const messages = projected
      .slice(-1000)
      .reverse()
      .map((message) => {
        const redacted = String(
          redactValue(message.content, configuredSecrets(this.#env)),
        );
        const content = redacted.slice(0, remaining);
        remaining -= content.length;
        if (content.length < redacted.length) truncated = true;
        return { ...message, content };
      })
      .filter((message) => message.content.length > 0)
      .reverse();
    let runHistory: NonNullable<DesktopState["runHistory"]>;
    try {
      const store = new FileProductRunStore(this.#home, {
        secrets: configuredSecrets(this.#env),
      });
      const page = await store.list(command.sessionId, command.before);
      const selectedId = command.runId ?? page.runs[0]?.runId;
      const record = selectedId
        ? await store.read(command.sessionId, selectedId)
        : undefined;
      runHistory = {
        ...page,
        ...(record
          ? {
              selected: {
                summary: record.summary,
                activity: projectRecordedActivity(record),
                delivery: projectRunDelivery(record),
                incomplete:
                  record.incomplete ||
                  Boolean(record.summary.journalIncomplete),
              },
            }
          : {}),
      };
    } catch {
      runHistory = { runs: [], error: "product-run-storage-failed" };
    }
    return {
      ...state,
      browsedSession: {
        sessionId: saved.id,
        cwd,
        title:
          state.sessions.find((entry) => entry.id === saved.id)?.title ??
          saved.id,
        messages,
        runHistory,
        truncated,
      },
    };
  }
  async #loadRunHistory(before?: number, runId?: string): Promise<void> {
    const sessionId = this.#session?.sessionId;
    if (!sessionId) {
      this.#runHistory = undefined;
      return;
    }
    try {
      const store = new FileProductRunStore(this.#home, {
        secrets: configuredSecrets(this.#env),
      });
      const page = await store.list(sessionId, before);
      this.#historyPageBefore = before;
      const record = runId ? await store.read(sessionId, runId) : undefined;
      this.#runHistory = {
        ...page,
        ...(record
          ? {
              selected: {
                summary: record.summary,
                activity: projectRecordedActivity(record),
                delivery: projectRunDelivery(record),
                incomplete:
                  record.incomplete ||
                  Boolean(record.summary.journalIncomplete),
              },
            }
          : {}),
      };
    } catch {
      this.#runHistory = { runs: [], error: "product-run-storage-failed" };
    }
  }
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

async function desktopSessionLease(
  home: string,
  sessionId: string,
): Promise<ExecutionLease> {
  try {
    const legacy = await lstat(
      join(home, "sessions", `${sessionId}.desktop-lock`),
    ).catch((error: unknown) => {
      if (error instanceof Error && "code" in error && error.code === "ENOENT")
        return undefined;
      throw error;
    });
    if (legacy) throw new Error("session-busy");
    return await ExecutionLease.acquire(
      `desktop-session:${await realpath(home)}:${sessionId}`,
    );
  } catch {
    throw new Error("session-busy");
  }
}

function recoveryConfiguration(configuration: unknown): string {
  return createHash("sha256")
    .update(JSON.stringify(configuration))
    .digest("hex");
}

function recoveryOptions(view: RecoveryPlan) {
  return {
    engine: "forge",
    provider: view.selection.provider,
    model: view.selection.model,
    ...(view.selection.effort
      ? {
          reasoningEffort: view.selection.effort,
          thinking: view.selection.effort === "none" ? "disabled" : "enabled",
        }
      : {}),
    permissionProfile: view.permissionProfile,
    maxSteps: view.maxModelSteps,
    maxToolCalls: view.kind === "summarize" ? 1 : view.maxToolCalls,
  };
}
