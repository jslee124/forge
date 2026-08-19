import { randomUUID } from "node:crypto";
import { type ApiKeyProvider, AuthenticationManager } from "@forge/auth";
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
import type { SessionSummary } from "@forge/persistence";
import { Box, render, Text, useApp, useInput, usePaste } from "ink";
import type React from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import type { AskOptions, WritableOutput } from "./ask.js";
import {
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
  moveEditorCursor,
  slashCommandQuery,
} from "./interactive-model.js";
import { TerminalMarkdown } from "./markdown.js";
import {
  createPersistentInteractiveSession,
  type InteractiveSessionPersistence,
} from "./persistent-session.js";
import {
  type CommandApprovalPreview,
  createApprovalChannel,
  type RunDependencies,
  type RunMetadata,
  runTask,
} from "./run.js";

type Phase =
  | "editing"
  | "running"
  | "approving"
  | "resuming"
  | "models"
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
  return [
    selection.engine,
    selection.provider,
    selection.id,
    selection.reasoningEffort ?? "",
    selection.thinking ?? "",
  ].join("\u0000");
}

function modelChoiceSearchFields(choice: ModelChoice): readonly string[] {
  const { selection } = choice;
  return [
    choice.label,
    choice.description,
    selection.engine,
    selection.provider,
    selection.id,
    selection.reasoningEffort,
    selection.thinking,
  ].filter((value): value is string => value !== undefined);
}

const MODEL_CHOICES: readonly ModelChoice[] = [
  {
    label: "DeepSeek V4 Flash",
    description: "DeepSeek API · thinking enabled",
    selection: {
      engine: "forge",
      provider: "deepseek",
      id: "deepseek-v4-flash",
      thinking: "enabled",
    },
  },
  {
    label: "DeepSeek V4 Pro",
    description: "DeepSeek API · thinking enabled",
    selection: {
      engine: "forge",
      provider: "deepseek",
      id: "deepseek-v4-pro",
      thinking: "enabled",
    },
  },
  {
    label: "GPT-5.4 mini · low",
    description: "OpenAI API key · separately billed",
    selection: {
      engine: "forge",
      provider: "openai",
      id: "gpt-5.4-mini",
      reasoningEffort: "low",
    },
  },
  {
    label: "GPT-5.4 · high",
    description: "OpenAI API key · separately billed",
    selection: {
      engine: "forge",
      provider: "openai",
      id: "gpt-5.4",
      reasoningEffort: "high",
    },
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
    sessionPersistence ??= await createPersistentInteractiveSession({
      cwd: dependencies.cwd,
      env: dependencies.env,
    });
  } catch (error) {
    process.stderr.write(
      `Could not initialize persistent sessions: ${error instanceof Error ? error.message : "unknown error"}\n`,
    );
    return 2;
  }

  const instance = render(
    <InteractiveApp
      {...dependencies}
      sessionPersistence={sessionPersistence}
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
}: InteractiveAppProps): React.JSX.Element {
  const { exit } = useApp();
  const [editor, setEditor] = useState<EditorState>(() => createEditorState());
  const [phase, setPhase] = useState<Phase>("editing");
  const [activeOptions, setActiveOptions] = useState<AskOptions>(options);
  const initialMessages = sessionPersistence?.messages ?? [];
  const [transcript, setTranscript] = useState<readonly TranscriptEntry[]>(() =>
    conversationTranscript(initialMessages),
  );
  const [files, setFiles] = useState<readonly string[]>([]);
  const [filesLoading, setFilesLoading] = useState(true);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [dismissedCompletion, setDismissedCompletion] = useState<string>();
  const [approval, setApproval] = useState<PendingApproval>();
  const [sessions, setSessions] = useState<readonly SessionSummary[]>([]);
  const [modelChoices, setModelChoices] =
    useState<readonly ModelChoice[]>(MODEL_CHOICES);
  const [modelsLoading, setModelsLoading] = useState(false);
  const [modelQuery, setModelQuery] = useState("");
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

  const executeCommand = (command: string): void => {
    switch (command.trim()) {
      case "/exit":
        exit(0);
        return;
      case "/clear":
        conversation.current = [];
        sessionPersistence?.clear();
        setTranscript([]);
        nextTranscriptId.current = 0;
        setEditor(createEditorState());
        return;
      case "/new":
        conversation.current = [];
        sessionPersistence?.clear();
        setTranscript([]);
        nextTranscriptId.current = 0;
        setEditor(createEditorState());
        appendEntry("system", "Started a new session.");
        return;
      case "/context":
        setEditor(createEditorState());
        appendEntry(
          "system",
          sessionPersistence?.contextStatus?.() ??
            "Context status is unavailable because persistence is disabled.",
        );
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
          (message) => appendEntry("system", message),
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
            const subscriptionChoices = models.flatMap((model) =>
              model.supportedReasoningEfforts.flatMap(({ reasoningEffort }) => {
                const effort = asPersistedReasoningEffort(reasoningEffort);
                return effort
                  ? [
                      {
                        label: `${model.displayName} · ${effort}`,
                        description: "ChatGPT subscription · Codex Engine",
                        selection: {
                          engine: "codex" as const,
                          provider: "openai" as const,
                          id: model.id,
                          reasoningEffort: effort,
                        },
                      },
                    ]
                  : [];
              }),
            );
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
    if (visiblePrompt === "") return;
    if (visiblePrompt.startsWith("/")) {
      executeCommand(visiblePrompt);
      return;
    }

    const prompt = assemblePrompt(editor);
    const controller = new AbortController();
    activeController.current = controller;
    setEditor(createEditorState());
    setPhase("running");
    appendEntry("user", editor.value);
    let result: RunResult | undefined;
    let metadata: RunMetadata | undefined;
    let codexExitCode: number | undefined;
    let commandPreview: CommandApprovalPreview | undefined;

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
            resolve: settle,
          });
          commandPreview = undefined;
          setPhase("approving");
        }),
      stderr,
      {
        color: !("NO_COLOR" in process.env),
        onCommandPreview: (preview) => {
          commandPreview = preview;
        },
      },
    );

    void (async () => {
      const sessionId = await sessionPersistence?.prepareRun();
      if (activeOptions.engine === "codex") {
        let finalText = "";
        codexExitCode = await executeCodexTask(prompt, activeOptions, {
          env,
          cwd,
          stdout,
          stderr,
          onOutput: (event) => {
            handleCodexOutput(event);
            if (event.type === "answer") finalText += event.text;
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
          events: [],
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
      await executeTask(prompt, activeOptions, {
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
      });
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
    (text) => updateEditor((current) => insertEditorText(current, text)),
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
              const restored = conversationTranscript(messages);
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
        const nextOptions: AskOptions = {
          ...activeOptions,
          engine: selected.selection.engine,
          provider: selected.selection.provider,
          model: selected.selection.id,
          ...(selected.selection.reasoningEffort
            ? { reasoningEffort: selected.selection.reasoningEffort }
            : {}),
          ...(selected.selection.thinking
            ? { thinking: selected.selection.thinking }
            : {}),
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
          selection: selected.selection,
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
      updateEditor((current) =>
        deleteEditorRange(current, previousCursor(current), current.cursor),
      );
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
      <Box borderStyle="round" borderColor="cyan" paddingX={1}>
        <Text>
          <Text bold color="cyan">
            Forge
          </Text>
          <Text dimColor> coding agent · /login provider · @ files</Text>
        </Text>
      </Box>

      {transcript.length > 0 ? (
        <Box flexDirection="column" marginTop={1}>
          {transcript.map((entry) => (
            <TranscriptBlock key={entry.id} entry={entry} />
          ))}
        </Box>
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
            Choose model and reasoning effort
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
          marginTop={1}
        >
          <Text color="green">❯ </Text>
          <PromptWithCursor state={editor} active={phase === "editing"} />
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

function conversationTranscript(
  messages: readonly ModelConversationMessage[],
): readonly TranscriptEntry[] {
  return messages.map((message, index) => ({
    id: index,
    kind: message.role === "user" ? "user" : "answer",
    text: message.content,
  }));
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
          borderStyle="round"
          borderColor="green"
          flexDirection="column"
          paddingX={1}
          marginBottom={1}
        >
          <Text bold color="green">
            ● Answer
          </Text>
          <TerminalMarkdown>{entry.text}</TerminalMarkdown>
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
      return <TerminalMarkdown>{entry.text}</TerminalMarkdown>;
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
