import { randomUUID } from "node:crypto";
import { type ApiKeyProvider, AuthenticationManager } from "@forge/auth";
import { CodexAppServerClient, type CodexModel } from "@forge/codex-app-server";
import {
  loadForgeConfig,
  type PersistedModelSelection,
  saveUserModelSelection,
} from "@forge/config";
import type {
  ModelConversationMessage,
  RunEvent,
  RunResult,
} from "@forge/core";
import type { SessionReasoning, SessionSummary } from "@forge/persistence";
import { Box, render, Text, useApp, useInput, usePaste } from "ink";
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
import {
  type CommandApprovalPreview,
  createApprovalChannel,
  type NetworkApprovalPreview,
  type RunDependencies,
  type RunMetadata,
  runTask,
} from "./run.js";
import {
  changeProjectPluginTrust,
  type DetectedStartupResources,
  detectStartupResources,
  EMPTY_STARTUP_RESOURCES,
} from "./startup-resources.js";

type Phase =
  | "editing"
  | "running"
  | "approving"
  | "resuming"
  | "models"
  | "effort"
  | "plugins"
  | "plugin-trust"
  | "login-providers"
  | "login-key";
type TranscriptKind =
  | "user"
  | "reasoning"
  | "answer"
  | "tool"
  | "warning"
  | "error"
  | "system"
  | "raw";

interface TranscriptEntry {
  readonly id: number;
  readonly kind: TranscriptKind;
  readonly text: string;
}

interface PendingApproval {
  readonly prompt: string;
  readonly command?: CommandApprovalPreview;
  readonly network?: NetworkApprovalPreview;
  readonly resolve: (answer: string | null) => void;
}

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
  readonly kind: "subscription" | "api-key";
  readonly provider?: ApiKeyProvider;
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
];

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
  {
    label: "MiMo v2.5",
    description: "Xiaomi MiMo API · via OpenAI-compat endpoint",
    selection: {
      engine: "forge",
      provider: "openai",
      id: "mimo-v2.5",
    },
    supportedReasoningEfforts: STANDARD_EFFORTS,
    defaultReasoningEffort: "low",
  },
  {
    label: "MiMo v2.5 Pro",
    description: "Xiaomi MiMo API · via OpenAI-compat endpoint",
    selection: {
      engine: "forge",
      provider: "openai",
      id: "mimo-v2.5-pro",
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
  readonly saveApiKey?: (options: {
    readonly provider: ApiKeyProvider;
    readonly apiKey: string;
    readonly env: NodeJS.ProcessEnv;
  }) => Promise<string>;
  readonly sessionPersistence?: InteractiveSessionPersistence;
  readonly persistModelSelection?: (options: {
    readonly cwd: string;
    readonly env: NodeJS.ProcessEnv;
    readonly selection: PersistedModelSelection;
  }) => Promise<string>;
  readonly detectedResources?: DetectedStartupResources;
  readonly updateProjectPluginTrust?: (
    trusted: boolean,
  ) => Promise<DetectedStartupResources>;
}

interface InteractiveAppProps extends InteractiveUiDependencies {
  readonly options: AskOptions;
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
    if (!dependencies.detectedResources) {
      detectedResources = await detectStartupResources({
        forgeHome: loaded.forgeHome,
        workspaceRoot: loaded.workspaceRoot,
        enabledUserPlugins: loaded.config.plugins.enabled,
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
  saveApiKey = ({ provider, apiKey, env: loginEnv }) =>
    new AuthenticationManager(loginEnv).storeApiKey(provider, apiKey),
  sessionPersistence,
  persistModelSelection = saveUserModelSelection,
  detectedResources = EMPTY_STARTUP_RESOURCES,
  updateProjectPluginTrust = (trusted) =>
    changeProjectPluginTrust({ cwd, env, trusted }),
}: InteractiveAppProps): React.JSX.Element {
  const { exit } = useApp();
  const [editor, setEditor] = useState<EditorState>(() => createEditorState());
  const [phase, setPhase] = useState<Phase>("editing");
  const [activeOptions, setActiveOptions] = useState<AskOptions>(options);
  const initialMessages = sessionPersistence?.messages ?? [];
  const [transcript, setTranscript] = useState<readonly TranscriptEntry[]>(() =>
    conversationTranscript(
      initialMessages,
      sessionPersistence?.reasoning ?? [],
    ),
  );
  const [contextPanel, setContextPanel] = useState<ContextStatus>();
  const [files, setFiles] = useState<readonly string[]>([]);
  const [filesLoading, setFilesLoading] = useState(true);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [dismissedCompletion, setDismissedCompletion] = useState<string>();
  const [approval, setApproval] = useState<PendingApproval>();
  const [resources, setResources] =
    useState<DetectedStartupResources>(detectedResources);
  const [pluginTrustIntent, setPluginTrustIntent] = useState<
    "trust" | "untrust"
  >();
  const [sessions, setSessions] = useState<readonly SessionSummary[]>([]);
  const [modelChoices, setModelChoices] =
    useState<readonly ModelChoice[]>(MODEL_CHOICES);
  const [modelsLoading, setModelsLoading] = useState(false);
  const [modelQuery, setModelQuery] = useState("");
  const [effortChoices, setEffortChoices] =
    useState<readonly EffortChoice[]>(STANDARD_EFFORTS);
  const [loginKey, setLoginKey] = useState("");
  const [loginChoice, setLoginChoice] = useState<LoginChoice>();
  const [loginPrompt, setLoginPrompt] = useState<PendingSignIn>();
  const conversation = useRef<ModelConversationMessage[]>([...initialMessages]);
  const activeController = useRef<AbortController | undefined>(undefined);
  const idleExitArmed = useRef(false);
  const nextTranscriptId = useRef(initialMessages.length);

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
        case "model.reasoning":
          appendEntry("reasoning", event.text, true);
          break;
        case "model.reasoning-unavailable":
          appendEntry(
            "reasoning",
            `Provider used ${event.reasoningTokens} reasoning tokens but did not return reasoning text.`,
          );
          break;
        case "model.text":
          appendEntry("answer", event.text, true);
          break;
        case "model.warning":
          appendEntry("warning", event.message);
          break;
        case "context.warning":
          appendEntry("warning", event.message);
          break;
        case "tool.proposed":
          appendEntry("tool", `○ Proposed ${event.call.name}`);
          break;
        case "tool.decision":
          appendEntry(
            "tool",
            `◇ ${event.decision.kind.toUpperCase()} ${event.call.name} — ${event.decision.reason}`,
          );
          break;
        case "tool.completed":
          appendEntry("tool", `✓ Completed ${event.call.name}`);
          break;
        case "tool.failed":
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
    setPhase("running");
    pending.resolve(answer);
  };

  const selectEffort = (effort: ReasoningEffort): void => {
    const engine = activeOptions.engine === "codex" ? "codex" : "forge";
    const provider =
      activeOptions.provider === "openai" ? "openai" : "deepseek";
    const model = activeOptions.model?.trim() || "deepseek-v4-flash";
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
            setModelChoices([...subscriptionChoices, ...MODEL_CHOICES]);
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
        setTranscript([]);
        nextTranscriptId.current = 0;
        setEditor(createEditorState());
        return;
      case "/new":
        conversation.current = [];
        sessionPersistence?.clear();
        setContextPanel(undefined);
        setTranscript([]);
        nextTranscriptId.current = 0;
        setEditor(createEditorState());
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
      case "/plugins":
        setEditor(createEditorState());
        setSelectedIndex(0);
        setPluginTrustIntent(undefined);
        setPhase("plugins");
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
        setSelectedIndex(0);
        setPhase("login-providers");
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
              ...MODEL_CHOICES,
            ]);
            setModelsLoading(false);
          },
          (error: unknown) => {
            appendEntry(
              "warning",
              `${error instanceof Error ? error.message : "Could not discover Codex models."} API models remain available.`,
            );
            setModelChoices(MODEL_CHOICES);
            setModelsLoading(false);
          },
        );
        return;
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
              setModelChoices([...subscriptionChoices, ...MODEL_CHOICES]);
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

    const approvalChannel = createApprovalChannel(
      (approvalPrompt, signal) =>
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
            ...(commandPreview ? { command: commandPreview } : {}),
            ...(networkPreview ? { network: networkPreview } : {}),
            resolve: settle,
          });
          commandPreview = undefined;
          networkPreview = undefined;
          setPhase("approving");
        }),
      stderr,
      {
        color: !("NO_COLOR" in process.env),
        onCommandPreview: (preview) => {
          commandPreview = preview;
        },
        onNetworkPreview: (preview) => {
          networkPreview = preview;
        },
      },
    );

    void (async () => {
      const sessionId = await sessionPersistence?.prepareRun();
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
          conversation: [...conversation.current],
          ...(sessionPersistence?.contextCheckpoint
            ? { contextCheckpoint: sessionPersistence.contextCheckpoint }
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
        if (result?.status === "completed") {
          conversation.current.push({ role: "user", content: prompt });
          if (result.finalText !== "") {
            conversation.current.push({
              role: "assistant",
              content: result.finalText,
            });
          }
        }
        activeController.current = undefined;
        setApproval(undefined);
        setPhase("editing");
      });
  };

  const cancelOrExit = (): void => {
    if (phase === "plugins" || phase === "plugin-trust") {
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
    const interruptCount = Array.from(input).filter(
      (character) => character === "\u0003",
    ).length;
    if ((key.ctrl && input.toLocaleLowerCase() === "c") || interruptCount > 0) {
      cancelOrExit();
      if (interruptCount > 1 && phase === "editing" && !completionKind) exit(0);
      return;
    }

    if (phase === "approving") {
      const answer = input.toLocaleLowerCase();
      if (answer === "y") finishApproval("y");
      else if (answer === "n" || key.escape || key.return) finishApproval("n");
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
          appendEntry(
            "system",
            trusted
              ? `Trusted project plugins for ${cwd}. They will load on the next Forge task.`
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
              conversation.current = [...messages];
              const restored = conversationTranscript(
                messages,
                sessionPersistence.reasoning ?? [],
              );
              nextTranscriptId.current = restored.length;
              setTranscript(restored);
              setSessions([]);
              setPhase("editing");
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
          return (
            (current + delta + LOGIN_CHOICES.length) % LOGIN_CHOICES.length
          );
        });
        return;
      }
      if (key.return) {
        const selected = LOGIN_CHOICES[selectedIndex];
        if (!selected) return;
        if (selected.kind === "api-key") {
          setLoginChoice(selected);
          setLoginKey("");
          setPhase("login-key");
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
            setModelChoices([...subscriptionChoices, ...MODEL_CHOICES]);
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

  return (
    <Box flexDirection="column" paddingX={1}>
      <ForgeHeader resources={resources} />

      {transcript.length > 0 ? (
        <Box flexDirection="column" marginTop={1}>
          {transcript.map((entry) => (
            <TranscriptBlock key={entry.id} entry={entry} />
          ))}
        </Box>
      ) : null}

      {contextPanel ? <ContextPanel status={contextPanel} /> : null}

      {phase === "plugins" ? <PluginsPanel resources={resources} /> : null}

      {phase === "plugin-trust" && pluginTrustIntent ? (
        <PluginTrustPanel
          cwd={cwd}
          intent={pluginTrustIntent}
          resources={resources}
        />
      ) : null}

      {phase === "approving" && approval ? (
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
          <Text>{approval.prompt}</Text>
          <Text>
            <Text bold color="green">
              y
            </Text>{" "}
            approve{" "}
            <Text bold color="red">
              n
            </Text>{" "}
            deny
          </Text>
        </Box>
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
          {LOGIN_CHOICES.map((choice, index) => (
            <Text
              key={choice.label}
              bold={index === selectedIndex}
              {...(index === selectedIndex ? { color: "cyan" as const } : {})}
            >
              {index === selectedIndex ? "› " : "  "}
              {choice.label} · {choice.description}
            </Text>
          ))}
          <Text dimColor>Enter continue · Esc cancel</Text>
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

      {phase !== "login-providers" && phase !== "login-key" ? (
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

      <PromptFooter
        activeOptions={activeOptions}
        filesLoading={filesLoading}
        phase={phase}
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
            {resources.skills.map(({ name }) => `$${name}`).join(" · ")}
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
): readonly TranscriptEntry[] {
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
    transcript.push({
      id: transcript.length,
      kind: message.role === "user" ? "user" : "answer",
      text: message.content,
    });
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

function PromptFooter({
  activeOptions,
  filesLoading,
  phase,
}: {
  readonly activeOptions: AskOptions;
  readonly filesLoading: boolean;
  readonly phase: Phase;
}): React.JSX.Element {
  if (phase === "editing") {
    return (
      <Box paddingX={1}>
        <Text color="gray">
          <Text color="blue">{formatCompactModelStatus(activeOptions)}</Text>
          {"  ·  "}
          {filesLoading ? "Indexing files  ·  " : ""}
          <Text color="yellow">Shift+Tab</Text> effort ·{" "}
          <Text color="green">Enter</Text> submit ·{" "}
          <Text color="cyan">Shift+Enter/Meta+Enter/Ctrl+J</Text> newline ·{" "}
          <Text color="red">Ctrl+C</Text> cancel/exit
        </Text>
      </Box>
    );
  }

  return (
    <Text dimColor>
      {phase === "running"
        ? "● Running · Ctrl+C cancel"
        : phase === "approving"
          ? "Waiting for approval"
          : phase === "models"
            ? "Choose a model"
            : phase === "effort"
              ? "Choose thinking effort"
              : phase === "plugins"
                ? "Review project plugins"
                : phase === "plugin-trust"
                  ? "Confirm project plugin trust"
                  : "Choose a saved session"}
    </Text>
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
  const inputBudget = status.availableInputTokens;
  const usedTokens = Math.min(status.estimatedTranscriptTokens, inputBudget);
  const usageRatio =
    inputBudget === 0 ? (usedTokens > 0 ? 1 : 0) : usedTokens / inputBudget;
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
          Context window
        </Text>
        <Text dimColor> · {status.mode} mode</Text>
      </Text>

      <Box flexDirection="column" marginTop={1}>
        <Text>
          <Text bold color={contextUsageColor(usagePercent)}>
            {usagePercent}% history
          </Text>
          <Text dimColor>
            {" "}
            · ~{formatTokenCount(status.estimatedTranscriptTokens)} of{" "}
            {formatTokenCount(inputBudget)} input tokens
          </Text>
        </Text>
        <Text color={contextUsageColor(usagePercent)}>
          {contextUsageBar(usageRatio)}
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
      </Box>
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
        <Box
          borderStyle="single"
          borderColor="green"
          flexDirection="column"
          paddingX={2}
          width="100%"
          maxWidth={112}
          marginBottom={1}
        >
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
    case "raw":
      // Codex Engine streams stdout/stderr chunks instead of structured
      // RunEvents. Render those chunks as Markdown so its answer keeps the
      // same terminal presentation as Forge model output.
      return <TerminalMarkdown layout="answer">{entry.text}</TerminalMarkdown>;
  }
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

  const limit = 32_000;
  let total = next.reduce((size, item) => size + item.text.length, 0);
  while (next.length > 1 && total > limit) {
    const removed = next.shift();
    total -= removed?.text.length ?? 0;
  }
  const first = next[0];
  if (first && first.text.length > limit) {
    next[0] = { ...first, text: first.text.slice(-limit) };
  }
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
