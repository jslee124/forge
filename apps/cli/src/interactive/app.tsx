import { randomUUID } from "node:crypto";
import {
  changeProjectPluginTrust,
  type DetectedStartupResources,
  detectStartupResources,
  EMPTY_STARTUP_RESOURCES,
} from "@forge/application";
import { isSupportedImagePath } from "@forge/application/image-input";
import {
  type ContextStatus,
  createPersistentInteractiveSession,
  type InteractiveSessionPersistence,
} from "@forge/application/persistent-session";
import { filterSlashCommands } from "@forge/application/slash-commands";
import {
  type ApiKeyProvider,
  AuthenticationManager,
  apiKeyEnvironmentVariable,
} from "@forge/auth";
import { CodexAppServerClient, type CodexModel } from "@forge/codex-app-server";
import {
  loadForgeConfig,
  type PersistedModelSelection,
  type ProviderProfile,
  removeUserProviderModel,
  removeUserProviderRoute,
  saveUserModelSelection,
  saveUserProviderRoute,
} from "@forge/config";
import type {
  ModelConversationMessage,
  RunEvent,
  RunResult,
} from "@forge/core";
import { runConversationMessages, SessionApprovalStore } from "@forge/core";
import {
  type DiscoverModelsRequest,
  discoverModels,
} from "@forge/model-compat";
import type { SessionSummary } from "@forge/persistence";
import {
  Box,
  Static,
  Text,
  useApp,
  useInput,
  usePaste,
  useWindowSize,
} from "ink";
import type React from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { AskOptions, WritableOutput } from "../ask.js";
import {
  type CodexClient,
  type CodexCommandDependencies,
  type CodexOutputEvent,
  discoverCodexModels,
  runCodexAuthCommand,
  runCodexTask,
} from "../codex-command.js";
import {
  activeMentionQuery,
  assemblePrompt,
  createEditorState,
  discoverWorkspaceFiles,
  type EditorState,
  filterFuzzy,
  filterWorkspaceFiles,
  insertPastedEditorText,
  referencedPaths,
  slashCommandQuery,
} from "../interactive-model.js";
import type { ProviderSetupResult } from "../provider-setup.js";
import {
  type CommandApprovalPreview,
  createApprovalChannel,
  type NetworkApprovalPreview,
  type RunDependencies,
  type RunMetadata,
  runTask,
  type SubagentApprovalPreview,
} from "../run.js";
import {
  createUpdateService,
  type UpdateService,
  type UpdateState,
} from "../update.js";
import { toolRunActivity } from "./activity.js";
import {
  appendTranscriptEntry,
  conversationTranscript,
  ForgeHeader,
  formatModelStatus,
  PromptFooter,
  RUN_ACTIVITY_FRAMES,
  type StaticOutputItem,
} from "./display.js";
import { handleInteractiveInput } from "./input-handler.js";
import { runInteractiveLifecycle } from "./lifecycle.js";
import { type PendingApproval, PhaseOverlays } from "./overlays.js";
import {
  type EffortChoice,
  effortsForModel,
  type LoginChoice,
  type LogoutChoice,
  MODEL_CHOICES,
  type ModelChoice,
  modelChoiceSearchFields,
  providerActions,
  providerLoginChoices,
  providerLogoutChoices,
  providerModelChoices,
  providerRouteState,
  type ReasoningEffort,
  STANDARD_EFFORTS,
} from "./provider-choices.js";
import type {
  InteractiveSessionHost,
  TuiSessionStatus,
} from "./session-host.js";
import { executeSlashCommand } from "./slash-commands.js";
import { TranscriptBlock } from "./transcript.js";
import type {
  PendingSignIn,
  InteractivePhase as Phase,
  RunActivity,
  TranscriptEntry,
  TranscriptKind,
} from "./types.js";

export { UpdateBanner } from "./display.js";

export interface InteractiveUiDependencies {
  readonly env: NodeJS.ProcessEnv;
  readonly cwd: string;
  readonly executeTask?: (
    prompt: string,
    options: AskOptions,
    dependencies: RunDependencies,
  ) => Promise<number>;
  readonly executeCodexTask?: (
    prompt: string,
    options: AskOptions,
    dependencies: CodexCommandDependencies,
  ) => Promise<number>;
  readonly discoverSubscriptionModels?: (
    dependencies: CodexCommandDependencies,
  ) => Promise<readonly CodexModel[]>;
  readonly executeAuthentication?: (
    dependencies: CodexCommandDependencies,
  ) => Promise<number>;
  readonly executeLogout?: (
    dependencies: CodexCommandDependencies,
  ) => Promise<number>;
  readonly saveApiKey?: (options: {
    readonly provider: ApiKeyProvider;
    readonly apiKey: string;
    readonly env: NodeJS.ProcessEnv;
    readonly endpoint?: string;
  }) => Promise<string>;
  readonly sessionPersistence?: InteractiveSessionPersistence;
  readonly approvalStore?: SessionApprovalStore;
  readonly approvalWorkspaceRoot?: string;
  readonly permissionProfileSource?: string;
  readonly updateService?: UpdateService;
  readonly persistModelSelection?: (options: {
    readonly cwd: string;
    readonly env: NodeJS.ProcessEnv;
    readonly selection: PersistedModelSelection;
  }) => Promise<string>;
  readonly persistProviderRoute?: (options: {
    readonly cwd: string;
    readonly env: NodeJS.ProcessEnv;
    readonly route: string;
    readonly profile: ProviderProfile;
  }) => Promise<string>;
  readonly removeProviderRoute?: (options: {
    readonly cwd: string;
    readonly env: NodeJS.ProcessEnv;
    readonly route: string;
  }) => Promise<{ readonly path: string; readonly removed: boolean }>;
  readonly removeProviderModel?: (options: {
    readonly cwd: string;
    readonly env: NodeJS.ProcessEnv;
    readonly route: string;
    readonly model: string;
  }) => Promise<{ readonly path: string; readonly removed: boolean }>;
  readonly removeApiKey?: (options: {
    readonly provider: ApiKeyProvider;
    readonly env: NodeJS.ProcessEnv;
  }) => Promise<boolean>;
  readonly discoverProviderModels?: (
    request: DiscoverModelsRequest,
  ) => Promise<readonly import("@forge/model-compat").DiscoveredModel[]>;
  readonly detectedResources?: DetectedStartupResources;
  readonly updateProjectPluginTrust?: (
    trusted: boolean,
  ) => Promise<DetectedStartupResources>;
}

export interface InteractiveAppProps extends InteractiveUiDependencies {
  readonly options: AskOptions;
  readonly initialProviders?: Readonly<Record<string, ProviderProfile>>;
  readonly sessionHost?: InteractiveSessionHost;
}

export const INK_INCREMENTAL_RENDERING = false as const;

export function resolveInkKeyboardMode(
  env: NodeJS.ProcessEnv,
): "enabled" | "disabled" {
  const terminalProgram = (
    env as { TERM_PROGRAM?: string }
  ).TERM_PROGRAM?.toLocaleLowerCase();
  if (
    terminalProgram === "vscode" ||
    terminalProgram === "ghostty" ||
    terminalProgram === "wezterm" ||
    (env as { TERM?: string }).TERM === "xterm-kitty"
  ) {
    return "enabled";
  }
  return "disabled";
}

export async function runInkInteractiveFromCli(
  options: AskOptions,
  dependencies: InteractiveUiDependencies,
): Promise<number> {
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    process.stderr.write(
      'Interactive mode requires a TTY. Use `forge run "<task>"` for non-interactive operation.\n',
    );
    return 2;
  }

  let sessionPersistence = dependencies.sessionPersistence;
  let effectiveOptions = options;
  let detectedResources =
    dependencies.detectedResources ?? EMPTY_STARTUP_RESOURCES;
  let initialProviders: Readonly<Record<string, ProviderProfile>> = {};
  let approvalWorkspaceRoot = dependencies.cwd;
  let permissionProfileSource = "default";
  try {
    const loaded = await loadForgeConfig({
      cwd: dependencies.cwd,
      env: dependencies.env,
      cli: options,
    });
    effectiveOptions = {
      engine: loaded.config.model.engine,
      provider: loaded.config.model.provider,
      model: loaded.config.model.id,
      reasoningEffort: loaded.config.model.reasoningEffort,
      thinking: loaded.config.model.thinking,
      permissionProfile: loaded.config.permissionProfile,
      contextMode: loaded.config.context.mode,
      reservedOutputTokens: loaded.config.context.reservedOutputTokens,
      bufferTokens: loaded.config.context.bufferTokens,
      recentTailTokens: loaded.config.context.recentTailTokens,
      summaryTargetTokens: loaded.config.context.summaryTargetTokens,
    };
    initialProviders = loaded.config.providers;
    approvalWorkspaceRoot = loaded.workspaceRoot;
    permissionProfileSource = loaded.provenance.permissionProfile.label;
    if (!dependencies.detectedResources) {
      detectedResources = await detectStartupResources({
        forgeHome: loaded.forgeHome,
        workspaceRoot: loaded.workspaceRoot,
        enabledUserPlugins: loaded.config.plugins.enabled,
        disabledModelInvocation:
          loaded.config.resources.disabledModelInvocation,
      });
    }
    sessionPersistence ??= await createPersistentInteractiveSession({
      cwd: dependencies.cwd,
      env: dependencies.env,
    });
  } catch (error) {
    process.stderr.write(
      `Could not initialize the interactive session: ${error instanceof Error ? error.message : "unknown error"}\n`,
    );
    return 2;
  }

  let codexClientPromise: Promise<CodexClient> | undefined;
  const sharedCodexClient = (): Promise<CodexClient> => {
    codexClientPromise ??= CodexAppServerClient.connect({
      cwd: dependencies.cwd,
      env: dependencies.env,
    }).catch((error: unknown) => {
      codexClientPromise = undefined;
      throw error;
    });
    return codexClientPromise;
  };
  const withSharedCodexClient = async <T,>(
    operation: (client: CodexClient) => Promise<T>,
  ): Promise<T> => operation(await sharedCodexClient());

  const interactiveDependencies: InteractiveUiDependencies = {
    ...dependencies,
    approvalWorkspaceRoot,
    permissionProfileSource,
    approvalStore:
      dependencies.approvalStore ??
      new SessionApprovalStore({
        workspaceRoot: approvalWorkspaceRoot,
        sessionId: sessionPersistence?.sessionId ?? randomUUID(),
      }),
    updateService:
      dependencies.updateService ??
      createUpdateService({ env: dependencies.env, isTTY: true }),
    // Each running session owns a client; Codex notification/approval listeners are client-scoped.
    executeCodexTask: dependencies.executeCodexTask ?? runCodexTask,
    discoverSubscriptionModels:
      dependencies.discoverSubscriptionModels ??
      ((modelDependencies) =>
        withSharedCodexClient((client) =>
          discoverCodexModels({ ...modelDependencies, client }),
        )),
    executeAuthentication:
      dependencies.executeAuthentication ??
      ((authenticationDependencies) =>
        withSharedCodexClient((client) =>
          runCodexAuthCommand(
            "login",
            "openai",
            {},
            {
              ...authenticationDependencies,
              client,
            },
          ),
        )),
  };

  try {
    const { InteractiveWorkbench } = await import("./workbench.js");
    return await runInteractiveLifecycle(
      <InteractiveWorkbench
        {...interactiveDependencies}
        startupOptions={options}
        sessionPersistence={sessionPersistence}
        detectedResources={detectedResources}
        options={effectiveOptions}
        initialProviders={initialProviders}
      />,
      {
        stdin: process.stdin,
        stdout: process.stdout,
        stderr: process.stderr,
        // Incremental line diffs can retain stale physical rows after the
        // terminal rewraps content during a resize. Full-frame updates are more
        // reliable for this bounded interactive UI.
        incrementalRendering: INK_INCREMENTAL_RENDERING,
        // Ink's auto-detection query is sent before raw mode is active. VS Code
        // can echo that query as literal input, so use direct activation only
        // for terminals known to support the protocol. Ctrl+J, Meta+Enter, and
        // the legacy parser remain available for all other terminals.
        keyboardMode: resolveInkKeyboardMode(dependencies.env),
      },
    );
  } finally {
    const client = codexClientPromise;
    codexClientPromise = undefined;
    if (client) {
      try {
        (await client).close();
      } catch {
        // Connection failures are already rendered by the command surface.
      }
    }
  }
}

export function InteractiveApp({
  options,
  env,
  cwd,
  sessionHost,
  executeTask = runTask,
  executeCodexTask = runCodexTask,
  discoverSubscriptionModels = discoverCodexModels,
  executeAuthentication = (dependencies) =>
    runCodexAuthCommand("login", "openai", {}, dependencies),
  executeLogout = (dependencies) =>
    runCodexAuthCommand("logout", "openai", {}, dependencies),
  saveApiKey = ({ provider, apiKey, env: loginEnv, endpoint }) =>
    new AuthenticationManager(loginEnv).storeApiKey(provider, apiKey, {
      ...(endpoint ? { endpoint } : {}),
    }),
  sessionPersistence,
  approvalStore: injectedApprovalStore,
  approvalWorkspaceRoot = cwd,
  permissionProfileSource = "validated configuration",
  updateService,
  persistModelSelection = saveUserModelSelection,
  persistProviderRoute = saveUserProviderRoute,
  removeProviderRoute = removeUserProviderRoute,
  removeProviderModel = removeUserProviderModel,
  removeApiKey = ({ provider, env: loginEnv }) =>
    new AuthenticationManager(loginEnv).removeStoredApiKey(provider),
  discoverProviderModels = discoverModels,
  initialProviders = {},
  detectedResources = EMPTY_STARTUP_RESOURCES,
  updateProjectPluginTrust = (trusted) =>
    changeProjectPluginTrust({ cwd, env, trusted }),
}: InteractiveAppProps): React.JSX.Element {
  const { exit: inkExit } = useApp();
  const exit = (code: number) =>
    sessionHost ? sessionHost.requestExit() : inkExit(code);
  const hosted = Boolean(sessionHost);
  const [inputReady, setInputReady] = useState(!sessionHost);
  const [queued, setQueued] = useState(false);
  const [lastRunStatus, setLastRunStatus] = useState<TuiSessionStatus>("ready");
  const [transcriptOffset, setTranscriptOffset] = useState(0);
  const [editor, setEditor] = useState<EditorState>(() => createEditorState());
  const [phase, setPhase] = useState<Phase>("editing");
  const [runActivity, setRunActivity] = useState<RunActivity>();
  const [runActivityFrame, setRunActivityFrame] = useState(0);
  const [activeOptions, setActiveOptions] = useState<AskOptions>(options);
  const initialMessages =
    sessionPersistence?.history ?? sessionPersistence?.messages ?? [];
  const [transcript, setTranscript] = useState<readonly TranscriptEntry[]>(() =>
    conversationTranscript(
      initialMessages,
      sessionPersistence?.reasoning ?? [],
      sessionPersistence?.historyEvents,
    ),
  );
  const [staticRenderRevision, setStaticRenderRevision] = useState(0);
  const [contextPanel, setContextPanel] = useState<ContextStatus>();
  const [contextModeSelector, setContextModeSelector] = useState(false);
  const [contextModeSelection, setContextModeSelection] = useState(0);
  const [contextRevision, setContextRevision] = useState(0);
  const [contextOfferDismissed, setContextOfferDismissed] = useState(false);
  const [contextActivity, setContextActivity] =
    useState<ContextStatus["pressure"]["state"]>();
  const [files, setFiles] = useState<readonly string[]>([]);
  const [filesLoading, setFilesLoading] = useState(true);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [dismissedCompletion, setDismissedCompletion] = useState<string>();
  const [approval, setApproval] = useState<PendingApproval>();
  const [approvalFeedback, setApprovalFeedback] = useState("");
  const approvalStore = useMemo(
    () =>
      injectedApprovalStore ??
      new SessionApprovalStore({
        workspaceRoot: approvalWorkspaceRoot,
        sessionId: sessionPersistence?.sessionId ?? randomUUID(),
      }),
    [approvalWorkspaceRoot, injectedApprovalStore, sessionPersistence],
  );
  const [permissionRevision, setPermissionRevision] = useState(0);
  const [updateState, setUpdateState] = useState<UpdateState | undefined>(() =>
    updateService?.snapshot(),
  );
  const { columns: terminalWidth, rows: terminalHeight } = useWindowSize();
  const [resources, setResources] =
    useState<DetectedStartupResources>(detectedResources);
  const [pluginTrustIntent, setPluginTrustIntent] = useState<
    "trust" | "untrust"
  >();
  const [sessionDeletionConfirmed, setSessionDeletionConfirmed] =
    useState(false);
  const [sessions, setSessions] = useState<readonly SessionSummary[]>([]);
  const [modelChoices, setModelChoices] = useState<readonly ModelChoice[]>(
    () => [...providerModelChoices(initialProviders), ...MODEL_CHOICES],
  );
  const [providerProfiles, setProviderProfiles] =
    useState<Readonly<Record<string, ProviderProfile>>>(initialProviders);
  const baseModelChoices = useMemo(
    () => [...providerModelChoices(providerProfiles), ...MODEL_CHOICES],
    [providerProfiles],
  );
  const [modelsLoading, setModelsLoading] = useState(false);
  const [modelQuery, setModelQuery] = useState("");
  const [effortChoices, setEffortChoices] =
    useState<readonly EffortChoice[]>(STANDARD_EFFORTS);
  const [loginKey, setLoginKey] = useState("");
  const [loginChoice, setLoginChoice] = useState<LoginChoice>();
  const [loginPrompt, setLoginPrompt] = useState<PendingSignIn>();
  const [providerSetupRoute, setProviderSetupRoute] = useState<string>();
  const [selectedProviderRoute, setSelectedProviderRoute] = useState<string>();
  const [loggedOutProviderRoutes, setLoggedOutProviderRoutes] = useState<
    ReadonlySet<string>
  >(new Set());
  const [pendingModelDeletion, setPendingModelDeletion] =
    useState<ModelChoice>();
  const [deleteModelReturnPhase, setDeleteModelReturnPhase] = useState<
    "editing" | "provider-actions"
  >("editing");
  const conversation = useRef<ModelConversationMessage[]>([
    ...(sessionPersistence?.history ?? initialMessages),
  ]);
  const activeController = useRef<AbortController | undefined>(undefined);
  const idleExitArmed = useRef(false);
  const nextTranscriptId = useRef(initialMessages.length);
  const contextStatus = useMemo(() => {
    void contextRevision;
    return sessionPersistence?.contextDetails?.(
      editor.value,
      editor.images.length,
    );
  }, [sessionPersistence, editor.value, editor.images.length, contextRevision]);
  const contextOfferVisible =
    phase === "editing" &&
    !contextPanel &&
    !contextOfferDismissed &&
    contextStatus?.pressure.mode === "manual" &&
    contextStatus.pressure.confidence !== "unavailable" &&
    contextStatus.pressure.ratio >= contextStatus.activationThreshold;

  const completionSignature = `${editor.value}\u0000${editor.cursor}`;
  const mentionQuery = activeMentionQuery(editor.value, editor.cursor);
  const commandQuery = mentionQuery
    ? undefined
    : slashCommandQuery(editor.value, editor.cursor);
  const commandCandidates = commandQuery
    ? filterSlashCommands(commandQuery)
    : [];
  const fileCandidates = mentionQuery
    ? filterWorkspaceFiles(files, mentionQuery.query, 11)
    : [];
  const visibleModelChoices = useMemo(
    () =>
      filterFuzzy(
        modelChoices,
        modelQuery,
        modelChoiceSearchFields,
        modelQuery.trim() === "" ? modelChoices.length : 12,
      ),
    [modelChoices, modelQuery],
  );
  const logoutChoices = providerLogoutChoices(providerProfiles, env);
  const loginChoices = useMemo(
    () =>
      providerLoginChoices(providerProfiles, (route, profile) =>
        providerRouteState(route, profile, env, loggedOutProviderRoutes),
      ),
    [env, loggedOutProviderRoutes, providerProfiles],
  );
  const selectedProviderProfile = selectedProviderRoute
    ? providerProfiles[selectedProviderRoute]
    : undefined;
  const selectedProviderState =
    selectedProviderRoute && selectedProviderProfile
      ? providerRouteState(
          selectedProviderRoute,
          selectedProviderProfile,
          env,
          loggedOutProviderRoutes,
        )
      : undefined;
  const providerActionChoices =
    selectedProviderProfile && selectedProviderState
      ? providerActions(selectedProviderProfile, selectedProviderState)
      : [];
  const selectedModelIndex =
    visibleModelChoices.length === 0
      ? 0
      : Math.min(selectedIndex, visibleModelChoices.length - 1);
  const completionDismissed = dismissedCompletion === completionSignature;
  const completionKind = completionDismissed
    ? undefined
    : mentionQuery
      ? "file"
      : commandQuery
        ? "command"
        : undefined;
  const visibleCandidates =
    completionKind === "file"
      ? fileCandidates.slice(0, 10)
      : completionKind === "command"
        ? commandCandidates
        : [];

  const appendEntry = useCallback(
    (kind: TranscriptKind, text: string, merge = false): void => {
      setTranscript((current) => {
        const next = appendTranscriptEntry(
          current,
          { id: nextTranscriptId.current++, kind, text },
          merge,
        );
        if (!hosted) return next;
        let remaining = 1_000_000;
        const bounded: TranscriptEntry[] = [];
        for (const entry of next.slice(-1000).toReversed()) {
          if (remaining <= 0) break;
          const retained = entry.text.slice(-remaining);
          bounded.push({ ...entry, text: retained });
          remaining -= retained.length;
        }
        return bounded.reverse();
      });
    },
    [hosted],
  );
  const appendOutput = useCallback(
    (chunk: string): void => appendEntry("raw", chunk, true),
    [appendEntry],
  );
  const stdout = useMemo<WritableOutput>(
    () => ({ write: (chunk) => appendOutput(chunk) }),
    [appendOutput],
  );
  const stderr = stdout;

  const completeProviderSetup = useCallback(
    async (result: ProviderSetupResult): Promise<void> => {
      let routePersisted = false;
      let keyStored = false;
      const previousProfile = providerProfiles[result.route];
      try {
        const configPath = await persistProviderRoute({
          cwd,
          env,
          route: result.route,
          profile: result.profile,
        });
        routePersisted = true;
        if (result.apiKey !== undefined) {
          await saveApiKey({
            provider: result.route,
            apiKey: result.apiKey,
            env,
            endpoint: result.profile.baseUrl,
          });
          keyStored = true;
        }
        const choice = providerModelChoices({
          [result.route]: result.profile,
        }).find(({ selection }) => selection.id === result.model);
        const reasoningEffort = choice?.defaultReasoningEffort ?? "none";
        await persistModelSelection({
          cwd,
          env,
          selection: {
            engine: "forge",
            provider: result.route,
            id: result.model,
            reasoningEffort,
          },
        });
        const nextProviders = {
          ...providerProfiles,
          [result.route]: result.profile,
        };
        setProviderProfiles(nextProviders);
        setLoggedOutProviderRoutes((current) => {
          if (!current.has(result.route)) return current;
          const next = new Set(current);
          next.delete(result.route);
          return next;
        });
        setModelChoices([
          ...providerModelChoices(nextProviders),
          ...MODEL_CHOICES,
        ]);
        setActiveOptions((current) => ({
          ...current,
          engine: "forge",
          provider: result.route,
          model: result.model,
          reasoningEffort,
          thinking: reasoningEffort === "none" ? "disabled" : "enabled",
        }));
        sessionPersistence?.selectModel?.(
          result.route,
          result.model,
          result.profile.models?.find((model) => model.id === result.model)
            ?.contextWindow,
        );
        appendEntry(
          "system",
          `Saved provider route "${result.route}" to ${configPath} and selected ${result.model}.`,
        );
      } catch (error) {
        if (keyStored) {
          await removeApiKey({ provider: result.route, env }).catch(
            () => false,
          );
        }
        if (routePersisted) {
          if (previousProfile) {
            await persistProviderRoute({
              cwd,
              env,
              route: result.route,
              profile: previousProfile,
            }).catch(() => "");
          } else {
            await removeProviderRoute({ cwd, env, route: result.route }).catch(
              () => ({ path: "", removed: false }),
            );
          }
        }
        appendEntry(
          "error",
          `Could not save provider route: ${error instanceof Error ? error.message : "unknown error"}`,
        );
      } finally {
        setPhase("editing");
      }
    },
    [
      appendEntry,
      cwd,
      env,
      persistModelSelection,
      persistProviderRoute,
      providerProfiles,
      removeApiKey,
      removeProviderRoute,
      saveApiKey,
      sessionPersistence,
    ],
  );

  const logoutApiProvider = useCallback(
    (selected: LogoutChoice): void => {
      setPhase("running");
      void removeApiKey({ provider: selected.provider, env }).then(
        (removed) => {
          const variable = apiKeyEnvironmentVariable(
            selected.provider,
            selected.environmentVariable,
          );
          appendEntry(
            removed ? "system" : "warning",
            removed
              ? `Removed the stored credential for ${selected.label}.`
              : `No stored credential was found for ${selected.label}.`,
          );
          if (env[variable]?.trim()) {
            appendEntry(
              "warning",
              `${variable} is still set and continues to authenticate this provider. Unset it in your shell to fully log out.`,
            );
          } else if (providerProfiles[selected.provider]) {
            setLoggedOutProviderRoutes((current) =>
              new Set(current).add(selected.provider),
            );
          }
          setPhase("editing");
        },
        (error: unknown) => {
          appendEntry(
            "error",
            `Could not remove credential: ${error instanceof Error ? error.message : "unknown error"}`,
          );
          setPhase("editing");
        },
      );
    },
    [appendEntry, env, providerProfiles, removeApiKey],
  );

  const handleCodexOutput = useCallback(
    (event: CodexOutputEvent): void => {
      if (event.type === "login") {
        // Rendered as a dedicated panel rather than transcript text, so the
        // URL keeps one unbroken clickable run.
        setLoginPrompt({
          url: event.url,
          ...(event.userCode === undefined ? {} : { userCode: event.userCode }),
        });
        return;
      }
      appendEntry(
        event.type,
        event.text,
        event.type === "reasoning" || event.type === "answer",
      );
    },
    [appendEntry],
  );

  const handleRunEvent = useCallback(
    (event: RunEvent): void => {
      switch (event.type) {
        case "model.started":
          setRunActivity({ kind: "thinking", step: event.step });
          break;
        case "model.reasoning":
          setRunActivity((current) =>
            current?.kind === "tool"
              ? current
              : { kind: "thinking", step: event.step },
          );
          appendEntry("reasoning", event.text, true);
          break;
        case "model.reasoning-unavailable":
          setRunActivity({ kind: "thinking", step: event.step });
          appendEntry(
            "reasoning",
            `Provider used ${event.reasoningTokens} reasoning tokens but did not return reasoning text.`,
          );
          break;
        case "model.text":
          setRunActivity((current) =>
            current?.kind === "tool"
              ? current
              : { kind: "thinking", step: event.step },
          );
          appendEntry("answer", event.text, true);
          break;
        case "model.warning":
        case "context.warning":
          appendEntry("warning", event.message);
          break;
        case "context.pressure":
          setContextActivity(event.snapshot.state);
          break;
        case "context.auto-paused":
          setContextActivity("paused");
          appendEntry("warning", event.message);
          break;
        case "approval.scope-decision":
          setPermissionRevision((current) => current + 1);
          break;
        case "tool.proposed":
          setRunActivity(toolRunActivity(event.call, "preparing"));
          appendEntry("tool", `○ Proposed ${event.call.name}`);
          break;
        case "tool.decision":
          appendEntry(
            "tool",
            `◇ ${event.decision.kind.toUpperCase()} ${event.call.name} — ${event.decision.reason}`,
          );
          break;
        case "tool.completed":
          setRunActivity({ kind: "thinking", step: event.step });
          appendEntry("tool", `✓ Completed ${event.call.name}`);
          break;
        case "tool.started":
          setRunActivity(toolRunActivity(event.call, "executing"));
          break;
        case "docs.search":
          appendEntry(
            "tool",
            `Docs · ${event.resultCount} result(s) · ${event.locale}${event.fallback ? " · English fallback" : ""}`,
          );
          break;
        case "docs.read":
          appendEntry("tool", `Docs · ${event.reference}`);
          break;
        case "docs.rejected":
          appendEntry("warning", `Docs · ${event.message}`);
          break;
        case "tool.failed":
          setRunActivity({ kind: "thinking", step: event.step });
          appendEntry(
            "error",
            `✗ Failed ${event.call.name}${event.result.ok ? "" : ` — ${event.result.error.message}`}`,
          );
          break;
        case "run.failed":
        case "run.denied":
        case "run.limit_reached":
        case "run.cancelled":
          if (event.message) appendEntry("error", event.message);
          break;
        default:
          break;
      }
    },
    [appendEntry],
  );

  const reportSession = sessionHost?.report;
  useEffect(() => {
    reportSession?.(
      queued
        ? "queued"
        : phase === "approving" || phase === "approval-feedback"
          ? "approval"
          : phase === "running"
            ? "running"
            : lastRunStatus,
    );
  }, [reportSession, queued, phase, lastRunStatus]);

  useEffect(() => {
    const controller = new AbortController();
    setFilesLoading(true);
    void discoverWorkspaceFiles(cwd, { signal: controller.signal }).then(
      (nextFiles) => {
        if (!controller.signal.aborted) {
          setFiles(nextFiles);
          setFilesLoading(false);
        }
      },
      () => {
        if (!controller.signal.aborted) setFilesLoading(false);
      },
    );
    return () => controller.abort();
  }, [cwd]);

  useEffect(
    () => () => {
      activeController.current?.abort("session closed");
    },
    [],
  );

  useEffect(() => {
    if (!updateService) return;
    const unsubscribe = updateService.subscribe(setUpdateState);
    void updateService.start();
    return unsubscribe;
  }, [updateService]);

  useEffect(() => {
    if (phase !== "running") return;
    const timer = setInterval(() => {
      setRunActivityFrame(
        (current) => (current + 1) % RUN_ACTIVITY_FRAMES.length,
      );
    }, 120);
    return () => clearInterval(timer);
  }, [phase]);

  const updateEditor = (
    update: (current: EditorState) => EditorState,
  ): void => {
    setEditor((current) => update(current));
    setSelectedIndex(0);
    setDismissedCompletion(undefined);
  };

  const finishApproval = (answer: string | null): void => {
    const pending = approval;
    if (!pending) return;
    setApproval(undefined);
    setApprovalFeedback("");
    setPhase("running");
    pending.resolve(answer);
  };

  const selectEffort = (effort: ReasoningEffort): void => {
    const engine = activeOptions.engine === "codex" ? "codex" : "forge";
    const provider = activeOptions.provider?.trim() || "deepseek";
    const model =
      activeOptions.model?.trim() ||
      providerProfiles[provider]?.models?.[0]?.id ||
      "deepseek-flash";
    const thinking =
      provider === "deepseek"
        ? effort === "none"
          ? "disabled"
          : "enabled"
        : undefined;
    const nextOptions: AskOptions = {
      ...activeOptions,
      engine,
      provider,
      model,
      reasoningEffort: effort,
      ...(thinking ? { thinking } : {}),
    };
    const selection: PersistedModelSelection = {
      engine,
      provider,
      id: model,
      reasoningEffort: effort,
      ...(thinking ? { thinking } : {}),
    };
    setActiveOptions(nextOptions);
    setPhase("editing");
    void persistModelSelection({ cwd, env, selection }).then(
      (configPath) =>
        appendEntry(
          "system",
          `Thinking effort: ${effort}. Saved to ${configPath}.`,
        ),
      (error: unknown) =>
        appendEntry(
          "error",
          `Could not persist thinking effort: ${error instanceof Error ? error.message : "unknown error"}`,
        ),
    );
  };

  const cycleEffort = (choices: readonly ModelChoice[]): void => {
    const efforts = effortsForModel(choices, activeOptions);
    const current = efforts.findIndex(
      ({ effort }) => effort === activeOptions.reasoningEffort,
    );
    const next = efforts[(current + 1 + efforts.length) % efforts.length];
    if (next) selectEffort(next.effort);
  };

  const executeCommand = (command: string): void => {
    executeSlashCommand(command, {
      activeOptions,
      env,
      cwd,
      stdout,
      stderr,
      modelChoices,
      baseModelChoices,
      providerProfiles,
      ...(sessionPersistence ? { sessionPersistence } : {}),
      ...(sessionHost ? { sessionHost } : {}),
      approvalStore,
      ...(updateState ? { updateState } : {}),
      ...(updateService ? { updateService } : {}),
      conversationRef: conversation,
      nextTranscriptIdRef: nextTranscriptId,
      discoverSubscriptionModels,
      exit,
      appendEntry,
      selectEffort,
      setEditor,
      setContextPanel,
      setContextOfferDismissed,
      setContextActivity,
      setStaticRenderRevision,
      setTranscript,
      setPermissionRevision,
      setSelectedIndex,
      setPhase,
      setPluginTrustIntent,
      setSessions,
      setLoginKey,
      setLoginChoice,
      setProviderSetupRoute,
      setSelectedProviderRoute,
      setModelQuery,
      setModelChoices,
      setModelsLoading,
      setPendingModelDeletion,
      setDeleteModelReturnPhase,
      setEffortChoices,
    });
  };

  const submitPrompt = (): void => {
    const visiblePrompt = editor.value.trim();
    if (visiblePrompt === "" && editor.images.length === 0) return;
    if (visiblePrompt.startsWith("/") && editor.images.length === 0) {
      executeCommand(visiblePrompt);
      return;
    }

    const submittedEditor = editor;
    const prompt = assemblePrompt(editor);
    const imageSources = [
      ...editor.images.map(({ source }) => source),
      ...referencedPaths(editor).filter(isSupportedImagePath),
    ];
    const controller = new AbortController();
    const runId = randomUUID();
    sessionHost?.submitted(prompt);
    setTranscriptOffset(0);
    activeController.current = controller;
    setContextPanel(undefined);
    setEditor(createEditorState());
    setRunActivity({ kind: "thinking" });
    setPhase("running");
    appendEntry(
      "user",
      [
        editor.value,
        ...editor.images.map(
          ({ filename }, index) => `[Image #${index + 1}] ${filename}`,
        ),
      ]
        .filter(Boolean)
        .join("\n"),
    );
    let result: RunResult | undefined;
    let metadata: RunMetadata | undefined;
    let codexExitCode: number | undefined;
    let commandPreview: CommandApprovalPreview | undefined;
    let networkPreview: NetworkApprovalPreview | undefined;
    let subagentPreview: SubagentApprovalPreview | undefined;

    const requestApproval = (
      approvalPrompt: string,
      signal: AbortSignal,
      allowSession: boolean,
    ): Promise<string | null> =>
      new Promise<string | null>((resolve) => {
        let settled = false;
        const settle = (answer: string | null) => {
          if (settled) return;
          settled = true;
          signal.removeEventListener("abort", onAbort);
          resolve(answer);
        };
        const onAbort = () => settle(null);
        if (signal.aborted) {
          settle(null);
          return;
        }
        signal.addEventListener("abort", onAbort, { once: true });
        setApproval({
          prompt: approvalPrompt,
          allowSession: allowSession,
          ...(commandPreview ? { command: commandPreview } : {}),
          ...(networkPreview ? { network: networkPreview } : {}),
          ...(subagentPreview ? { subagent: subagentPreview } : {}),
          resolve: settle,
        });
        commandPreview = undefined;
        networkPreview = undefined;
        subagentPreview = undefined;
        setPhase("approving");
      });
    const approvalChannel = createApprovalChannel(
      (approvalPrompt, signal, descriptor) =>
        requestApproval(
          approvalPrompt,
          signal,
          descriptor.allowedScopes.length > 0,
        ),
      stderr,
      {
        onDiffPreview: ({ diff }) => appendEntry("diff", diff),
        onCommandPreview: (preview) => {
          commandPreview = preview;
        },
        onNetworkPreview: (preview) => {
          networkPreview = preview;
        },
        onSubagentPreview: (preview) => {
          subagentPreview = preview;
        },
      },
    );

    const execute = async () => {
      const sessionId = await sessionPersistence?.prepareRun(
        prompt,
        imageSources.length,
      );
      if (activeOptions.engine === "codex") {
        let finalText = "";
        let reasoningText = "";
        codexExitCode = await executeCodexTask(prompt, activeOptions, {
          ...(sessionId ? { sessionId } : {}),
          env,
          cwd,
          stdout,
          stderr,
          onOutput: (event) => {
            handleCodexOutput(event);
            if (event.type === "answer") finalText += event.text;
            if (event.type === "reasoning") reasoningText += event.text;
          },
          conversation: [...conversation.current],
          ...(sessionPersistence?.contextCheckpoint
            ? { contextCheckpoint: sessionPersistence.contextCheckpoint }
            : {}),
          signal: controller.signal,
          approve: async (description) =>
            (await requestApproval(description, controller.signal, false)) ===
            "1",
          isTTY: true,
        });
        result = {
          status:
            codexExitCode === 0
              ? "completed"
              : codexExitCode === 130
                ? "cancelled"
                : "failed",
          exitCode: codexExitCode,
          finalText,
          modelSteps: 1,
          toolCalls: 0,
          events: reasoningText
            ? [{ type: "model.reasoning", step: 1, text: reasoningText }]
            : [],
        };
        metadata = {
          runId,
          ...(sessionId ? { sessionId } : {}),
          tracePersisted: false,
        };
        if (sessionPersistence) {
          await sessionPersistence.recordRun(prompt, result, metadata);
        }
        return;
      }
      await executeTask(
        prompt,
        imageSources.length
          ? { ...activeOptions, image: imageSources }
          : activeOptions,
        {
          env,
          cwd,
          stdout,
          stderr,
          runId,
          signal: controller.signal,
          approvalChannel,
          approvalStore,
          conversation: [...conversation.current],
          ...(sessionPersistence?.contextCheckpoint
            ? { contextCheckpoint: sessionPersistence.contextCheckpoint }
            : {}),
          ...(sessionPersistence?.contextDetails
            ? {
                contextPressureMode:
                  sessionPersistence.contextDetails().pressure.mode,
              }
            : {}),
          ...(sessionId ? { sessionId } : {}),
          onEvent: handleRunEvent,
          renderEventsToOutput: false,
          onResult: (nextResult, nextMetadata) => {
            result = nextResult;
            metadata = nextMetadata;
          },
        },
      );
      if (result && metadata && sessionPersistence) {
        await sessionPersistence.recordRun(prompt, result, metadata);
      }
    };
    const execution = sessionHost
      ? sessionHost.schedule(runId, controller, execute, (state) =>
          setQueued(state === "queued"),
        )
      : execute();
    void execution
      .catch((error: unknown) => {
        appendEntry(
          "error",
          `Session execution failed: ${error instanceof Error ? error.message : "unknown error"}`,
        );
      })
      .finally(() => {
        const completed =
          activeOptions.engine === "codex"
            ? codexExitCode === 0
            : result?.status === "completed";
        if (completed) {
          appendEntry(
            "system",
            `Completed · ${formatModelStatus(activeOptions)}`,
          );
        }
        if (result) {
          conversation.current.push(...runConversationMessages(prompt, result));
        }
        if (sessionHost && !completed)
          setEditor((current) =>
            current.value.trim() || current.images.length
              ? current
              : submittedEditor,
          );
        activeController.current = undefined;
        setQueued(false);
        setLastRunStatus(
          controller.signal.aborted
            ? "cancelled"
            : completed
              ? "completed"
              : "failed",
        );
        setApproval(undefined);
        setRunActivity(undefined);
        setPhase("editing");
      });
  };

  const cancelOrExit = (): void => {
    if (
      phase === "plugins" ||
      phase === "resources" ||
      phase === "plugin-trust"
    ) {
      setPluginTrustIntent(undefined);
      setPhase("editing");
      return;
    }
    if (phase !== "editing") {
      finishApproval(null);
      activeController.current?.abort("SIGINT");
      idleExitArmed.current = true;
      appendEntry("system", "Cancelling the active task…");
      return;
    }
    if (completionKind) {
      setDismissedCompletion(completionSignature);
      return;
    }
    if (idleExitArmed.current) {
      exit(0);
      return;
    }
    idleExitArmed.current = true;
    appendEntry("system", "Press Ctrl+C again to exit.");
  };

  usePaste(
    (text) => updateEditor((current) => insertPastedEditorText(current, text)),
    { isActive: (sessionHost?.focused ?? true) && phase === "editing" },
  );
  usePaste((text) => setLoginKey((current) => current + text), {
    isActive: (sessionHost?.focused ?? true) && phase === "login-key",
  });

  useInput(
    (input, key) =>
      handleInteractiveInput(input, key, {
        phase,
        env,
        cwd,
        stdout,
        stderr,
        ...(sessionHost ? { sessionHost } : {}),
        ...(sessionPersistence ? { sessionPersistence } : {}),
        transcriptLength: transcript.length,
        activeOptions,
        approvalStore,
        ...(approval ? { approval } : {}),
        approvalFeedback,
        ...(contextPanel ? { contextPanel } : {}),
        contextModeSelector,
        contextModeSelection,
        contextOfferVisible,
        ...(completionKind ? { completionKind } : {}),
        completionSignature,
        ...(mentionQuery ? { mentionQuery } : {}),
        fileCandidates,
        visibleCandidates,
        selectedIndex,
        resources,
        ...(pluginTrustIntent ? { pluginTrustIntent } : {}),
        sessions,
        sessionDeletionConfirmed,
        loginChoices,
        loginKey,
        ...(loginChoice ? { loginChoice } : {}),
        ...(selectedProviderRoute ? { selectedProviderRoute } : {}),
        providerProfiles,
        providerActionChoices,
        logoutChoices,
        modelChoices,
        baseModelChoices,
        visibleModelChoices,
        selectedModelIndex,
        ...(pendingModelDeletion ? { pendingModelDeletion } : {}),
        deleteModelReturnPhase,
        effortChoices,
        conversationRef: conversation,
        activeControllerRef: activeController,
        idleExitArmedRef: idleExitArmed,
        nextTranscriptIdRef: nextTranscriptId,
        cancelOrExit,
        exit,
        finishApproval,
        appendEntry,
        updateEditor,
        executeCommand,
        submitPrompt,
        selectEffort,
        cycleEffort,
        logoutApiProvider,
        handleCodexOutput,
        updateProjectPluginTrust,
        executeAuthentication,
        executeLogout,
        saveApiKey,
        removeApiKey,
        removeProviderRoute,
        removeProviderModel,
        persistModelSelection,
        discoverSubscriptionModels,
        setTranscriptOffset,
        setTranscript,
        setStaticRenderRevision,
        setContextModeSelector,
        setContextModeSelection,
        setContextRevision,
        setContextPanel,
        setContextOfferDismissed,
        setContextActivity,
        setApprovalFeedback,
        setPhase,
        setSelectedIndex,
        setPermissionRevision,
        setPluginTrustIntent,
        setResources,
        setSessionDeletionConfirmed,
        setSessions,
        setLoginKey,
        setLoginChoice,
        setProviderSetupRoute,
        setSelectedProviderRoute,
        setLoginPrompt,
        setProviderProfiles,
        setModelChoices,
        setLoggedOutProviderRoutes,
        setDeleteModelReturnPhase,
        setPendingModelDeletion,
        setModelQuery,
        setActiveOptions,
        setDismissedCompletion,
        setEditor,
      }),
    { isActive: sessionHost?.focused ?? true },
  );

  useEffect(() => {
    setInputReady(true);
  }, []);
  if (sessionHost && (!sessionHost.visible || !inputReady)) return <Box />;
  const liveTranscriptEnd = Math.max(0, transcript.length - transcriptOffset);
  const liveTranscript = transcript.slice(
    Math.max(0, liveTranscriptEnd - 12),
    liveTranscriptEnd,
  );
  const staticTranscript =
    phase === "running" ? transcript.slice(0, -1) : transcript;
  const staticOutputItems: StaticOutputItem[] = [
    { kind: "header", resources },
    ...Array.from(staticTranscript, (entry) => ({
      kind: "transcript" as const,
      entry,
    })),
  ];

  return (
    <Box flexDirection="column" paddingX={1}>
      {transcript.length === 0 ? <ForgeHeader resources={resources} /> : null}

      {hosted && transcript.length > 0 ? (
        <>
          <Box
            height={Math.max(4, terminalHeight - (approval ? 26 : 16))}
            overflow="hidden"
            flexDirection="column"
            justifyContent="flex-end"
          >
            {liveTranscript.map((entry) => (
              <Box key={entry.id} flexShrink={0} flexDirection="column">
                <TranscriptBlock
                  entry={{ ...entry, text: entry.text.slice(-16_000) }}
                />
              </Box>
            ))}
          </Box>
          <Text dimColor>
            PgUp/PgDn transcript ·{" "}
            {transcriptOffset
              ? `${transcriptOffset} newer entries below`
              : "latest output"}
            {queued ? " · Queued: waiting for an execution slot" : ""}
          </Text>
        </>
      ) : transcript.length > 0 ? (
        <>
          <Static key={staticRenderRevision} items={staticOutputItems}>
            {(item) =>
              item.kind === "header" ? (
                <ForgeHeader key="forge-header" resources={item.resources} />
              ) : (
                <TranscriptBlock key={item.entry.id} entry={item.entry} />
              )
            }
          </Static>
          {phase === "running" && transcript.at(-1) ? (
            <Box flexDirection="column" marginTop={1}>
              <TranscriptBlock entry={transcript.at(-1) as TranscriptEntry} />
            </Box>
          ) : null}
        </>
      ) : null}

      <PhaseOverlays
        phase={phase}
        cwd={cwd}
        env={env}
        activeOptions={activeOptions}
        permissionProfileSource={permissionProfileSource}
        approvalStore={approvalStore}
        selectedIndex={selectedIndex}
        permissionRevision={permissionRevision}
        resources={resources}
        pluginTrustIntent={pluginTrustIntent}
        approval={approval}
        approvalFeedback={approvalFeedback}
        updateState={updateState}
        terminalWidth={terminalWidth}
        sessions={sessions}
        sessionDeletionConfirmed={sessionDeletionConfirmed}
        canDeleteSession={Boolean(sessionPersistence?.delete)}
        modelQuery={modelQuery}
        modelsLoading={modelsLoading}
        modelChoices={modelChoices}
        visibleModelChoices={visibleModelChoices}
        selectedModelIndex={selectedModelIndex}
        pendingModelDeletion={pendingModelDeletion}
        effortChoices={effortChoices}
        loginChoices={loginChoices}
        selectedProviderRoute={selectedProviderRoute}
        selectedProviderProfile={selectedProviderProfile}
        selectedProviderState={selectedProviderState}
        providerActionChoices={providerActionChoices}
        logoutChoices={logoutChoices}
        loginPrompt={loginPrompt}
        loginChoice={loginChoice}
        loginKey={loginKey}
        providerProfiles={providerProfiles}
        providerSetupRoute={providerSetupRoute}
        discoverProviderModels={discoverProviderModels}
        onCancelProviderSetup={() => {
          setProviderSetupRoute(undefined);
          setPhase("editing");
        }}
        onCompleteProviderSetup={(result) => {
          setPhase("running");
          void completeProviderSetup(result);
        }}
        contextPanel={contextPanel}
        contextModeSelector={contextModeSelector}
        contextModeSelection={contextModeSelection}
        editor={editor}
        completionKind={completionKind}
        visibleCandidates={visibleCandidates}
        fileCandidatesCount={fileCandidates.length}
        contextOfferVisible={contextOfferVisible}
      />

      <PromptFooter
        activeOptions={activeOptions}
        filesLoading={filesLoading}
        phase={phase}
        {...(runActivity ? { runActivity } : {})}
        runActivityFrame={runActivityFrame}
        {...(contextStatus ? { contextStatus } : {})}
        {...(contextActivity ? { contextStateOverride: contextActivity } : {})}
        terminalWidth={terminalWidth}
      />
    </Box>
  );
}
