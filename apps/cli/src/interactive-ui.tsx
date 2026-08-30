import { randomUUID } from "node:crypto";
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
  ToolCall,
} from "@forge/core";
import {
  canonicalText,
  formatApprovalScope,
  runConversationMessages,
  SessionApprovalStore,
  type SessionGrant,
} from "@forge/core";
import {
  type DiscoverModelsRequest,
  discoverModels,
} from "@forge/model-compat";
import type { SessionReasoning, SessionSummary } from "@forge/persistence";
import {
  Box,
  render,
  Static,
  Text,
  useApp,
  useInput,
  usePaste,
  useWindowSize,
} from "ink";
import type React from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import type { AskOptions, WritableOutput } from "./ask.js";
import {
  type CodexClient,
  type CodexCommandDependencies,
  type CodexOutputEvent,
  discoverCodexModels,
  runCodexAuthCommand,
  runCodexTask,
} from "./codex-command.js";
import {
  filterSlashCommands,
  formatSlashCommandHelp,
  type SlashCommand,
} from "./commands.js";
import {
  type DiffRow,
  formatUnifiedDiffRows,
  summarizeUnifiedDiff,
} from "./diff.js";
import { terminalHyperlink } from "./hyperlink.js";
import { isSupportedImagePath } from "./image-input.js";
import {
  activeMentionQuery,
  assemblePrompt,
  classifySubmissionKey,
  createEditorState,
  deleteEditorRange,
  discoverWorkspaceFiles,
  type EditorState,
  filterFuzzy,
  filterWorkspaceFiles,
  insertEditorText,
  insertFileMention,
  insertPastedEditorText,
  moveEditorCursor,
  referencedPaths,
  slashCommandQuery,
} from "./interactive-model.js";
import { TerminalMarkdown } from "./markdown.js";
import {
  type ContextStatus,
  createPersistentInteractiveSession,
  type InteractiveSessionPersistence,
} from "./persistent-session.js";
import { ProviderSetup, type ProviderSetupResult } from "./provider-setup.js";
import {
  type CommandApprovalPreview,
  createApprovalChannel,
  type NetworkApprovalPreview,
  type RunDependencies,
  type RunMetadata,
  runTask,
  type SubagentApprovalPreview,
} from "./run.js";
import {
  changeProjectPluginTrust,
  type DetectedStartupResources,
  detectStartupResources,
  EMPTY_STARTUP_RESOURCES,
} from "./startup-resources.js";
import {
  createUpdateService,
  FORGE_RELEASES_URL,
  type UpdateService,
  type UpdateState,
} from "./update.js";

type Phase =
  | "editing"
  | "running"
  | "approving"
  | "approval-feedback"
  | "resuming"
  | "models"
  | "delete-models"
  | "delete-model-confirm"
  | "effort"
  | "plugins"
  | "resources"
  | "permissions"
  | "plugin-trust"
  | "login-providers"
  | "login-key"
  | "logout-providers"
  | "provider-actions"
  | "provider-remove-confirm"
  | "provider-setup";
type TranscriptKind =
  | "user"
  | "reasoning"
  | "answer"
  | "tool"
  | "warning"
  | "error"
  | "system"
  | "diff"
  | "raw";

interface TranscriptEntry {
  readonly id: number;
  readonly kind: TranscriptKind;
  readonly text: string;
}

type StaticOutputItem =
  | {
      readonly kind: "header";
      readonly resources: DetectedStartupResources;
    }
  | { readonly kind: "transcript"; readonly entry: TranscriptEntry };

interface PendingApproval {
  readonly prompt: string;
  readonly allowSession: boolean;
  readonly command?: CommandApprovalPreview;
  readonly network?: NetworkApprovalPreview;
  readonly subagent?: SubagentApprovalPreview;
  readonly resolve: (answer: string | null) => void;
}

type RunActivity =
  | { readonly kind: "thinking"; readonly step?: number }
  | {
      readonly kind: "tool";
      readonly stage: "preparing" | "executing";
      readonly toolName: string;
      readonly target?: string;
    };

const RUN_ACTIVITY_FRAMES = [
  "⠋",
  "⠙",
  "⠹",
  "⠸",
  "⠼",
  "⠴",
  "⠦",
  "⠧",
  "⠇",
  "⠏",
] as const;

/** A sign-in that App Server has started and is still waiting to complete. */
interface PendingSignIn {
  readonly url: string;
  readonly userCode?: string;
}

interface ModelChoice {
  readonly label: string;
  readonly description: string;
  readonly selection: PersistedModelSelection;
  readonly supportedReasoningEfforts: readonly EffortChoice[];
  readonly defaultReasoningEffort: ReasoningEffort;
}

type ReasoningEffort = NonNullable<PersistedModelSelection["reasoningEffort"]>;

interface EffortChoice {
  readonly effort: ReasoningEffort;
  readonly description: string;
}

interface LoginChoice {
  readonly label: string;
  readonly description: string;
  readonly kind:
    | "subscription"
    | "api-key"
    | "provider-route"
    | "configured-provider";
  readonly provider?: ApiKeyProvider;
  readonly route?: string;
  readonly details?: string;
}

interface LogoutChoice {
  readonly label: string;
  readonly description: string;
  readonly kind: "subscription" | "api-key";
  readonly provider: string;
  readonly environmentVariable?: string;
}

interface ProviderRouteState {
  readonly ready: boolean;
  readonly label: string;
}

interface ProviderActionChoice {
  readonly kind: "add-model" | "delete-model" | "logout" | "remove";
  readonly label: string;
  readonly description: string;
}

const LOGIN_CHOICES: readonly LoginChoice[] = [
  {
    label: "ChatGPT subscription",
    description: "Official Codex sign-in · subscription usage",
    kind: "subscription",
  },
  {
    label: "DeepSeek API",
    description: "Save a DeepSeek API key",
    kind: "api-key",
    provider: "deepseek",
  },
  {
    label: "OpenAI API",
    description: "Save an API key · billed separately from ChatGPT",
    kind: "api-key",
    provider: "openai",
  },
  {
    label: "Add third-party provider",
    description: "OpenAI-compatible endpoint or local server",
    kind: "provider-route",
  },
];

function providerLoginChoices(
  providers: Readonly<Record<string, ProviderProfile>>,
  statusFor: (route: string, profile: ProviderProfile) => ProviderRouteState,
): readonly LoginChoice[] {
  return [
    ...LOGIN_CHOICES,
    ...Object.entries(providers).map(([route, profile]) => {
      const modelCount = profile.models?.length ?? 0;
      const status = statusFor(route, profile);
      return {
        label: profile.displayName ?? route,
        description: `${status.label} · ${modelCount} ${modelCount === 1 ? "model" : "models"}`,
        details: `${profile.baseUrl} · ${profile.api} · ${profile.auth.type === "bearer" ? "bearer" : "no auth"}`,
        kind: "configured-provider" as const,
        route,
      };
    }),
  ];
}

function providerActions(
  profile: ProviderProfile,
  status: ProviderRouteState,
): readonly ProviderActionChoice[] {
  return [
    {
      kind: "add-model",
      label: status.ready ? "Add model" : "Log in and add model",
      description: status.ready
        ? "Discover or enter another model"
        : "Save a credential, then discover models",
    },
    ...((profile.models?.length ?? 0) > 0
      ? [
          {
            kind: "delete-model" as const,
            label: "Delete model",
            description: "Remove one configured model",
          },
        ]
      : []),
    ...(profile.auth.type === "bearer" && status.ready
      ? [
          {
            kind: "logout" as const,
            label: "Log out",
            description: "Remove the stored credential",
          },
        ]
      : []),
    {
      kind: "remove",
      label: "Remove provider",
      description: "Delete the route, models, and stored credential",
    },
  ];
}

function providerCapabilitySummary(profile: ProviderProfile): string {
  const efforts = [
    ...new Set(
      (profile.models ?? []).flatMap((model) =>
        typeof model.reasoningGears === "object"
          ? Object.keys(model.reasoningGears)
          : [],
      ),
    ),
  ];
  return efforts.length > 0
    ? `Declared reasoning: ${efforts.join(", ")} · tools: protocol-supported · agent loop: unverified`
    : "Reasoning controls: provider default · tools: protocol-supported · agent loop: unverified";
}

function providerModelChoices(
  providers: Readonly<Record<string, ProviderProfile>>,
): readonly ModelChoice[] {
  return Object.entries(providers).flatMap(([route, profile]) =>
    (profile.models ?? []).map((model) => {
      const declared = model.reasoningGears;
      const supported =
        declared === false || declared === undefined
          ? [{ effort: "none" as const, description: "No reasoning" }]
          : STANDARD_EFFORTS.filter(({ effort }) =>
              Object.hasOwn(declared, effort),
            );
      return {
        label: model.name ?? model.id,
        description: `${profile.displayName ?? route} · ${profile.api}`,
        selection: { engine: "forge" as const, provider: route, id: model.id },
        supportedReasoningEfforts:
          supported.length > 0
            ? supported
            : [{ effort: "none" as const, description: "No reasoning" }],
        defaultReasoningEffort:
          supported.find(({ effort }) => effort === "medium")?.effort ??
          supported[0]?.effort ??
          "none",
      };
    }),
  );
}

function providerLogoutChoices(
  providers: Readonly<Record<string, ProviderProfile>>,
  env: NodeJS.ProcessEnv,
): readonly LogoutChoice[] {
  const authentication = new AuthenticationManager(env);
  const isAuthenticated = (
    provider: string,
    options?: { endpoint?: string; environmentVariable?: string },
  ): boolean => {
    try {
      return authentication.status(provider, options).authenticated;
    } catch {
      return false;
    }
  };
  return [
    {
      label: "ChatGPT subscription",
      description: "Codex account",
      kind: "subscription" as const,
      provider: "openai",
    },
    ...(isAuthenticated("deepseek")
      ? [
          {
            label: "DeepSeek API",
            description: "Stored or environment credential",
            kind: "api-key" as const,
            provider: "deepseek",
          },
        ]
      : []),
    ...(isAuthenticated("openai")
      ? [
          {
            label: "OpenAI API",
            description: "Stored or environment credential",
            kind: "api-key" as const,
            provider: "openai",
          },
        ]
      : []),
    ...Object.entries(providers)
      .filter(
        ([route, profile]) =>
          profile.auth.type === "bearer" &&
          isAuthenticated(route, {
            endpoint: profile.baseUrl,
            ...(profile.auth.apiKeyEnv
              ? { environmentVariable: profile.auth.apiKeyEnv }
              : {}),
          }),
      )
      .map(([route, profile]) => ({
        label: profile.displayName ?? route,
        description: `Provider route · ${route}`,
        kind: "api-key" as const,
        provider: route,
        ...(profile.auth.type === "bearer" && profile.auth.apiKeyEnv
          ? { environmentVariable: profile.auth.apiKeyEnv }
          : {}),
      })),
  ];
}

function providerRouteState(
  route: string,
  profile: ProviderProfile,
  env: NodeJS.ProcessEnv,
  loggedOut: ReadonlySet<string>,
): ProviderRouteState {
  if (profile.auth.type === "none") return { ready: true, label: "ready" };
  if (loggedOut.has(route)) return { ready: false, label: "signed out" };
  try {
    const status = new AuthenticationManager(env).status(route, {
      endpoint: profile.baseUrl,
      ...(profile.auth.apiKeyEnv
        ? { environmentVariable: profile.auth.apiKeyEnv }
        : {}),
    });
    if (!status.authenticated) return { ready: false, label: "signed out" };
    return {
      ready: true,
      label:
        status.source === "environment"
          ? `ready via ${status.environmentVariable}`
          : "ready",
    };
  } catch {
    return { ready: false, label: "credential unavailable" };
  }
}

function modelChoiceKey(choice: ModelChoice): string {
  const { selection } = choice;
  return [selection.engine, selection.provider, selection.id].join("\u0000");
}

function modelChoiceSearchFields(choice: ModelChoice): readonly string[] {
  const { selection } = choice;
  return [
    choice.label,
    choice.description,
    selection.engine,
    selection.provider,
    selection.id,
  ].filter((value): value is string => value !== undefined);
}

const STANDARD_EFFORTS: readonly EffortChoice[] = [
  { effort: "none", description: "No reasoning" },
  { effort: "minimal", description: "Fastest" },
  { effort: "low", description: "Fast" },
  { effort: "medium", description: "Balanced" },
  { effort: "high", description: "Deep" },
  { effort: "xhigh", description: "Deeper" },
  { effort: "max", description: "Maximum" },
];

const MODEL_CHOICES: readonly ModelChoice[] = [
  {
    label: "DeepSeek V4 Flash",
    description: "DeepSeek API",
    selection: {
      engine: "forge",
      provider: "deepseek",
      id: "deepseek-v4-flash",
    },
    supportedReasoningEfforts: STANDARD_EFFORTS,
    defaultReasoningEffort: "medium",
  },
  {
    label: "DeepSeek V4 Pro",
    description: "DeepSeek API",
    selection: {
      engine: "forge",
      provider: "deepseek",
      id: "deepseek-v4-pro",
    },
    supportedReasoningEfforts: STANDARD_EFFORTS,
    defaultReasoningEffort: "medium",
  },
  {
    label: "GPT-5.4 mini",
    description: "OpenAI API key · separately billed",
    selection: {
      engine: "forge",
      provider: "openai",
      id: "gpt-5.4-mini",
    },
    supportedReasoningEfforts: STANDARD_EFFORTS,
    defaultReasoningEffort: "low",
  },
  {
    label: "GPT-5.4",
    description: "OpenAI API key · separately billed",
    selection: {
      engine: "forge",
      provider: "openai",
      id: "gpt-5.4",
    },
    supportedReasoningEfforts: STANDARD_EFFORTS,
    defaultReasoningEffort: "high",
  },
  {
    label: "DeepSeek V4 Flash Vision Experimental",
    description: "DeepSeek Responses API",
    selection: {
      engine: "forge",
      provider: "deepseek",
      id: "deepseek-v4-flash-vision-exp",
    },
    supportedReasoningEfforts: STANDARD_EFFORTS,
    defaultReasoningEffort: "medium",
  },
];

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
  ) => Promise<readonly import("@forge/codex-app-server").CodexModel[]>;
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

interface InteractiveAppProps extends InteractiveUiDependencies {
  readonly options: AskOptions;
  readonly initialProviders?: Readonly<Record<string, ProviderProfile>>;
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
    executeCodexTask:
      dependencies.executeCodexTask ??
      ((prompt, taskOptions, taskDependencies) =>
        withSharedCodexClient((client) =>
          runCodexTask(prompt, taskOptions, {
            ...taskDependencies,
            client,
          }),
        )),
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
    const instance = render(
      <InteractiveApp
        {...interactiveDependencies}
        sessionPersistence={sessionPersistence}
        detectedResources={detectedResources}
        options={effectiveOptions}
        initialProviders={initialProviders}
      />,
      {
        stdin: process.stdin,
        stdout: process.stdout,
        stderr: process.stderr,
        exitOnCtrlC: false,
        // Incremental line diffs can retain stale physical rows after the
        // terminal rewraps content during a resize. Full-frame updates are more
        // reliable for this bounded interactive UI.
        incrementalRendering: INK_INCREMENTAL_RENDERING,
        // Ink's auto-detection query is sent before raw mode is active. VS Code
        // can echo that query as literal input, so use direct activation only
        // for terminals known to support the protocol. Ctrl+J, Meta+Enter, and
        // the legacy parser remain available for all other terminals.
        kittyKeyboard: { mode: resolveInkKeyboardMode(dependencies.env) },
      },
    );
    const result = await instance.waitUntilExit();
    return typeof result === "number" ? result : 0;
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
  const { exit } = useApp();
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
  const { columns: terminalWidth } = useWindowSize();
  const [resources, setResources] =
    useState<DetectedStartupResources>(detectedResources);
  const [pluginTrustIntent, setPluginTrustIntent] = useState<
    "trust" | "untrust"
  >();
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
    contextStatus?.pressure.mode === "warn" &&
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
      setTranscript((current) =>
        appendTranscriptEntry(
          current,
          { id: nextTranscriptId.current++, kind, text },
          merge,
        ),
      );
    },
    [],
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
          appendEntry("warning", event.message);
          break;
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
      "deepseek-v4-flash";
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
    const normalizedCommand = command.trim();
    if (normalizedCommand.startsWith("/effort ")) {
      const requested = asPersistedReasoningEffort(
        normalizedCommand.slice("/effort ".length).trim().toLocaleLowerCase(),
      );
      if (!requested) {
        appendEntry(
          "warning",
          `Unsupported effort. Choose one of: ${STANDARD_EFFORTS.map(({ effort }) => effort).join(", ")}.`,
        );
        setEditor(createEditorState());
        return;
      }
      setEditor(createEditorState());
      if (
        activeOptions.engine === "codex" &&
        !modelChoiceFor(modelChoices, activeOptions)
      ) {
        void discoverSubscriptionModels({
          env,
          cwd,
          stdout,
          stderr,
          signal: new AbortController().signal,
          isTTY: true,
        }).then(
          (models) => {
            const subscriptionChoices = subscriptionModelChoices(models);
            setModelChoices([...subscriptionChoices, ...baseModelChoices]);
            const matching = modelChoiceFor(subscriptionChoices, activeOptions);
            if (!matching) {
              appendEntry(
                "warning",
                `Could not find effort metadata for ${activeOptions.model}.`,
              );
              return;
            }
            const supported = matching.supportedReasoningEfforts;
            if (supported.some(({ effort }) => effort === requested)) {
              selectEffort(requested);
            } else {
              appendEntry(
                "warning",
                `Unsupported effort for ${activeOptions.model}: ${requested}. Choose one of: ${supported.map(({ effort }) => effort).join(", ")}.`,
              );
            }
          },
          (error: unknown) =>
            appendEntry(
              "warning",
              `Could not discover supported effort levels: ${error instanceof Error ? error.message : "unknown error"}`,
            ),
        );
        return;
      }
      const supported = effortsForModel(modelChoices, activeOptions);
      if (!supported.some(({ effort }) => effort === requested)) {
        appendEntry(
          "warning",
          `Unsupported effort for ${activeOptions.model}: ${requested}. Choose one of: ${supported.map(({ effort }) => effort).join(", ")}.`,
        );
        return;
      }
      selectEffort(requested);
      return;
    }
    switch (normalizedCommand) {
      case "/exit":
        exit(0);
        return;
      case "/clear":
        conversation.current = [];
        sessionPersistence?.clear();
        setContextPanel(undefined);
        setContextOfferDismissed(false);
        setContextActivity(undefined);
        setStaticRenderRevision((current) => current + 1);
        setTranscript([]);
        nextTranscriptId.current = 0;
        setEditor(createEditorState());
        return;
      case "/new":
        conversation.current = [];
        sessionPersistence?.clear();
        setContextPanel(undefined);
        setContextOfferDismissed(false);
        setContextActivity(undefined);
        setStaticRenderRevision((current) => current + 1);
        setTranscript([]);
        nextTranscriptId.current = 0;
        setEditor(createEditorState());
        approvalStore.clear();
        setPermissionRevision((current) => current + 1);
        appendEntry("system", "Started a new session.");
        return;
      case "/context":
        setEditor(createEditorState());
        if (sessionPersistence?.contextDetails) {
          setContextPanel(sessionPersistence.contextDetails());
        } else {
          appendEntry(
            "system",
            sessionPersistence?.contextStatus?.() ??
              "Context status is unavailable because persistence is disabled.",
          );
        }
        return;
      case "/permissions":
        setEditor(createEditorState());
        setSelectedIndex(0);
        setPhase("permissions");
        return;
      case "/update-dismiss":
        setEditor(createEditorState());
        if (updateState?.latestVersion && updateService) {
          void updateService.dismiss(updateState.latestVersion);
        }
        return;
      case "/plugins":
        setEditor(createEditorState());
        setSelectedIndex(0);
        setPluginTrustIntent(undefined);
        setPhase("plugins");
        return;
      case "/resources":
        setEditor(createEditorState());
        setPhase("resources");
        return;
      case "/compact --dry-run":
      case "/compact": {
        setEditor(createEditorState());
        if (!sessionPersistence?.compact) {
          appendEntry(
            "warning",
            "Compaction is unavailable because persistence is disabled.",
          );
          return;
        }
        const dryRun = command.trim() === "/compact --dry-run";
        void sessionPersistence.compact(dryRun).then(
          (message) => {
            appendEntry("system", message);
            if (sessionPersistence.contextDetails) {
              setContextPanel(sessionPersistence.contextDetails());
            }
          },
          (error: unknown) =>
            appendEntry(
              "error",
              `Could not compact session: ${error instanceof Error ? error.message : "unknown error"}`,
            ),
        );
        return;
      }
      case "/resume":
        setEditor(createEditorState());
        setContextPanel(undefined);
        approvalStore.clear();
        setPermissionRevision((current) => current + 1);
        if (!sessionPersistence) {
          appendEntry("warning", "Persistent sessions are unavailable.\n");
          return;
        }
        setPhase("resuming");
        setSelectedIndex(0);
        void sessionPersistence.list().then(
          (available) => {
            if (available.length === 0) {
              appendEntry(
                "system",
                "No saved session exists for this workspace.",
              );
              setPhase("editing");
              return;
            }
            setSessions(available.slice(0, 10));
          },
          (error: unknown) => {
            appendEntry(
              "error",
              `Could not list sessions: ${error instanceof Error ? error.message : "unknown error"}`,
            );
            setPhase("editing");
          },
        );
        return;
      case "/login":
        setEditor(createEditorState());
        setLoginKey("");
        setLoginChoice(undefined);
        setProviderSetupRoute(undefined);
        setSelectedProviderRoute(undefined);
        setSelectedIndex(0);
        setPhase("login-providers");
        return;
      case "/logout":
        setEditor(createEditorState());
        setSelectedIndex(0);
        setPhase("logout-providers");
        return;
      case "/model":
        setEditor(createEditorState());
        setSelectedIndex(0);
        setModelQuery("");
        setPhase("models");
        setModelsLoading(true);
        void discoverSubscriptionModels({
          env,
          cwd,
          stdout,
          stderr,
          signal: new AbortController().signal,
          isTTY: true,
        }).then(
          (models) => {
            const subscriptionChoices = subscriptionModelChoices(models);
            setModelChoices([
              ...subscriptionChoices.slice(0, 40),
              ...baseModelChoices,
            ]);
            setModelsLoading(false);
          },
          (error: unknown) => {
            appendEntry(
              "warning",
              `${error instanceof Error ? error.message : "Could not discover Codex models."} API models remain available.`,
            );
            setModelChoices(baseModelChoices);
            setModelsLoading(false);
          },
        );
        return;
      case "/delete-model": {
        setEditor(createEditorState());
        setSelectedIndex(0);
        setModelQuery("");
        setPendingModelDeletion(undefined);
        setDeleteModelReturnPhase("editing");
        const configured = providerModelChoices(providerProfiles);
        if (configured.length === 0) {
          appendEntry("system", "No configured provider model can be deleted.");
          return;
        }
        setModelChoices(configured);
        setPhase("delete-models");
        return;
      }
      case "/effort": {
        setEditor(createEditorState());
        const knownModel = modelChoiceFor(modelChoices, activeOptions);
        const availableEfforts =
          activeOptions.engine === "codex" && !knownModel
            ? []
            : effortsForModel(modelChoices, activeOptions);
        setEffortChoices(availableEfforts);
        setSelectedIndex(
          Math.max(
            0,
            availableEfforts.findIndex(
              ({ effort }) => effort === activeOptions.reasoningEffort,
            ),
          ),
        );
        setPhase("effort");
        if (activeOptions.engine === "codex") {
          void discoverSubscriptionModels({
            env,
            cwd,
            stdout,
            stderr,
            signal: new AbortController().signal,
            isTTY: true,
          }).then(
            (models) => {
              const subscriptionChoices = subscriptionModelChoices(models);
              setModelChoices([...subscriptionChoices, ...baseModelChoices]);
              const matching = modelChoiceFor(
                subscriptionChoices,
                activeOptions,
              );
              if (!matching) {
                appendEntry(
                  "warning",
                  `Could not find effort metadata for ${activeOptions.model}.`,
                );
                setPhase("editing");
                return;
              }
              setEffortChoices(matching.supportedReasoningEfforts);
              setSelectedIndex(() => {
                const efforts = matching.supportedReasoningEfforts;
                return Math.max(
                  0,
                  efforts.findIndex(
                    ({ effort }) => effort === activeOptions.reasoningEffort,
                  ),
                );
              });
            },
            () => undefined,
          );
        }
        return;
      }
      case "/help":
        appendEntry("system", formatSlashCommandHelp());
        setEditor(createEditorState());
        return;
      default:
        appendEntry(
          "warning",
          `Unknown command: ${command.trim()}. Type /help for commands.\n`,
        );
        setEditor(createEditorState());
    }
  };

  const submitPrompt = (): void => {
    const visiblePrompt = editor.value.trim();
    if (visiblePrompt === "" && editor.images.length === 0) return;
    if (visiblePrompt.startsWith("/") && editor.images.length === 0) {
      executeCommand(visiblePrompt);
      return;
    }

    const prompt = assemblePrompt(editor);
    const imageSources = [
      ...editor.images.map(({ source }) => source),
      ...referencedPaths(editor).filter(isSupportedImagePath),
    ];
    const controller = new AbortController();
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

    const approvalChannel = createApprovalChannel(
      (approvalPrompt, signal, descriptor) =>
        new Promise<string | null>((resolve) => {
          let settled = false;
          const settle = (answer: string | null) => {
            if (settled) return;
            settled = true;
            signal.removeEventListener("abort", onAbort);
            resolve(answer);
          };
          const onAbort = () => settle(null);
          signal.addEventListener("abort", onAbort, { once: true });
          setApproval({
            prompt: approvalPrompt,
            allowSession: descriptor.allowedScopes.length > 0,
            ...(commandPreview ? { command: commandPreview } : {}),
            ...(networkPreview ? { network: networkPreview } : {}),
            ...(subagentPreview ? { subagent: subagentPreview } : {}),
            resolve: settle,
          });
          commandPreview = undefined;
          networkPreview = undefined;
          subagentPreview = undefined;
          setPhase("approving");
        }),
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

    void (async () => {
      const sessionId = await sessionPersistence?.prepareRun(
        prompt,
        imageSources.length,
      );
      if (activeOptions.engine === "codex") {
        let finalText = "";
        let reasoningText = "";
        codexExitCode = await executeCodexTask(prompt, activeOptions, {
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
          runId: randomUUID(),
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
    })()
      .catch((error: unknown) => {
        appendEntry(
          "error",
          `Session persistence failed: ${error instanceof Error ? error.message : "unknown error"}`,
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
        activeController.current = undefined;
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
    { isActive: phase === "editing" },
  );
  usePaste((text) => setLoginKey((current) => current + text), {
    isActive: phase === "login-key",
  });

  useInput((input, key) => {
    if (phase === "provider-setup") return;
    const interruptCount = Array.from(input).filter(
      (character) => character === "\u0003",
    ).length;
    if ((key.ctrl && input.toLocaleLowerCase() === "c") || interruptCount > 0) {
      cancelOrExit();
      if (interruptCount > 1 && phase === "editing" && !completionKind) exit(0);
      return;
    }

    if (phase === "editing" && contextPanel) {
      const answer = input.toLocaleLowerCase();
      if (key.escape) {
        setContextPanel(undefined);
      } else if (answer === "a") {
        sessionPersistence?.enableAutoForSession?.();
        setContextRevision((current) => current + 1);
        setContextPanel(sessionPersistence?.contextDetails?.());
      } else if (answer === "s" && sessionPersistence?.saveAutoDefault) {
        void sessionPersistence.saveAutoDefault().then(
          (savedPath) => {
            appendEntry(
              "system",
              `Saved automatic compaction as the user default in ${savedPath}.`,
            );
            setContextRevision((current) => current + 1);
            setContextPanel(sessionPersistence.contextDetails?.());
          },
          (error: unknown) =>
            appendEntry(
              "error",
              `Could not save context default: ${error instanceof Error ? error.message : "unknown error"}`,
            ),
        );
      } else if (
        (answer === "c" || answer === "p") &&
        sessionPersistence?.compact
      ) {
        if (answer === "c") setContextActivity("compacting");
        void sessionPersistence.compact(answer === "p").then(
          (message) => {
            appendEntry("system", message);
            setContextRevision((current) => current + 1);
            setContextPanel(sessionPersistence.contextDetails?.());
            if (answer === "c") setContextActivity("compacted");
          },
          (error: unknown) =>
            appendEntry(
              "error",
              `Could not compact session: ${error instanceof Error ? error.message : "unknown error"}`,
            ),
        );
      }
      return;
    }

    if (contextOfferVisible) {
      const answer = input.toLocaleLowerCase();
      if (answer === "d" || key.escape) {
        setContextOfferDismissed(true);
      } else if (answer === "a") {
        sessionPersistence?.enableAutoForSession?.();
        setContextOfferDismissed(true);
        setContextRevision((current) => current + 1);
        appendEntry("system", "Automatic compaction enabled for this session.");
      } else if (answer === "c" && sessionPersistence?.compact) {
        setContextOfferDismissed(true);
        setContextActivity("compacting");
        void sessionPersistence.compact(false).then(
          (message) => {
            appendEntry("system", message);
            setContextRevision((current) => current + 1);
            setContextActivity("compacted");
          },
          (error: unknown) =>
            appendEntry(
              "error",
              `Could not compact session: ${error instanceof Error ? error.message : "unknown error"}`,
            ),
        );
      }
      return;
    }

    if (phase === "approving") {
      const answer = input.toLocaleLowerCase();
      if (answer === "1" || answer === "y") finishApproval("1");
      else if (answer === "2" && approval?.allowSession) finishApproval("2");
      else if (answer === "2") {
        appendEntry(
          "warning",
          "Session approval is unavailable for this action. Choose 1 or 3.",
        );
      } else if (answer === "3" || answer === "n") {
        setApprovalFeedback("");
        setPhase("approval-feedback");
      } else if (key.escape || key.return) finishApproval("3");
      return;
    }
    if (phase === "approval-feedback") {
      if (key.escape) {
        finishApproval("3");
      } else if (key.return) {
        finishApproval(
          approvalFeedback.trim() ? `3: ${approvalFeedback.trim()}` : "3",
        );
      } else if (key.backspace || key.delete) {
        setApprovalFeedback((current) => current.slice(0, -1));
      } else if (input && approvalFeedback.length < 2_000) {
        setApprovalFeedback((current) => `${current}${input}`.slice(0, 2_000));
      }
      return;
    }
    if (phase === "permissions") {
      const grants = approvalStore.list();
      if (key.escape) {
        setPhase("editing");
      } else if (key.upArrow && grants.length > 0) {
        setSelectedIndex(
          (current) => (current - 1 + grants.length) % grants.length,
        );
      } else if (key.downArrow && grants.length > 0) {
        setSelectedIndex((current) => (current + 1) % grants.length);
      } else if (input.toLocaleLowerCase() === "r" && grants[selectedIndex]) {
        approvalStore.revoke(grants[selectedIndex].id);
        setSelectedIndex((current) =>
          Math.max(0, Math.min(current, grants.length - 2)),
        );
        setPermissionRevision((current) => current + 1);
      } else if (input.toLocaleLowerCase() === "x") {
        approvalStore.clear();
        setSelectedIndex(0);
        setPermissionRevision((current) => current + 1);
      }
      return;
    }
    if (phase === "plugins") {
      if (key.escape) {
        setPhase("editing");
        return;
      }
      const projectPlugins = resources.plugins.filter(
        ({ scope }) => scope === "project",
      );
      const projectTrusted = projectPlugins.some(
        ({ state }) => state === "trusted",
      );
      const answer = input.toLocaleLowerCase();
      if (answer === "t" && projectPlugins.length > 0 && !projectTrusted) {
        setPluginTrustIntent("trust");
        setPhase("plugin-trust");
      } else if (answer === "u" && projectTrusted) {
        setPluginTrustIntent("untrust");
        setPhase("plugin-trust");
      }
      return;
    }
    if (phase === "resources") {
      if (key.escape) setPhase("editing");
      return;
    }
    if (phase === "plugin-trust") {
      const answer = input.toLocaleLowerCase();
      if (answer === "n" || key.escape || key.return) {
        setPluginTrustIntent(undefined);
        setPhase("plugins");
        return;
      }
      if (answer !== "y" || !pluginTrustIntent) return;
      const trusted = pluginTrustIntent === "trust";
      setPhase("running");
      void updateProjectPluginTrust(trusted).then(
        (nextResources) => {
          setResources(nextResources);
          setStaticRenderRevision((current) => current + 1);
          appendEntry(
            "system",
            trusted
              ? `Trusted project plugins for ${cwd}.\nThey will load on the next Forge task.`
              : `Removed project plugin trust for ${cwd}.`,
          );
          setPluginTrustIntent(undefined);
          setPhase("editing");
        },
        (error: unknown) => {
          appendEntry(
            "error",
            `Could not ${trusted ? "trust" : "untrust"} project plugins: ${error instanceof Error ? error.message : "unknown error"}`,
          );
          setPluginTrustIntent(undefined);
          setPhase("plugins");
        },
      );
      return;
    }
    if (phase === "resuming") {
      if (key.escape) {
        setSessions([]);
        setPhase("editing");
        return;
      }
      if (key.upArrow || key.downArrow) {
        setSelectedIndex((current) => {
          if (sessions.length === 0) return 0;
          const delta = key.upArrow ? -1 : 1;
          return (current + delta + sessions.length) % sessions.length;
        });
        return;
      }
      if (key.return) {
        const selected = sessions[Math.min(selectedIndex, sessions.length - 1)];
        if (selected && sessionPersistence) {
          void sessionPersistence.resume(selected.id).then(
            (messages) => {
              conversation.current = [
                ...(sessionPersistence.history ?? messages),
              ];
              const restored = conversationTranscript(
                sessionPersistence.history ?? messages,
                sessionPersistence.reasoning ?? [],
                sessionPersistence.historyEvents,
              );
              nextTranscriptId.current = restored.length;
              setStaticRenderRevision((current) => current + 1);
              setTranscript(restored);
              setSessions([]);
              setPhase("editing");
              setContextOfferDismissed(false);
              setContextActivity(undefined);
              appendEntry("system", `Resumed session ${selected.id}.`);
            },
            (error: unknown) => {
              appendEntry(
                "error",
                `Could not resume session: ${error instanceof Error ? error.message : "unknown error"}`,
              );
              setPhase("editing");
            },
          );
        }
        return;
      }
      return;
    }
    if (phase === "login-providers") {
      if (key.escape) {
        setPhase("editing");
        return;
      }
      if (key.upArrow || key.downArrow) {
        setSelectedIndex((current) => {
          const delta = key.upArrow ? -1 : 1;
          return (current + delta + loginChoices.length) % loginChoices.length;
        });
        return;
      }
      if (key.return) {
        const selected = loginChoices[selectedIndex];
        if (!selected) return;
        if (selected.kind === "api-key") {
          setLoginChoice(selected);
          setLoginKey("");
          setPhase("login-key");
          return;
        }
        if (selected.kind === "provider-route") {
          setProviderSetupRoute(undefined);
          setPhase("provider-setup");
          return;
        }
        if (selected.kind === "configured-provider" && selected.route) {
          setSelectedProviderRoute(selected.route);
          setSelectedIndex(0);
          setPhase("provider-actions");
          return;
        }
        const controller = new AbortController();
        activeController.current = controller;
        setPhase("running");
        void executeAuthentication({
          env,
          cwd,
          stdout,
          stderr,
          onOutput: handleCodexOutput,
          signal: controller.signal,
          isTTY: true,
        })
          .then((code) => {
            appendEntry(
              code === 0 ? "system" : "error",
              code === 0
                ? "ChatGPT subscription sign-in completed. Use /model to choose a Codex model."
                : "ChatGPT subscription sign-in did not complete.",
            );
          })
          .catch((error: unknown) =>
            appendEntry(
              "error",
              `Could not sign in: ${error instanceof Error ? error.message : "unknown error"}`,
            ),
          )
          .finally(() => {
            activeController.current = undefined;
            setLoginPrompt(undefined);
            setPhase("editing");
          });
        return;
      }
      return;
    }
    if (phase === "login-key") {
      if (key.escape) {
        setLoginKey("");
        setLoginChoice(undefined);
        setPhase("login-providers");
        return;
      }
      if (key.return) {
        const apiKey = loginKey.trim();
        const provider = loginChoice?.provider;
        if (!provider || apiKey === "") return;
        setLoginKey("");
        setPhase("running");
        void saveApiKey({ provider, apiKey, env }).then(
          (credentialPath) => {
            appendEntry(
              "system",
              `Saved ${loginChoice.label} credential to ${credentialPath}. Environment variables take precedence. Use /model to choose a model.`,
            );
            setLoginChoice(undefined);
            setPhase("editing");
          },
          (error: unknown) => {
            appendEntry(
              "error",
              `Could not save credential: ${error instanceof Error ? error.message : "unknown error"}`,
            );
            setPhase("login-key");
          },
        );
        return;
      }
      if (key.backspace || key.delete) {
        setLoginKey((current) => Array.from(current).slice(0, -1).join(""));
        return;
      }
      if (!key.ctrl && !key.meta && input !== "") {
        setLoginKey((current) => current + input);
      }
      return;
    }
    if (phase === "provider-actions") {
      if (key.escape) {
        setSelectedProviderRoute(undefined);
        setSelectedIndex(0);
        setPhase("login-providers");
        return;
      }
      if (key.upArrow || key.downArrow) {
        setSelectedIndex((current) => {
          if (providerActionChoices.length === 0) return 0;
          const delta = key.upArrow ? -1 : 1;
          return (
            (current + delta + providerActionChoices.length) %
            providerActionChoices.length
          );
        });
        return;
      }
      if (key.return) {
        const action = providerActionChoices[selectedIndex];
        const route = selectedProviderRoute;
        const profile = route ? providerProfiles[route] : undefined;
        if (!action || !route || !profile) return;
        if (action.kind === "add-model") {
          setProviderSetupRoute(route);
          setPhase("provider-setup");
          return;
        }
        if (action.kind === "delete-model") {
          const configured = providerModelChoices({ [route]: profile });
          if (configured.length === 0) return;
          setDeleteModelReturnPhase("provider-actions");
          setPendingModelDeletion(undefined);
          setModelQuery("");
          setSelectedIndex(0);
          setModelChoices(configured);
          setPhase("delete-models");
          return;
        }
        if (action.kind === "logout") {
          logoutApiProvider({
            label: profile.displayName ?? route,
            description: `Provider route · ${route}`,
            kind: "api-key",
            provider: route,
            ...(profile.auth.type === "bearer" && profile.auth.apiKeyEnv
              ? { environmentVariable: profile.auth.apiKeyEnv }
              : {}),
          });
          return;
        }
        if (activeOptions.provider === route) {
          appendEntry(
            "warning",
            `Choose a model from another provider before removing "${route}".`,
          );
          setSelectedProviderRoute(undefined);
          setPhase("editing");
          return;
        }
        setPhase("provider-remove-confirm");
        return;
      }
      return;
    }
    if (phase === "provider-remove-confirm") {
      if (key.escape || input.toLocaleLowerCase() === "n") {
        setPhase("provider-actions");
        return;
      }
      if (input.toLocaleLowerCase() === "y") {
        const route = selectedProviderRoute;
        const profile = route ? providerProfiles[route] : undefined;
        if (!route || !profile) {
          setPhase("editing");
          return;
        }
        setPhase("running");
        void removeProviderRoute({ cwd, env, route }).then(
          async ({ path, removed }) => {
            if (!removed) {
              appendEntry(
                "warning",
                `Provider route "${route}" was not configured.`,
              );
            } else {
              let credentialRemoved = false;
              if (profile.auth.type === "bearer") {
                credentialRemoved = await removeApiKey({
                  provider: route,
                  env,
                }).catch(() => false);
              }
              const nextProviders = { ...providerProfiles };
              delete nextProviders[route];
              setProviderProfiles(nextProviders);
              setModelChoices([
                ...providerModelChoices(nextProviders),
                ...MODEL_CHOICES,
              ]);
              setLoggedOutProviderRoutes((current) => {
                const next = new Set(current);
                next.delete(route);
                return next;
              });
              appendEntry(
                "system",
                `Removed provider "${route}" and its model configuration from ${path}.${credentialRemoved ? " Removed its stored credential." : ""}`,
              );
            }
            setSelectedProviderRoute(undefined);
            setPhase("editing");
          },
          (error: unknown) => {
            appendEntry(
              "error",
              `Could not remove provider: ${error instanceof Error ? error.message : "unknown error"}`,
            );
            setPhase("provider-actions");
          },
        );
        return;
      }
      return;
    }
    if (phase === "logout-providers") {
      if (key.escape) {
        setPhase("editing");
        return;
      }
      if (key.upArrow || key.downArrow) {
        setSelectedIndex((current) => {
          const delta = key.upArrow ? -1 : 1;
          return (
            (current + delta + logoutChoices.length) % logoutChoices.length
          );
        });
        return;
      }
      if (key.return) {
        const selected = logoutChoices[selectedIndex];
        if (!selected) return;
        setPhase("running");
        if (selected.kind === "subscription") {
          const controller = new AbortController();
          activeController.current = controller;
          void executeLogout({
            env,
            cwd,
            stdout,
            stderr,
            onOutput: handleCodexOutput,
            signal: controller.signal,
            isTTY: true,
          })
            .then((code) => {
              if (code !== 0) {
                appendEntry("error", "ChatGPT subscription logout failed.");
              }
            })
            .catch((error: unknown) =>
              appendEntry(
                "error",
                `Could not log out: ${error instanceof Error ? error.message : "unknown error"}`,
              ),
            )
            .finally(() => {
              activeController.current = undefined;
              setPhase("editing");
            });
          return;
        }
        logoutApiProvider(selected);
        return;
      }
      return;
    }
    if (phase === "delete-models") {
      if (key.escape) {
        setModelQuery("");
        setModelChoices(baseModelChoices);
        setSelectedIndex(0);
        setPhase(deleteModelReturnPhase);
        return;
      }
      if (key.upArrow || key.downArrow) {
        setSelectedIndex((current) => {
          if (visibleModelChoices.length === 0) return 0;
          const delta = key.upArrow ? -1 : 1;
          return (
            (current + delta + visibleModelChoices.length) %
            visibleModelChoices.length
          );
        });
        return;
      }
      if (key.return) {
        const selected = visibleModelChoices[selectedModelIndex];
        if (!selected) return;
        if (
          activeOptions.provider === selected.selection.provider &&
          activeOptions.model === selected.selection.id
        ) {
          appendEntry(
            "warning",
            `Choose another model before deleting ${selected.selection.provider}/${selected.selection.id}.`,
          );
          setModelChoices(baseModelChoices);
          setSelectedIndex(0);
          setPhase(deleteModelReturnPhase);
          return;
        }
        setPendingModelDeletion(selected);
        setPhase("delete-model-confirm");
        return;
      }
      if (key.backspace || key.delete) {
        setModelQuery((current) => Array.from(current).slice(0, -1).join(""));
        setSelectedIndex(0);
        return;
      }
      if (!key.ctrl && !key.meta && input !== "") {
        setModelQuery((current) => current + input);
        setSelectedIndex(0);
      }
      return;
    }
    if (phase === "delete-model-confirm") {
      if (key.escape || input.toLocaleLowerCase() === "n") {
        setPendingModelDeletion(undefined);
        setPhase("delete-models");
        return;
      }
      if (input.toLocaleLowerCase() === "y") {
        const selected = pendingModelDeletion;
        if (!selected) {
          setModelChoices(baseModelChoices);
          setPhase(deleteModelReturnPhase);
          return;
        }
        setPhase("running");
        void removeProviderModel({
          cwd,
          env,
          route: selected.selection.provider,
          model: selected.selection.id,
        }).then(
          ({ path, removed }) => {
            if (!removed) {
              appendEntry(
                "warning",
                `Model ${selected.selection.provider}/${selected.selection.id} was not configured.`,
              );
              setModelChoices(baseModelChoices);
            } else {
              const profile = providerProfiles[selected.selection.provider];
              const nextProviders = { ...providerProfiles };
              if (profile) {
                nextProviders[selected.selection.provider] = {
                  ...profile,
                  models: (profile.models ?? []).filter(
                    ({ id }) => id !== selected.selection.id,
                  ),
                };
              }
              setProviderProfiles(nextProviders);
              setModelChoices([
                ...providerModelChoices(nextProviders),
                ...MODEL_CHOICES,
              ]);
              appendEntry(
                "system",
                `Deleted model configuration ${selected.selection.provider}/${selected.selection.id} from ${path}.`,
              );
            }
            setPendingModelDeletion(undefined);
            setModelQuery("");
            setSelectedIndex(0);
            setPhase(deleteModelReturnPhase);
          },
          (error: unknown) => {
            appendEntry(
              "error",
              `Could not delete model configuration: ${error instanceof Error ? error.message : "unknown error"}`,
            );
            setPendingModelDeletion(undefined);
            setModelChoices(baseModelChoices);
            setSelectedIndex(0);
            setPhase(deleteModelReturnPhase);
          },
        );
        return;
      }
      return;
    }
    if (phase === "effort") {
      if (key.escape) {
        setPhase("editing");
        return;
      }
      if (key.upArrow || key.downArrow || key.leftArrow || key.rightArrow) {
        setSelectedIndex((current) => {
          if (effortChoices.length === 0) return 0;
          const delta = key.upArrow || key.leftArrow ? -1 : 1;
          return (
            (current + delta + effortChoices.length) % effortChoices.length
          );
        });
        return;
      }
      if (key.return) {
        const selected =
          effortChoices[Math.min(selectedIndex, effortChoices.length - 1)];
        if (selected) selectEffort(selected.effort);
        return;
      }
      return;
    }
    if (phase === "models") {
      if (key.escape) {
        setModelQuery("");
        setPhase("editing");
        return;
      }
      if (key.upArrow || key.downArrow) {
        setSelectedIndex((current) => {
          if (visibleModelChoices.length === 0) return 0;
          const delta = key.upArrow ? -1 : 1;
          return (
            (current + delta + visibleModelChoices.length) %
            visibleModelChoices.length
          );
        });
        return;
      }
      if (key.return) {
        const selected = visibleModelChoices[selectedModelIndex];
        if (!selected) return;
        const currentEffort = asPersistedReasoningEffort(
          activeOptions.reasoningEffort ?? "",
        );
        const reasoningEffort =
          currentEffort &&
          selected.supportedReasoningEfforts.some(
            ({ effort }) => effort === currentEffort,
          )
            ? currentEffort
            : selected.defaultReasoningEffort;
        const thinking =
          selected.selection.provider === "deepseek"
            ? reasoningEffort === "none"
              ? "disabled"
              : "enabled"
            : undefined;
        const nextOptions: AskOptions = {
          ...activeOptions,
          engine: selected.selection.engine,
          provider: selected.selection.provider,
          model: selected.selection.id,
          reasoningEffort,
          ...(thinking ? { thinking } : {}),
        };
        const selection: PersistedModelSelection = {
          ...selected.selection,
          reasoningEffort,
          ...(thinking ? { thinking } : {}),
        };
        setActiveOptions(nextOptions);
        sessionPersistence?.selectModel?.(
          selected.selection.provider,
          selected.selection.id,
          providerProfiles[selected.selection.provider]?.models?.find(
            (model) => model.id === selected.selection.id,
          )?.contextWindow,
        );
        setPhase("editing");
        void persistModelSelection({
          cwd,
          env,
          selection,
        }).then(
          (configPath) =>
            appendEntry(
              "system",
              `Selected ${selected.label}. Saved to ${configPath}.`,
            ),
          (error: unknown) =>
            appendEntry(
              "error",
              `Could not persist model selection: ${error instanceof Error ? error.message : "unknown error"}`,
            ),
        );
        return;
      }
      if (key.backspace || key.delete) {
        setModelQuery((current) => Array.from(current).slice(0, -1).join(""));
        setSelectedIndex(0);
        return;
      }
      if (!key.ctrl && !key.meta && input !== "") {
        setModelQuery((current) => current + input);
        setSelectedIndex(0);
      }
      return;
    }
    if (phase === "running") return;

    if (key.shift && key.tab) {
      if (
        activeOptions.engine === "codex" &&
        !modelChoiceFor(modelChoices, activeOptions)
      ) {
        void discoverSubscriptionModels({
          env,
          cwd,
          stdout,
          stderr,
          signal: new AbortController().signal,
          isTTY: true,
        }).then(
          (models) => {
            const subscriptionChoices = subscriptionModelChoices(models);
            setModelChoices([...subscriptionChoices, ...baseModelChoices]);
            if (modelChoiceFor(subscriptionChoices, activeOptions)) {
              cycleEffort(subscriptionChoices);
            } else {
              appendEntry(
                "warning",
                `Could not find effort metadata for ${activeOptions.model}.`,
              );
            }
          },
          (error: unknown) =>
            appendEntry(
              "warning",
              `Could not discover supported effort levels: ${error instanceof Error ? error.message : "unknown error"}`,
            ),
        );
      } else {
        cycleEffort(modelChoices);
      }
      return;
    }

    const submission = classifySubmissionKey(input, key);
    if (submission === "newline") {
      updateEditor((current) => insertEditorText(current, "\n"));
      return;
    }

    if (key.escape && completionKind) {
      setDismissedCompletion(completionSignature);
      return;
    }
    if (completionKind && (key.upArrow || key.downArrow)) {
      setSelectedIndex((current) => {
        if (visibleCandidates.length === 0) return 0;
        const delta = key.upArrow ? -1 : 1;
        return (
          (current + delta + visibleCandidates.length) %
          visibleCandidates.length
        );
      });
      return;
    }
    if (
      completionKind &&
      (key.return || key.tab) &&
      visibleCandidates.length > 0
    ) {
      const safeIndex = Math.min(selectedIndex, visibleCandidates.length - 1);
      if (completionKind === "file" && mentionQuery) {
        const filePath = fileCandidates[safeIndex];
        if (filePath) {
          updateEditor((current) =>
            insertFileMention(current, mentionQuery, filePath),
          );
        }
      } else {
        const command = visibleCandidates[safeIndex] as
          | SlashCommand
          | undefined;
        if (command) {
          if (key.return) executeCommand(command.name);
          else setEditor(createEditorState(`${command.name} `));
        }
      }
      return;
    }
    if (submission === "submit") {
      submitPrompt();
      return;
    }
    if (key.leftArrow) {
      updateEditor((current) =>
        moveEditorCursor(current, previousCursor(current)),
      );
      return;
    }
    if (key.rightArrow) {
      updateEditor((current) => moveEditorCursor(current, nextCursor(current)));
      return;
    }
    if (key.home) {
      updateEditor((current) =>
        moveEditorCursor(
          current,
          current.value.lastIndexOf("\n", current.cursor - 1) + 1,
        ),
      );
      return;
    }
    if (key.end) {
      updateEditor((current) => {
        const lineEnd = current.value.indexOf("\n", current.cursor);
        return moveEditorCursor(
          current,
          lineEnd < 0 ? current.value.length : lineEnd,
        );
      });
      return;
    }
    if (key.backspace) {
      updateEditor((current) => {
        if (
          current.cursor === 0 &&
          current.value === "" &&
          current.images.length > 0
        ) {
          return { ...current, images: current.images.slice(0, -1) };
        }
        return deleteEditorRange(
          current,
          previousCursor(current),
          current.cursor,
        );
      });
      return;
    }
    if (key.delete) {
      updateEditor((current) =>
        deleteEditorRange(current, current.cursor, nextCursor(current)),
      );
      return;
    }
    if (!key.ctrl && !key.meta && input !== "") {
      idleExitArmed.current = false;
      updateEditor((current) => insertEditorText(current, input));
    }
  });

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

      {transcript.length > 0 ? (
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

      {contextPanel ? <ContextPanel status={contextPanel} /> : null}

      {phase === "plugins" ? <PluginsPanel resources={resources} /> : null}

      {phase === "resources" ? <ResourcesPanel resources={resources} /> : null}

      {phase === "permissions" ? (
        <PermissionsPanel
          profile={activeOptions.permissionProfile ?? "safe"}
          provenance={permissionProfileSource}
          grants={approvalStore.list()}
          selectedIndex={selectedIndex}
          revision={permissionRevision}
        />
      ) : null}

      {phase === "plugin-trust" && pluginTrustIntent ? (
        <PluginTrustPanel
          cwd={cwd}
          intent={pluginTrustIntent}
          resources={resources}
        />
      ) : null}

      {(phase === "approving" || phase === "approval-feedback") && approval ? (
        <Box
          borderStyle="round"
          borderColor="yellow"
          flexDirection="column"
          paddingX={1}
        >
          <Text bold color="yellow">
            Approval required
          </Text>
          {approval.command ? (
            <Box flexDirection="column" marginY={1}>
              <Text bold>
                <Text color="cyan">$ </Text>
                {approval.command.command}
              </Text>
              <Text>
                <Text dimColor>Working directory</Text>
                {"  "}
                {approval.command.cwd}
              </Text>
              <Text>
                <Text dimColor>Timeout</Text>
                {"            "}
                {formatDuration(approval.command.timeoutMs)}
              </Text>
            </Box>
          ) : null}
          {approval.network ? (
            <Box flexDirection="column" marginY={1}>
              <Text bold>
                <Text color="cyan">Network </Text>
                {approval.network.tool}
              </Text>
              <Text>
                <Text dimColor>{approval.network.label}</Text>
                {"  "}
                {approval.network.value}
              </Text>
            </Box>
          ) : null}
          {approval.subagent ? (
            <Box flexDirection="column" marginY={1}>
              <Text bold>
                <Text color="cyan">Subagent </Text>
                {approval.subagent.tool}
              </Text>
              <Text>
                <Text dimColor>Task</Text>
                {"  "}
                {approval.subagent.task}
              </Text>
            </Box>
          ) : null}
          {phase === "approval-feedback" ? (
            <>
              <Text color="red">Deny with optional guidance</Text>
              <Text>{approvalFeedback || "_"}</Text>
              <Text dimColor>Enter deny · Esc deny without feedback</Text>
            </>
          ) : (
            <Text>{approval.prompt}</Text>
          )}
          {phase === "approving" ? (
            <Text>
              <Text bold color="green">
                1
              </Text>{" "}
              allow once
              {approval.allowSession ? (
                <>
                  {" · "}
                  <Text bold color="green">
                    2
                  </Text>{" "}
                  allow displayed session scope
                </>
              ) : null}
              {" · "}
              <Text bold color="red">
                3
              </Text>{" "}
              deny
            </Text>
          ) : null}
        </Box>
      ) : null}

      {updateState?.state === "available" &&
      updateState.latestVersion &&
      !updateState.dismissed ? (
        <UpdateBanner state={updateState} terminalWidth={terminalWidth} />
      ) : null}

      {phase === "resuming" ? (
        <Box
          borderStyle="round"
          borderColor="cyan"
          flexDirection="column"
          paddingX={1}
        >
          <Text bold color="cyan">
            Resume saved session
          </Text>
          {sessions.length === 0 ? (
            <Text dimColor>Loading sessions…</Text>
          ) : null}
          {sessions.map((session, index) => (
            <Text
              key={session.id}
              bold={index === selectedIndex}
              {...(index === selectedIndex ? { color: "cyan" as const } : {})}
            >
              {index === selectedIndex ? "› " : "  "}
              {session.title} · {session.updatedAt} · {session.id.slice(0, 8)}
            </Text>
          ))}
          <Text dimColor>Enter resume · Esc cancel</Text>
        </Box>
      ) : null}

      {phase === "models" ? (
        <Box
          borderStyle="round"
          borderColor="cyan"
          flexDirection="column"
          paddingX={1}
        >
          <Text bold color="cyan">
            Choose model
          </Text>
          <Text>
            Search models: <Text color="cyan">{modelQuery || "_"}</Text>
          </Text>
          {modelsLoading ? (
            <Text dimColor>Discovering ChatGPT subscription models…</Text>
          ) : null}
          {modelQuery.trim() !== "" ? (
            <Text dimColor>
              Showing {visibleModelChoices.length} of {modelChoices.length}{" "}
              matches
            </Text>
          ) : null}
          {visibleModelChoices.length === 0 ? (
            <Text dimColor>No matching models.</Text>
          ) : null}
          {visibleModelChoices.map((choice, index) => (
            <Text
              key={modelChoiceKey(choice)}
              bold={index === selectedModelIndex}
              {...(index === selectedModelIndex
                ? { color: "cyan" as const }
                : {})}
            >
              {index === selectedModelIndex ? "› " : "  "}
              {choice.label} · {choice.description}
            </Text>
          ))}
          <Text dimColor>
            ChatGPT entries use Codex Engine; OpenAI API-key entries are billed
            separately · Type to fuzzy search · Enter select · Esc cancel
          </Text>
        </Box>
      ) : null}

      {phase === "delete-models" ? (
        <Box
          borderStyle="round"
          borderColor="red"
          flexDirection="column"
          paddingX={1}
        >
          <Text bold color="red">
            Delete configured provider model
          </Text>
          <Text>
            Search models: <Text color="cyan">{modelQuery || "_"}</Text>
          </Text>
          {visibleModelChoices.length === 0 ? (
            <Text dimColor>No matching configured models.</Text>
          ) : null}
          {visibleModelChoices.map((choice, index) => (
            <Text
              key={modelChoiceKey(choice)}
              bold={index === selectedModelIndex}
              {...(index === selectedModelIndex
                ? { color: "red" as const }
                : {})}
            >
              {index === selectedModelIndex ? "› " : "  "}
              {choice.label} · {choice.description}
            </Text>
          ))}
          <Text dimColor>
            Type to fuzzy search · Enter review deletion · Esc cancel
          </Text>
        </Box>
      ) : null}

      {phase === "delete-model-confirm" && pendingModelDeletion ? (
        <Box
          borderStyle="round"
          borderColor="red"
          flexDirection="column"
          paddingX={1}
        >
          <Text bold color="red">
            Delete model configuration?
          </Text>
          <Text>
            {pendingModelDeletion.selection.provider}/
            {pendingModelDeletion.selection.id}
          </Text>
          <Text dimColor>
            The provider route and stored credential will remain.
          </Text>
          <Text>
            <Text bold color="red">
              y
            </Text>{" "}
            delete · <Text bold>n</Text> cancel
          </Text>
        </Box>
      ) : null}

      {phase === "effort" ? (
        <Box
          borderStyle="round"
          borderColor="cyan"
          flexDirection="column"
          paddingX={1}
        >
          <Text bold color="cyan">
            Choose thinking effort
          </Text>
          <Text dimColor>{activeOptions.model ?? "Current model"}</Text>
          {effortChoices.length === 0 ? (
            <Text dimColor>Discovering supported effort levels…</Text>
          ) : null}
          {effortChoices.map((choice, index) => (
            <Text
              key={choice.effort}
              bold={index === selectedIndex}
              {...(index === selectedIndex ? { color: "cyan" as const } : {})}
            >
              {index === selectedIndex ? "› " : "  "}
              {choice.effort} · {choice.description}
              {choice.effort === activeOptions.reasoningEffort
                ? " · current"
                : ""}
            </Text>
          ))}
          <Text dimColor>
            ↑/↓ or ←/→ adjust · Enter select · Esc cancel · /effort
            &lt;level&gt; also works
          </Text>
        </Box>
      ) : null}

      {phase === "login-providers" ? (
        <Box
          borderStyle="round"
          borderColor="cyan"
          flexDirection="column"
          paddingX={1}
        >
          <Text bold color="cyan">
            Choose model provider
          </Text>
          {loginChoices.map((choice, index) => (
            <Box
              key={`${choice.kind}:${choice.route ?? choice.provider ?? choice.label}`}
              flexDirection="column"
            >
              <Text
                bold={index === selectedIndex}
                {...(index === selectedIndex ? { color: "cyan" as const } : {})}
              >
                {index === selectedIndex ? "› " : "  "}
                {choice.label} · {choice.description}
              </Text>
              {choice.details ? (
                <Text
                  dimColor
                  {...(index === selectedIndex
                    ? { color: "cyan" as const }
                    : {})}
                >
                  {"    "}
                  {choice.details}
                </Text>
              ) : null}
            </Box>
          ))}
          <Text dimColor>Enter continue · Esc cancel</Text>
        </Box>
      ) : null}

      {phase === "provider-actions" &&
      selectedProviderRoute &&
      selectedProviderProfile &&
      selectedProviderState ? (
        <Box
          borderStyle="round"
          borderColor="cyan"
          flexDirection="column"
          paddingX={1}
        >
          <Text bold color="cyan">
            Manage provider · {selectedProviderRoute}
          </Text>
          <Text>
            {selectedProviderState.label} ·{" "}
            {selectedProviderProfile.models?.length ?? 0} models
          </Text>
          <Text dimColor>{selectedProviderProfile.baseUrl}</Text>
          <Text dimColor>
            {providerCapabilitySummary(selectedProviderProfile)}
          </Text>
          {providerActionChoices.map((action, index) => (
            <Text
              key={action.kind}
              bold={index === selectedIndex}
              {...(index === selectedIndex ? { color: "cyan" as const } : {})}
            >
              {index === selectedIndex ? "› " : "  "}
              {action.label} · {action.description}
            </Text>
          ))}
          <Text dimColor>Enter continue · Esc back</Text>
        </Box>
      ) : null}

      {phase === "provider-remove-confirm" &&
      selectedProviderRoute &&
      selectedProviderProfile ? (
        <Box
          borderStyle="round"
          borderColor="red"
          flexDirection="column"
          paddingX={1}
        >
          <Text bold color="red">
            Remove provider "{selectedProviderRoute}"?
          </Text>
          <Text>{selectedProviderProfile.baseUrl}</Text>
          <Text dimColor>
            This deletes the route, all configured models, and its stored
            credential. Environment variables cannot be removed by Forge.
          </Text>
          <Text>
            <Text bold color="red">
              y
            </Text>{" "}
            remove · <Text bold>n</Text> cancel
          </Text>
        </Box>
      ) : null}

      {phase === "logout-providers" ? (
        <Box
          borderStyle="round"
          borderColor="cyan"
          flexDirection="column"
          paddingX={1}
        >
          <Text bold color="cyan">
            Log out provider
          </Text>
          {logoutChoices.map((choice, index) => (
            <Text
              key={`${choice.kind}:${choice.provider}`}
              bold={index === selectedIndex}
              {...(index === selectedIndex ? { color: "cyan" as const } : {})}
            >
              {index === selectedIndex ? "› " : "  "}
              {choice.label} · {choice.description}
            </Text>
          ))}
          <Text dimColor>
            Removes stored credentials only · environment variables remain ·
            Enter log out · Esc cancel
          </Text>
        </Box>
      ) : null}

      {loginPrompt ? <SignInPanel prompt={loginPrompt} env={env} /> : null}

      {phase === "login-key" && loginChoice?.provider ? (
        <Box
          borderStyle="round"
          borderColor="cyan"
          flexDirection="column"
          paddingX={1}
        >
          <Text bold color="cyan">
            Enter {loginChoice.label} key
          </Text>
          <Text>
            API key:{" "}
            <Text color="cyan">
              {loginKey ? "•".repeat(Array.from(loginKey).length) : "_"}
            </Text>
          </Text>
          <Text dimColor>
            Saved under $FORGE_HOME/auth.json with owner-only permissions. The
            key is never shown in the transcript.
          </Text>
          <Text dimColor>Enter save · Esc back</Text>
        </Box>
      ) : null}

      {phase === "provider-setup" ? (
        <ProviderSetup
          existingProviders={providerProfiles}
          {...(providerSetupRoute ? { initialRoute: providerSetupRoute } : {})}
          discover={discoverProviderModels}
          hasExistingCredential={(route, profile) =>
            profile.auth.type === "none" ||
            new AuthenticationManager(env).status(route, {
              endpoint: profile.baseUrl,
              ...(profile.auth.type === "bearer" && profile.auth.apiKeyEnv
                ? { environmentVariable: profile.auth.apiKeyEnv }
                : {}),
            }).authenticated
          }
          discoverExisting={async ({ route, profile, signal }) => {
            const apiKey =
              profile.auth.type === "bearer"
                ? new AuthenticationManager(env).requireApiKey(route, {
                    endpoint: profile.baseUrl,
                    ...(profile.auth.apiKeyEnv
                      ? { environmentVariable: profile.auth.apiKeyEnv }
                      : {}),
                  }).apiKey
                : undefined;
            return discoverProviderModels({
              api: profile.api,
              baseUrl: profile.baseUrl,
              ...(apiKey === undefined ? {} : { apiKey }),
              signal,
            });
          }}
          onCancel={() => {
            setProviderSetupRoute(undefined);
            setPhase("editing");
          }}
          onComplete={(result) => {
            setPhase("running");
            void completeProviderSetup(result);
          }}
        />
      ) : null}

      {phase !== "login-providers" &&
      phase !== "login-key" &&
      phase !== "provider-setup" ? (
        <Box
          borderStyle="round"
          borderColor={phase === "editing" ? "green" : "gray"}
          paddingX={1}
          flexDirection="column"
          marginTop={1}
        >
          {editor.images.length > 0 ? (
            <Text color="cyan">
              {editor.images
                .map(
                  ({ filename }, index) => `[Image #${index + 1}] ${filename}`,
                )
                .join("  ")}
            </Text>
          ) : null}
          <Box>
            <Text color="green">❯ </Text>
            <PromptWithCursor state={editor} active={phase === "editing"} />
          </Box>
        </Box>
      ) : null}

      {phase === "editing" && completionKind && visibleCandidates.length > 0 ? (
        <Box
          borderStyle="single"
          borderColor="gray"
          flexDirection="column"
          paddingX={1}
        >
          {visibleCandidates.map((candidate, index) => {
            const label =
              typeof candidate === "string" ? candidate : candidate.name;
            const description =
              typeof candidate === "string" ? "" : candidate.description;
            return (
              <Text
                key={label}
                bold={index === selectedIndex}
                {...(index === selectedIndex ? { color: "cyan" as const } : {})}
              >
                {index === selectedIndex ? "› " : "  "}
                {label}
                {description ? `  ${description}` : ""}
              </Text>
            );
          })}
          {completionKind === "file" && fileCandidates.length > 10 ? (
            <Text dimColor> More matches—keep typing to narrow the list</Text>
          ) : null}
        </Box>
      ) : null}

      {contextOfferVisible ? (
        <Box paddingX={1}>
          <Text color="yellow">
            Context is nearing its limit · <Text bold>c</Text> compact once ·{" "}
            <Text bold>a</Text> auto for session · <Text bold>d</Text> dismiss
          </Text>
        </Box>
      ) : null}

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

const FORGE_WORDMARK = [
  " _____ ___  ____   ____ _____ ",
  "|  ___/ _ \\|  _ \\ / ___| ____|",
  "| |_ | | | | |_) | |  _|  _|  ",
  "|  _|| |_| |  _ <| |_| | |___ ",
  "|_|   \\___/|_| \\_\\\\____|_____|",
].join("\n");

function PluginsPanel({
  resources,
}: {
  readonly resources: DetectedStartupResources;
}): React.JSX.Element {
  const projectPlugins = resources.plugins.filter(
    ({ scope }) => scope === "project",
  );
  const userPlugins = resources.plugins.filter(({ scope }) => scope === "user");
  const projectTrusted = projectPlugins.some(
    ({ state }) => state === "trusted",
  );
  return (
    <Box
      borderStyle="round"
      borderColor="cyan"
      flexDirection="column"
      paddingX={1}
      marginTop={1}
    >
      <Text bold color="cyan">
        Plugins
      </Text>
      {projectPlugins.length === 0 ? (
        <Text dimColor>No project plugins were discovered.</Text>
      ) : (
        projectPlugins.map((plugin) => (
          <Box key={plugin.name} flexDirection="column" marginTop={1}>
            <Text>
              <Text bold>{plugin.name}</Text>
              {` @ ${plugin.version} · ${plugin.state}`}
            </Text>
            <Text dimColor>
              Capabilities: {plugin.capabilities.join(", ") || "none"}
            </Text>
          </Box>
        ))
      )}
      {userPlugins.map((plugin) => (
        <Text key={plugin.name} dimColor>
          {plugin.name} @ {plugin.version} · user · {plugin.state}
        </Text>
      ))}
      {projectPlugins.length > 0 ? (
        <Text>
          {projectTrusted ? (
            <>
              <Text bold color="red">
                u
              </Text>{" "}
              revoke project trust
            </>
          ) : (
            <>
              <Text bold color="green">
                t
              </Text>{" "}
              review and trust project plugins
            </>
          )}
          <Text dimColor> · Esc close</Text>
        </Text>
      ) : (
        <Text dimColor>Esc close</Text>
      )}
      <Text dimColor>Skills are listed separately in /resources.</Text>
    </Box>
  );
}

function ResourcesPanel({
  resources,
}: {
  readonly resources: DetectedStartupResources;
}): React.JSX.Element {
  const diagnostics = resources.diagnostics ?? [];
  return (
    <Box
      borderStyle="round"
      borderColor="cyan"
      flexDirection="column"
      paddingX={1}
      marginTop={1}
    >
      <Text bold color="cyan">
        Resources
      </Text>
      <Box flexDirection="column" marginTop={1}>
        <Text bold color="gray">
          Skills
        </Text>
        {resources.skills.length === 0 ? (
          <Text dimColor>No Skills were discovered.</Text>
        ) : (
          resources.skills.map((skill) => (
            <Box
              key={`${skill.source}:${skill.path}`}
              flexDirection="column"
              marginTop={1}
              paddingLeft={1}
            >
              <Text>
                <Text bold>${skill.name}</Text>
                <Text dimColor>
                  {` · ${skill.source} · ${skill.status ?? skill.invocation}${skill.shadowedBy ? ` by ${skill.shadowedBy}` : ""}`}
                </Text>
              </Text>
              <Text dimColor>{skill.description ?? "No description."}</Text>
            </Box>
          ))
        )}
      </Box>
      {diagnostics.length > 0 ? (
        <Box flexDirection="column" marginTop={1}>
          <Text bold color="yellow">
            Diagnostics
          </Text>
          {diagnostics.map((diagnostic) => (
            <Text key={diagnostic} color="yellow">
              {diagnostic}
            </Text>
          ))}
        </Box>
      ) : null}
      <Box
        borderStyle="single"
        borderColor="gray"
        flexDirection="column"
        marginTop={1}
        paddingX={1}
      >
        <Text bold color="cyan">
          Actions
        </Text>
        <Text color="green">forge resources disable|enable &lt;name&gt;</Text>
        <Text dimColor>
          Toggle automatic invocation for a user-scoped Skill.
        </Text>
        <Text dimColor>
          <Text color="yellow">Esc</Text> close
        </Text>
      </Box>
    </Box>
  );
}

function PluginTrustPanel({
  cwd,
  intent,
  resources,
}: {
  readonly cwd: string;
  readonly intent: "trust" | "untrust";
  readonly resources: DetectedStartupResources;
}): React.JSX.Element {
  const projectPlugins = resources.plugins.filter(
    ({ scope }) => scope === "project",
  );
  const trusting = intent === "trust";
  return (
    <Box
      borderStyle="round"
      borderColor={trusting ? "yellow" : "red"}
      flexDirection="column"
      paddingX={1}
      marginTop={1}
    >
      <Text bold color={trusting ? "yellow" : "red"}>
        {trusting ? "Trust project plugins?" : "Revoke project plugin trust?"}
      </Text>
      <Text dimColor>Workspace: {cwd}</Text>
      {projectPlugins.map((plugin) => (
        <Text key={plugin.name}>
          {plugin.name}@{plugin.version} · capabilities:{" "}
          {plugin.capabilities.join(", ") || "none"}
        </Text>
      ))}
      {trusting ? (
        <Text color="yellow">
          Warning: trusted plugins run in-process with the full local privileges
          of Forge. Trust applies to this entire workspace, including future
          plugin changes.
        </Text>
      ) : null}
      <Text>
        <Text bold color="green">
          y
        </Text>{" "}
        {trusting ? "trust" : "revoke"}{" "}
        <Text bold color="red">
          n
        </Text>{" "}
        cancel
      </Text>
    </Box>
  );
}

function ForgeHeader({
  resources,
}: {
  readonly resources: DetectedStartupResources;
}): React.JSX.Element {
  return (
    <Box
      borderStyle="round"
      borderColor="cyan"
      flexDirection="column"
      alignItems="flex-start"
      paddingX={2}
      paddingY={1}
    >
      <Box marginBottom={1}>
        <Text bold color="cyan">
          {FORGE_WORDMARK}
        </Text>
      </Box>
      {resources.plugins.length > 0 ? (
        <Text>
          <Text bold color="cyan">
            Plugins
          </Text>
          <Text dimColor>
            {"  "}
            {resources.plugins.map(formatDetectedPlugin).join(" · ")}
          </Text>
        </Text>
      ) : null}
      {resources.skills.length > 0 ? (
        <Text>
          <Text bold color="cyan">
            Skills
          </Text>
          <Text dimColor>
            {"   "}
            {resources.skills
              .filter(({ status }) => status !== "shadowed")
              .map(
                ({ name, source, status, invocation }) =>
                  `$${name} (${source}, ${status ?? invocation})`,
              )
              .join(" · ")}
          </Text>
        </Text>
      ) : null}
      {resources.plugins.length > 0 || resources.skills.length > 0 ? (
        <Box marginTop={1} />
      ) : null}
      <Text>
        <Text bold color="cyan">
          /login
        </Text>
        <Text dimColor> provider · </Text>
        <Text bold color="cyan">
          /plugins
        </Text>
        <Text dimColor> trust · </Text>
        <Text bold color="cyan">
          /resources
        </Text>
        <Text dimColor> skills · </Text>
        <Text bold color="cyan">
          @
        </Text>
        <Text dimColor> files</Text>
      </Text>
    </Box>
  );
}

function formatDetectedPlugin(
  plugin: DetectedStartupResources["plugins"][number],
): string {
  const state =
    plugin.state === "untrusted" ? "untrusted, skipped" : plugin.state;
  return `${plugin.name} (${plugin.scope}, ${state})`;
}

function conversationTranscript(
  messages: readonly ModelConversationMessage[],
  reasoning: readonly SessionReasoning[] = [],
  historyEvents?: readonly RunEvent[],
): readonly TranscriptEntry[] {
  if (historyEvents && historyEvents.length > 0) {
    return runEventTranscript(historyEvents);
  }
  const reasoningByMessage = new Map(
    reasoning.map((entry) => [entry.assistantMessageIndex, entry.content]),
  );
  const transcript: TranscriptEntry[] = [];
  for (const [messageIndex, message] of messages.entries()) {
    const savedReasoning = reasoningByMessage.get(messageIndex);
    if (message.role === "assistant" && savedReasoning) {
      transcript.push({
        id: transcript.length,
        kind: "reasoning",
        text: savedReasoning,
      });
    }
    if (message.role === "tool") {
      transcript.push({
        id: transcript.length,
        kind: "tool",
        text: `[historical tool result · ${message.toolName} · ${message.isError ? "failed" : "completed"}] ${canonicalText(message)}`,
      });
      continue;
    }
    const text = canonicalText(message);
    if (text)
      transcript.push({
        id: transcript.length,
        kind: message.role === "user" ? "user" : "answer",
        text,
      });
    if (message.role === "assistant" && typeof message.content !== "string") {
      for (const part of message.content) {
        if (part.type === "tool-call") {
          transcript.push({
            id: transcript.length,
            kind: "tool",
            text: `[historical tool call · ${part.name} · ${part.id}]`,
          });
        }
      }
    }
  }
  return transcript;
}

function runEventTranscript(
  events: readonly RunEvent[],
): readonly TranscriptEntry[] {
  let transcript: readonly TranscriptEntry[] = [];
  const append = (kind: TranscriptKind, text: string, merge = false): void => {
    transcript = appendTranscriptEntry(
      transcript,
      { id: transcript.length, kind, text },
      merge,
    );
  };

  for (const event of events) {
    switch (event.type) {
      case "run.started":
        append(
          "user",
          [
            event.prompt,
            ...(event.imageCount
              ? Array.from(
                  { length: event.imageCount },
                  (_, index) => `[Image #${index + 1}]`,
                )
              : []),
          ].join("\n"),
        );
        break;
      case "model.reasoning":
        append("reasoning", event.text, true);
        break;
      case "model.reasoning-unavailable":
        append(
          "reasoning",
          `Provider used ${event.reasoningTokens} reasoning tokens but did not return reasoning text.`,
        );
        break;
      case "model.text":
        append("answer", event.text, true);
        break;
      case "model.warning":
      case "context.warning":
        append("warning", event.message);
        break;
      case "context.auto-paused":
        append("warning", event.message);
        break;
      case "tool.proposed":
        append("tool", `○ Proposed ${event.call.name}`);
        break;
      case "tool.decision":
        append(
          "tool",
          `◇ ${event.decision.kind.toUpperCase()} ${event.call.name} — ${event.decision.reason}`,
        );
        break;
      case "tool.completed":
        append("tool", `✓ Completed ${event.call.name}`);
        break;
      case "tool.failed":
        append(
          "error",
          `✗ Failed ${event.call.name}${event.result.ok ? "" : ` — ${event.result.error.message}`}`,
        );
        break;
      case "docs.search":
        append(
          "tool",
          `Docs · ${event.resultCount} result(s) · ${event.locale}${event.fallback ? " · English fallback" : ""}`,
        );
        break;
      case "docs.read":
        append("tool", `Docs · ${event.reference}`);
        break;
      case "docs.rejected":
        append("warning", `Docs · ${event.message}`);
        break;
      case "run.completed":
        append("system", "Completed");
        break;
      case "run.failed":
      case "run.denied":
      case "run.limit_reached":
      case "run.cancelled":
        if (event.message) append("error", event.message);
        break;
      default:
        break;
    }
  }
  return transcript;
}

function formatDuration(milliseconds: number): string {
  return milliseconds % 1000 === 0
    ? `${milliseconds / 1000}s`
    : `${milliseconds}ms`;
}

function formatModelStatus(options: AskOptions): string {
  const model = options.model?.trim() || "default";
  const effort =
    options.reasoningEffort?.trim() || options.thinking?.trim() || "default";
  return `${model} · thinking effort: ${effort}`;
}

function formatCompactModelStatus(options: AskOptions): string {
  const model = options.model?.trim() || "default";
  const effort =
    options.reasoningEffort?.trim() || options.thinking?.trim() || "default";
  return `${model} · ${effort}`;
}

function toolRunActivity(
  call: Pick<ToolCall, "name" | "input">,
  stage: "preparing" | "executing",
): RunActivity {
  const target = toolActivityTarget(call);
  return {
    kind: "tool",
    stage,
    toolName: call.name,
    ...(target ? { target } : {}),
  };
}

function toolActivityTarget(
  call: Pick<ToolCall, "name" | "input">,
): string | undefined {
  if (!isRecord(call.input)) return undefined;
  const path = stringInputField(call.input, "path");
  if (
    (call.name === "apply_patch" ||
      call.name === "create_file" ||
      call.name === "read_file") &&
    path
  ) {
    return path;
  }
  if (call.name === "run_command") {
    const program = stringInputField(call.input, "program");
    const args = inputField(call.input, "args");
    if (program && Array.isArray(args)) {
      const commandArgs = args.filter(
        (argument): argument is string => typeof argument === "string",
      );
      return [program, ...commandArgs].join(" ");
    }
    return program;
  }
  return undefined;
}

function stringInputField(
  input: Record<string, unknown>,
  key: string,
): string | undefined {
  const value = inputField(input, key);
  return typeof value === "string" && value.trim() !== "" ? value : undefined;
}

function inputField(input: Record<string, unknown>, key: string): unknown {
  return input[key];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function formatRunActivity(activity: RunActivity | undefined): string {
  if (!activity) return "Working…";
  if (activity.kind === "thinking") {
    return activity.step ? `Thinking · step ${activity.step}…` : "Thinking…";
  }
  const target = activity.target ? ` · ${activity.target}` : "";
  if (activity.toolName === "apply_patch") {
    return `${activity.stage === "preparing" ? "Preparing file edit" : "Editing file"}${target}`;
  }
  if (activity.toolName === "create_file") {
    return `${activity.stage === "preparing" ? "Preparing file creation" : "Creating file"}${target}`;
  }
  return `${activity.stage === "preparing" ? "Preparing" : "Running"} ${activity.toolName}${target}`;
}

function PromptFooter({
  activeOptions,
  filesLoading,
  phase,
  runActivity,
  runActivityFrame,
  contextStatus,
  contextStateOverride,
  terminalWidth,
}: {
  readonly activeOptions: AskOptions;
  readonly filesLoading: boolean;
  readonly phase: Phase;
  readonly runActivity?: RunActivity;
  readonly runActivityFrame: number;
  readonly contextStatus?: ContextStatus;
  readonly contextStateOverride?: ContextStatus["pressure"]["state"];
  readonly terminalWidth: number;
}): React.JSX.Element {
  if (phase === "editing") {
    const pressureLabel = contextStatus
      ? formatContextIndicator(
          contextStatus,
          terminalWidth,
          contextStateOverride,
        )
      : undefined;
    return (
      <Box paddingX={1} flexDirection="column">
        <Box justifyContent="space-between">
          <Text color="blue">{formatCompactModelStatus(activeOptions)}</Text>
          {pressureLabel ? (
            <Text
              color={contextPressureColor(contextStatus?.pressure.ratio ?? 0)}
            >
              {pressureLabel}
            </Text>
          ) : null}
        </Box>
        <Text color="gray">
          {filesLoading ? "Indexing files · " : ""}
          <Text color="yellow">Shift+Tab</Text> effort ·{" "}
          <Text color="green">Enter</Text> submit ·{" "}
          <Text color="cyan">Shift+Enter/Meta+Enter/Ctrl+J</Text> newline ·{" "}
          <Text color="red">Ctrl+C</Text> cancel/exit
        </Text>
      </Box>
    );
  }

  if (phase === "running") {
    const activity = formatRunActivity(runActivity);
    const spinner =
      RUN_ACTIVITY_FRAMES[runActivityFrame % RUN_ACTIVITY_FRAMES.length] ??
      RUN_ACTIVITY_FRAMES[0];
    return (
      <Box paddingX={1}>
        <Box flexDirection="column">
          <Text color={runActivity?.kind === "tool" ? "green" : "cyan"}>
            {spinner} {activity}
            <Text dimColor> · Ctrl+C cancel</Text>
          </Text>
        </Box>
      </Box>
    );
  }

  const status =
    phase === "approving" || phase === "approval-feedback"
      ? "Waiting for approval"
      : phase === "models"
        ? "Choose a model"
        : phase === "delete-models"
          ? "Choose a configured model to delete"
          : phase === "delete-model-confirm"
            ? "Confirm model deletion"
            : phase === "effort"
              ? "Choose thinking effort"
              : phase === "plugins"
                ? "Review project plugins"
                : phase === "resources"
                  ? "Review Skills and diagnostics"
                  : phase === "permissions"
                    ? "Review session permissions"
                    : phase === "plugin-trust"
                      ? "Confirm project plugin trust"
                      : phase === "login-providers" || phase === "login-key"
                        ? "Configure a model provider"
                        : phase === "logout-providers"
                          ? "Choose a provider to log out"
                          : phase === "provider-actions"
                            ? "Manage provider"
                            : phase === "provider-remove-confirm"
                              ? "Confirm provider removal"
                              : phase === "provider-setup"
                                ? "Configure a provider model"
                                : "Choose a saved session";

  return (
    <Box flexDirection="column">
      <Text dimColor>{status}</Text>
    </Box>
  );
}

function PromptWithCursor({
  state,
  active,
}: {
  readonly state: EditorState;
  readonly active: boolean;
}): React.JSX.Element {
  if (!active)
    return <Text dimColor>{state.value || "Waiting for the agent…"}</Text>;
  const before = state.value.slice(0, state.cursor);
  const character = state.value.slice(state.cursor, nextCursor(state));
  const after = state.value.slice(state.cursor + character.length);
  return (
    <Text>
      {before}
      <Text inverse>{character || " "}</Text>
      {after}
    </Text>
  );
}

function ContextPanel({
  status,
}: {
  readonly status: ContextStatus;
}): React.JSX.Element {
  const inputBudget = status.pressure.availableInputTokens;
  const usageRatio = status.pressure.ratio;
  const usagePercent = Math.round(usageRatio * 100);
  const reclaimedTokens = Math.max(
    0,
    status.estimatedTranscriptTokens - status.projectedCompactedTokens,
  );
  const checkpoint = status.checkpoint;
  const checkpointLabel =
    checkpoint.status === "none"
      ? "not created"
      : checkpoint.status === "valid"
        ? `${checkpoint.strategy} ready · ${checkpoint.summarizedMessageCount} messages summarized`
        : `${checkpoint.strategy} stale · not used`;

  return (
    <Box
      borderStyle="round"
      borderColor="cyan"
      flexDirection="column"
      paddingX={1}
      marginTop={1}
      marginBottom={1}
    >
      <Text>
        <Text bold color="cyan">
          Context management
        </Text>
        <Text dimColor> · {contextModeLabel(status.pressure.mode)}</Text>
      </Text>

      <Box flexDirection="column" marginTop={1}>
        <Text>
          <Text bold color={contextUsageColor(usagePercent)}>
            {contextRing(usageRatio)} ~{usagePercent}% projected
          </Text>
          <Text dimColor>
            {" "}
            · ~{formatTokenCount(status.pressure.estimatedInputTokens)} of{" "}
            {formatTokenCount(inputBudget)} input tokens
          </Text>
        </Text>
        <Text color={contextUsageColor(usagePercent)}>
          {contextUsageBar(usageRatio)}
        </Text>
      </Box>

      <Box flexDirection="column" marginTop={1}>
        <Text bold color="gray">
          Pressure breakdown
        </Text>
        <Text>
          instructions{" "}
          {formatTokenCount(status.pressure.estimates.instructions)} · tools{" "}
          {formatTokenCount(status.pressure.estimates.toolSchemas)} · history{" "}
          {formatTokenCount(status.pressure.estimates.conversationHistory)} ·
          draft/images{" "}
          {formatTokenCount(status.pressure.estimates.currentRequest)}
        </Text>
        <Text dimColor>
          {status.pressure.confidence === "unavailable"
            ? "? incomplete projection"
            : status.pressure.confidence === "exact"
              ? "exact projection"
              : "~ estimated"}{" "}
          · activation {Math.round(status.activationThreshold * 100)}%
        </Text>
      </Box>

      <Box flexDirection="column" marginTop={1}>
        <Text>
          <Text bold color="gray">
            Model
          </Text>
          {"  "}
          {status.provider}/{status.modelId}
        </Text>
        <Text>
          <Text bold color="gray">
            Window
          </Text>{" "}
          {formatTokenCount(status.contextWindowTokens)} total ·{" "}
          {formatTokenCount(status.availableInputTokens)} input
        </Text>
        <Text>
          <Text bold color="gray">
            Reserve
          </Text>{" "}
          {formatTokenCount(status.reservedOutputTokens)} output +{" "}
          {formatTokenCount(status.bufferTokens)} safety →{" "}
          {formatTokenCount(status.effectiveReserveTokens)} effective
        </Text>
      </Box>

      <Box flexDirection="column" marginTop={1}>
        <Text bold color="gray">
          Conversation
        </Text>
        <Text>
          {status.canonicalMessageCount === 0
            ? "No messages yet."
            : `${status.canonicalMessageCount} canonical messages · ~${formatTokenCount(status.estimatedTranscriptTokens)} estimated`}
        </Text>
        {status.canonicalMessageCount > 0 ? (
          <>
            <Text>
              Active tail: {status.activeTailMessageCount} messages from index{" "}
              {status.activeTailStartIndex}
            </Text>
            <Text dimColor>
              /compact → ~{formatTokenCount(status.projectedCompactedTokens)}{" "}
              tokens
              {reclaimedTokens > 0
                ? ` · saves ~${formatTokenCount(reclaimedTokens)}`
                : " · no estimated savings"}
            </Text>
          </>
        ) : null}
      </Box>

      <Box flexDirection="column" marginTop={1}>
        <Text>
          <Text bold color={checkpoint.status === "stale" ? "yellow" : "gray"}>
            Checkpoint
          </Text>
          {"  "}
          {checkpointLabel}
        </Text>
        <Text dimColor>
          Canonical transcript is retained · checkpoint is untrusted memory
        </Text>
        {status.lastCompaction ? (
          <Text dimColor>
            Last compact:{" "}
            {formatTokenCount(status.lastCompaction.estimatedBeforeTokens)} →{" "}
            {formatTokenCount(status.lastCompaction.estimatedAfterTokens)} ·{" "}
            {status.lastCompaction.strategy}
          </Text>
        ) : null}
      </Box>

      <Text color="cyan">
        a auto this session · s save user default · c compact now · p preview ·
        Esc close
      </Text>
    </Box>
  );
}

export function PermissionsPanel({
  profile,
  provenance,
  grants,
  selectedIndex,
  revision: _revision,
}: {
  readonly profile: string;
  readonly provenance: string;
  readonly grants: readonly SessionGrant[];
  readonly selectedIndex: number;
  readonly revision: number;
}): React.JSX.Element {
  return (
    <Box
      borderStyle="round"
      borderColor="cyan"
      flexDirection="column"
      paddingX={1}
    >
      <Text bold color="cyan">
        Session permissions
      </Text>
      <Text>
        Effective profile <Text bold>{profile}</Text> · source {provenance}
      </Text>
      <Text dimColor>
        Grants are memory-only for this workspace and disappear on
        new/resume/exit.
      </Text>
      {grants.length === 0 ? (
        <Text dimColor>No active session grants.</Text>
      ) : null}
      {grants.map((grant, index) => (
        <Text key={grant.id} bold={index === selectedIndex}>
          {index === selectedIndex ? "› " : "  "}
          {formatApprovalScope(grant.scope)} · used {grant.useCount} ·{" "}
          {grant.id}
        </Text>
      ))}
      <Text dimColor>↑/↓ select · r revoke · x revoke all · Esc close</Text>
    </Box>
  );
}

export function UpdateBanner({
  state,
  terminalWidth,
}: {
  readonly state: UpdateState;
  readonly terminalWidth: number;
}): React.JSX.Element {
  const latest = state.latestVersion ?? "unknown";
  const notes = terminalHyperlink(
    `${FORGE_RELEASES_URL}/tag/v${latest}`,
    { env: process.env, isTTY: process.stdout.isTTY === true },
    "release notes",
  );
  return (
    <Box borderStyle="round" borderColor="yellow" paddingX={1}>
      <Text color="yellow">
        <Text bold>Update {latest}</Text> · current {state.currentVersion}
        {terminalWidth >= 64
          ? ` · forge update · restart required · ${notes} · /update-dismiss`
          : " · forge update · restart · /update-dismiss"}
      </Text>
    </Box>
  );
}

function contextUsageBar(ratio: number): string {
  const width = 28;
  const filled = Math.max(0, Math.min(width, Math.round(ratio * width)));
  return `${"█".repeat(filled)}${"░".repeat(width - filled)}`;
}

function contextUsageColor(percent: number): "green" | "yellow" | "red" {
  return percent >= 85 ? "red" : percent >= 65 ? "yellow" : "green";
}

function formatTokenCount(value: number): string {
  return new Intl.NumberFormat("en-US").format(value);
}

function contextRing(ratio: number): "○" | "◔" | "◑" | "◕" | "●" {
  return ratio >= 0.9
    ? "●"
    : ratio >= 0.75
      ? "◕"
      : ratio >= 0.5
        ? "◑"
        : ratio >= 0.25
          ? "◔"
          : "○";
}

function formatContextIndicator(
  status: ContextStatus,
  width: number,
  stateOverride?: ContextStatus["pressure"]["state"],
): string {
  const ratio = status.pressure.ratio;
  const value =
    status.pressure.confidence === "unavailable"
      ? "?"
      : `${status.pressure.confidence === "exact" ? "" : "~"}${Math.round(
          ratio * 100,
        )}%`;
  const compact = `${contextRing(ratio)} ${value}`;
  if (width < 48) return contextRing(ratio);
  if (width < 72) return compact;
  const effectiveState = stateOverride ?? status.pressure.state;
  const state =
    effectiveState === "compact-soon"
      ? "compact soon"
      : effectiveState === "compacting"
        ? "compacting"
        : effectiveState === "compacted"
          ? "compacted"
          : effectiveState === "paused"
            ? "auto paused"
            : status.pressure.mode === "auto-session" ||
                status.pressure.mode === "auto-default"
              ? "context · auto"
              : "context · warn";
  return `${compact} ${state}`;
}

function contextPressureColor(ratio: number): "green" | "yellow" | "red" {
  return ratio >= 0.9 ? "red" : ratio >= 0.75 ? "yellow" : "green";
}

function contextModeLabel(mode: ContextStatus["pressure"]["mode"]): string {
  switch (mode) {
    case "auto-session":
      return "automatic for this session";
    case "auto-default":
      return "automatic user default";
    case "paused":
      return "automatic paused";
    case "off":
      return "off";
    default:
      return "warn only";
  }
}

/**
 * A pending browser sign-in.
 *
 * The URL is rendered as its own block rather than as transcript text so it
 * keeps one unbroken clickable run: Ink wraps the visible characters while the
 * surrounding OSC 8 sequence continues to describe a single link target.
 */
function SignInPanel({
  prompt,
  env,
}: {
  readonly prompt: PendingSignIn;
  readonly env: NodeJS.ProcessEnv;
}): React.JSX.Element {
  const link = terminalHyperlink(prompt.url, { env, isTTY: true });
  return (
    <Box
      borderStyle="round"
      borderColor="cyan"
      flexDirection="column"
      paddingX={1}
      marginBottom={1}
    >
      <Text bold color="cyan">
        Login
      </Text>
      <Box marginTop={1}>
        <Text dimColor>
          {prompt.userCode === undefined
            ? "Browser didn't open? Use the URL below to sign in."
            : "Open the URL below and enter the code to sign in."}
        </Text>
      </Box>
      <Box marginTop={1}>
        <Text color="cyan" underline>
          {link}
        </Text>
      </Box>
      {prompt.userCode === undefined ? null : (
        <Box marginTop={1}>
          <Text>
            Code:{" "}
            <Text bold color="cyan">
              {prompt.userCode}
            </Text>
          </Text>
        </Box>
      )}
      <Box marginTop={1}>
        <Text dimColor>Waiting for sign-in to complete · Ctrl+C cancel</Text>
      </Box>
    </Box>
  );
}

function TranscriptBlock({
  entry,
}: {
  readonly entry: TranscriptEntry;
}): React.JSX.Element {
  switch (entry.kind) {
    case "user":
      return (
        <Box flexDirection="column" marginBottom={1}>
          <Text bold color="cyan">
            › You
          </Text>
          <Text>{entry.text}</Text>
        </Box>
      );
    case "reasoning":
      return (
        <Box
          borderStyle="single"
          borderColor="gray"
          flexDirection="column"
          paddingX={1}
          marginBottom={1}
        >
          <Text bold color="magenta">
            ◆ Reasoning
          </Text>
          <TerminalMarkdown dimColor>{entry.text}</TerminalMarkdown>
        </Box>
      );
    case "answer":
      return (
        <Box flexDirection="column" paddingX={1} marginBottom={1}>
          <Text bold color="green">
            ● Answer
          </Text>
          <TerminalMarkdown layout="answer">{entry.text}</TerminalMarkdown>
        </Box>
      );
    case "tool":
      return <Text color="yellow">{entry.text}</Text>;
    case "warning":
      return <Text color="yellow">⚠ {entry.text}</Text>;
    case "error":
      return <Text color="red">✗ {entry.text}</Text>;
    case "system":
      return <Text dimColor>{entry.text}</Text>;
    case "diff":
      return <DiffPanel diff={entry.text} />;
    case "raw":
      // Codex Engine streams stdout/stderr chunks instead of structured
      // RunEvents. Render those chunks as Markdown so its answer keeps the
      // same terminal presentation as Forge model output.
      return <TerminalMarkdown layout="answer">{entry.text}</TerminalMarkdown>;
  }
}

export function DiffPanel({
  diff,
}: {
  readonly diff: string;
}): React.JSX.Element {
  const summary = summarizeUnifiedDiff(diff);
  const title = `${summary.operation.toUpperCase()} ${summary.path}`;
  return (
    <Box flexDirection="column">
      <Text bold>
        ╭─ {title} <Text color="greenBright">+{summary.additions}</Text>{" "}
        <Text color="redBright">-{summary.deletions}</Text>
      </Text>
      {formatUnifiedDiffRows(diff).map((row, index) => {
        const key = `${index}-${row.kind}`;
        if (row.kind === "addition") {
          return (
            <Text key={key} {...diffRowStyle(row.kind)}>
              {row.gutter}
              {row.line}
            </Text>
          );
        }
        if (row.kind === "deletion") {
          return (
            <Text key={key} {...diffRowStyle(row.kind)}>
              {row.gutter}
              {row.line}
            </Text>
          );
        }
        return (
          <Text key={key}>
            <Text color="yellow">{row.gutter}</Text>
            <Text
              {...(row.kind === "header" ? { bold: true } : {})}
              {...(row.kind === "hunk" ? { color: "cyan" as const } : {})}
            >
              {row.line}
            </Text>
          </Text>
        );
      })}
      <Text bold>╰─ Review the exact change before approval</Text>
    </Box>
  );
}

export function diffRowStyle(kind: DiffRow["kind"]): {
  readonly color?: "greenBright" | "redBright";
  readonly backgroundColor?: string;
} {
  if (kind === "addition") {
    return { color: "greenBright", backgroundColor: "#123d24" };
  }
  if (kind === "deletion") {
    return { color: "redBright", backgroundColor: "#4a171c" };
  }
  return {};
}

function appendTranscriptEntry(
  entries: readonly TranscriptEntry[],
  entry: TranscriptEntry,
  merge: boolean,
): readonly TranscriptEntry[] {
  const next = [...entries];
  const previous = next.at(-1);
  if (merge && previous?.kind === entry.kind) {
    next[next.length - 1] = {
      id: previous.id,
      kind: previous.kind,
      text: `${previous.text}${entry.text}`,
    };
  } else {
    next.push(entry);
  }

  // Keep the complete UI transcript. Ink.Static moves finalized entries into
  // terminal scrollback, so trimming here would make older output unrecoverable.
  return next;
}

function previousCursor(state: EditorState): number {
  if (state.cursor <= 0) return 0;
  const characters = Array.from(state.value.slice(0, state.cursor));
  return state.cursor - (characters.at(-1)?.length ?? 0);
}

function nextCursor(state: EditorState): number {
  if (state.cursor >= state.value.length) return state.value.length;
  return (
    state.cursor + (Array.from(state.value.slice(state.cursor))[0]?.length ?? 0)
  );
}

function asPersistedReasoningEffort(
  value: string,
): PersistedModelSelection["reasoningEffort"] {
  if (
    value === "none" ||
    value === "minimal" ||
    value === "low" ||
    value === "medium" ||
    value === "high" ||
    value === "xhigh" ||
    value === "max" ||
    value === "ultra"
  ) {
    return value;
  }
  return undefined;
}

function subscriptionModelChoices(
  models: readonly CodexModel[],
): readonly ModelChoice[] {
  return models.flatMap((model) => {
    const supportedReasoningEfforts = model.supportedReasoningEfforts.flatMap(
      ({ reasoningEffort, description }) => {
        const effort = asPersistedReasoningEffort(reasoningEffort);
        return effort ? [{ effort, description }] : [];
      },
    );
    const defaultReasoningEffort = asPersistedReasoningEffort(
      model.defaultReasoningEffort,
    );
    if (!defaultReasoningEffort || supportedReasoningEfforts.length === 0) {
      return [];
    }
    return [
      {
        label: model.displayName,
        description: "ChatGPT subscription · Codex Engine",
        selection: {
          engine: "codex" as const,
          provider: "openai" as const,
          id: model.id,
        },
        supportedReasoningEfforts,
        defaultReasoningEffort,
      },
    ];
  });
}

function effortsForModel(
  choices: readonly ModelChoice[],
  options: AskOptions,
): readonly EffortChoice[] {
  return (
    modelChoiceFor(choices, options)?.supportedReasoningEfforts ??
    STANDARD_EFFORTS
  );
}

function modelChoiceFor(
  choices: readonly ModelChoice[],
  options: AskOptions,
): ModelChoice | undefined {
  return choices.find(
    ({ selection }) =>
      selection.engine === options.engine &&
      selection.provider === options.provider &&
      selection.id === options.model,
  );
}
