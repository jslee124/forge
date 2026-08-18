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
  filterSlashCommands,
  formatSlashCommandHelp,
  type SlashCommand,
} from "./commands.js";
import {
  activeMentionQuery,
  assemblePrompt,
  classifySubmissionKey,
  createEditorState,
  deleteEditorRange,
  discoverWorkspaceFiles,
  type EditorState,
  filterWorkspaceFiles,
  insertEditorText,
  insertFileMention,
  moveEditorCursor,
  slashCommandQuery,
} from "./interactive-model.js";
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

type Phase = "editing" | "running" | "approving" | "resuming";
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

export interface InteractiveUiDependencies {
  readonly env: NodeJS.ProcessEnv;
  readonly cwd: string;
  readonly executeTask?: (
    prompt: string,
    options: AskOptions,
    dependencies: RunDependencies,
  ) => Promise<number>;
  readonly sessionPersistence?: InteractiveSessionPersistence;
}

interface InteractiveAppProps extends InteractiveUiDependencies {
  readonly options: AskOptions;
}

export const INK_KEYBOARD_MODE = "disabled" as const;
export const INK_INCREMENTAL_RENDERING = false as const;

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
  try {
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
      options={options}
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
      // VS Code and other terminals may echo Ink's capability query as input.
      // Ctrl+J remains the portable multiline fallback when Shift+Enter is not
      // distinguishable without an enhanced keyboard protocol.
      kittyKeyboard: { mode: INK_KEYBOARD_MODE },
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
  sessionPersistence,
}: InteractiveAppProps): React.JSX.Element {
  const { exit } = useApp();
  const { TERM_PROGRAM: terminalProgram } = env;
  const isVsCodeTerminal = terminalProgram === "vscode";
  const [editor, setEditor] = useState<EditorState>(() => createEditorState());
  const [phase, setPhase] = useState<Phase>("editing");
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
        setEditor(createEditorState());
        return;
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
      await executeTask(prompt, options, {
        env,
        cwd,
        stdout,
        stderr,
        signal: controller.signal,
        approvalChannel,
        conversation: [...conversation.current],
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
          <Text dimColor> coding agent · / commands · @ files</Text>
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

      <Box
        borderStyle="round"
        borderColor={phase === "editing" ? "green" : "gray"}
        paddingX={1}
        marginTop={1}
      >
        <Text color="green">❯ </Text>
        <PromptWithCursor state={editor} active={phase === "editing"} />
      </Box>

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

      <Text dimColor>
        {phase === "editing"
          ? `${filesLoading ? "Indexing files · " : ""}Enter submit · ${isVsCodeTerminal ? "Ctrl+J newline · configure Shift+Enter in VS Code" : "Shift+Enter/Ctrl+J newline"} · Ctrl+C cancel/exit`
          : phase === "running"
            ? "● Running · Ctrl+C cancel"
            : phase === "approving"
              ? "Waiting for approval"
              : "Choose a saved session"}
      </Text>
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
          <Text dimColor>{entry.text}</Text>
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
          <Text>{entry.text}</Text>
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
      return <Text>{entry.text}</Text>;
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
