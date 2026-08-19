import type {
  ModelAdapter,
  ModelConversationMessage,
  RunResult,
} from "@forge/core";
import type { AskOptions, WritableOutput } from "./ask.js";
import { formatSlashCommandHelp } from "./commands.js";
import { runInkInteractiveFromCli } from "./interactive-ui.js";
import type { CreateForgeModelAdapterOptions } from "./model-adapter.js";
import { createApprovalChannel, type RunDependencies, runTask } from "./run.js";

export interface InteractiveTerminal {
  readonly isTTY: boolean;
  question(prompt: string, signal?: AbortSignal): Promise<string | null>;
  onSigint(listener: () => void): void;
  offSigint(listener: () => void): void;
  close(): void;
}

export interface InteractiveDependencies {
  readonly env: NodeJS.ProcessEnv;
  readonly cwd: string;
  readonly terminal: InteractiveTerminal;
  readonly stdout: WritableOutput;
  readonly stderr: WritableOutput;
  readonly createAdapter?: (
    options: CreateForgeModelAdapterOptions,
  ) => ModelAdapter;
  readonly executeTask?: (
    prompt: string,
    options: AskOptions,
    dependencies: RunDependencies,
  ) => Promise<number>;
}

export async function runInteractiveSession(
  options: AskOptions,
  dependencies: InteractiveDependencies,
): Promise<number> {
  if (!dependencies.terminal.isTTY) {
    dependencies.stderr.write(
      'Interactive mode requires a TTY. Use `forge run "<task>"` for non-interactive operation.\n',
    );
    dependencies.terminal.close();
    return 2;
  }

  const executeTask = dependencies.executeTask ?? runTask;
  const conversation: ModelConversationMessage[] = [];
  let activeController: AbortController | undefined;
  let exitRequested = false;
  let exitArmed = false;

  const clearExitArm = () => {
    exitArmed = false;
  };
  const requestExit = () => {
    exitRequested = true;
    activeController?.abort("SIGINT");
    dependencies.terminal.close();
  };
  const onSigint = () => {
    if (activeController && !activeController.signal.aborted) {
      activeController.abort("SIGINT");
      exitArmed = true;
      dependencies.stderr.write(
        "Cancelling the active task. Press Ctrl+C again to exit.\n",
      );
      return;
    }
    if (exitArmed) {
      requestExit();
      return;
    }
    exitArmed = true;
    dependencies.stderr.write("Press Ctrl+C again to exit.\n");
  };

  dependencies.terminal.onSigint(onSigint);
  dependencies.stdout.write(
    "Forge interactive session\nType /help for commands or /exit to quit.\n",
  );

  try {
    while (!exitRequested) {
      const line = await dependencies.terminal.question("forge> ");
      if (line === null || exitRequested) {
        break;
      }
      clearExitArm();
      const prompt = line.trim();
      if (prompt === "") {
        continue;
      }
      if (prompt.startsWith("/")) {
        const handled = handleSlashCommand(
          prompt,
          conversation,
          dependencies.stdout,
        );
        if (handled === "exit") {
          break;
        }
        continue;
      }

      activeController = new AbortController();
      let result: RunResult | undefined;
      const approvalChannel = createApprovalChannel(
        (approvalPrompt, signal) =>
          dependencies.terminal.question(approvalPrompt, signal),
        dependencies.stderr,
      );
      await executeTask(prompt, options, {
        env: dependencies.env,
        cwd: dependencies.cwd,
        stdout: dependencies.stdout,
        stderr: dependencies.stderr,
        signal: activeController.signal,
        approvalChannel,
        conversation: [...conversation],
        onResult: (nextResult) => {
          result = nextResult;
        },
        ...(dependencies.createAdapter
          ? { createAdapter: dependencies.createAdapter }
          : {}),
      });
      activeController = undefined;

      if (result?.status === "completed") {
        conversation.push({ role: "user", content: prompt });
        if (result.finalText !== "") {
          conversation.push({
            role: "assistant",
            content: result.finalText,
          });
        }
      }
      if (exitRequested) {
        break;
      }
    }
  } finally {
    clearExitArm();
    activeController?.abort("session closed");
    dependencies.terminal.offSigint(onSigint);
    dependencies.terminal.close();
  }

  dependencies.stdout.write("Goodbye.\n");
  return 0;
}

export async function runInteractiveFromCli(
  options: AskOptions,
  env: NodeJS.ProcessEnv = process.env,
): Promise<number> {
  return runInkInteractiveFromCli(options, {
    env,
    cwd: process.cwd(),
  });
}

export async function createReadlineTerminal(
  input: NodeJS.ReadableStream & { readonly isTTY?: boolean },
  output: NodeJS.WritableStream,
): Promise<InteractiveTerminal> {
  const { createInterface } = await import("node:readline/promises");
  const readline = createInterface({ input, output, terminal: input.isTTY });
  let closed = false;
  readline.once("close", () => {
    closed = true;
  });

  return {
    isTTY: input.isTTY === true,
    question: (prompt, signal) => {
      if (closed) {
        return Promise.resolve(null);
      }
      return new Promise<string | null>((resolve) => {
        let settled = false;
        const settle = (answer: string | null) => {
          if (settled) return;
          settled = true;
          readline.off("close", onClose);
          resolve(answer);
        };
        const onClose = () => settle(null);
        readline.once("close", onClose);
        const answer = signal
          ? readline.question(prompt, { signal })
          : readline.question(prompt);
        answer.then(settle, () => settle(null));
      });
    },
    onSigint: (listener) => readline.on("SIGINT", listener),
    offSigint: (listener) => readline.off("SIGINT", listener),
    close: () => readline.close(),
  };
}

function handleSlashCommand(
  command: string,
  conversation: ModelConversationMessage[],
  stdout: WritableOutput,
): "continue" | "exit" {
  switch (command) {
    case "/exit":
      return "exit";
    case "/clear":
      conversation.length = 0;
      stdout.write("Conversation context cleared.\n");
      return "continue";
    case "/help":
      stdout.write(formatSlashCommandHelp());
      return "continue";
    default:
      stdout.write(`Unknown command: ${command}. Type /help for commands.\n`);
      return "continue";
  }
}
