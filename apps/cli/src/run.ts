import {
  type ApprovalChannel,
  type ModelAdapter,
  ModelConfigurationError,
  type RunEvent,
  runAgent,
  WorkspaceWritePolicy,
} from "@forge/core";
import {
  type CreateDeepSeekModelAdapterOptions,
  createDeepSeekModelAdapter,
  DEFAULT_DEEPSEEK_MODEL,
  type DeepSeekThinkingMode,
} from "@forge/model-deepseek";
import {
  type ApplyPatchInput,
  builtinTools,
  previewPatch,
  resolveWorkspace,
  WorkspaceResolutionError,
} from "@forge/tools";

import type { AskOptions, WritableOutput } from "./ask.js";
import { parseThinkingMode } from "./ask.js";
import { createSigintCancellationScope } from "./signals.js";

export interface RunDependencies {
  readonly env: NodeJS.ProcessEnv;
  readonly cwd: string;
  readonly stdout: WritableOutput;
  readonly stderr: WritableOutput;
  readonly signal: AbortSignal;
  readonly approvalChannel?: ApprovalChannel;
  readonly createAdapter?: (
    options: CreateDeepSeekModelAdapterOptions,
  ) => ModelAdapter;
}

export async function runTask(
  prompt: string,
  options: AskOptions,
  dependencies: RunDependencies,
): Promise<number> {
  try {
    const thinking: DeepSeekThinkingMode = parseThinkingMode(
      options.thinking ?? "enabled",
    );
    const model = (dependencies.createAdapter ?? createDeepSeekModelAdapter)({
      env: dependencies.env,
      model: options.model?.trim() || DEFAULT_DEEPSEEK_MODEL,
      thinking,
    } satisfies CreateDeepSeekModelAdapterOptions);
    const workspace = await resolveWorkspace(dependencies.cwd);
    const render = createRunEventRenderer(
      dependencies.stdout,
      dependencies.stderr,
    );
    const result = await runAgent({
      prompt,
      model,
      tools: builtinTools,
      policy: new WorkspaceWritePolicy(),
      ...(dependencies.approvalChannel
        ? { approvalChannel: dependencies.approvalChannel }
        : {}),
      toolContext: {
        workspace,
        signal: dependencies.signal,
        limits: { maxOutputBytes: 65_536, maxEntries: 200 },
      },
      signal: dependencies.signal,
      onEvent: render,
    });

    return result.exitCode;
  } catch (error) {
    if (dependencies.signal.aborted) {
      dependencies.stderr.write("Cancelled.\n");
      return 130;
    }
    if (
      error instanceof ModelConfigurationError ||
      error instanceof WorkspaceResolutionError
    ) {
      dependencies.stderr.write(`Configuration error: ${error.message}\n`);
      return 2;
    }
    dependencies.stderr.write("Unexpected error while starting the run.\n");
    return 1;
  }
}

export async function runTaskFromCli(
  prompt: string,
  options: AskOptions,
  env: NodeJS.ProcessEnv = process.env,
): Promise<number> {
  const cancellation = createSigintCancellationScope();
  try {
    return await runTask(prompt, options, {
      env,
      cwd: process.cwd(),
      stdout: process.stdout,
      stderr: process.stderr,
      signal: cancellation.signal,
      ...(process.stdin.isTTY && process.stderr.isTTY
        ? {
            approvalChannel: createTerminalApprovalChannel(
              process.stdin,
              process.stderr,
            ),
          }
        : {}),
    });
  } finally {
    cancellation.dispose();
  }
}

export function createTerminalApprovalChannel(
  input: NodeJS.ReadableStream,
  output: NodeJS.WritableStream,
): ApprovalChannel {
  return {
    request: async (action, signal, context) => {
      if (signal.aborted) {
        return false;
      }
      if (action.tool.name === "apply_patch") {
        const preview = await previewPatch(
          action.input as ApplyPatchInput,
          context,
        );
        if (!preview.ok) {
          output.write(`Cannot preview patch: ${preview.error.message}\n`);
          return false;
        }
        if (preview.truncated) {
          output.write(
            "Cannot approve patch because its diff exceeds the display limit.\n",
          );
          return false;
        }
        output.write(`${preview.output.diff}\n`);
      } else if (action.tool.name === "run_command") {
        const command = action.input as {
          readonly program: string;
          readonly args: readonly string[];
          readonly cwd: string;
          readonly timeoutMs: number;
        };
        output.write(
          `Command: ${[command.program, ...command.args.map(quoteArgument)].join(" ")}\n` +
            `Working directory: ${command.cwd}\n` +
            `Timeout: ${command.timeoutMs} ms\n`,
        );
      }

      const { createInterface } = await import("node:readline/promises");
      const readline = createInterface({ input, output });
      const onAbort = () => readline.close();
      signal.addEventListener("abort", onAbort, { once: true });
      try {
        const answer = await readline.question("Approve? [y/N] ");
        return /^(?:y|yes)$/iu.test(answer.trim());
      } catch {
        return false;
      } finally {
        signal.removeEventListener("abort", onAbort);
        readline.close();
      }
    },
  };
}

function quoteArgument(value: string): string {
  return JSON.stringify(value);
}

function createRunEventRenderer(
  stdout: WritableOutput,
  stderr: WritableOutput,
): (event: RunEvent) => void {
  let section: "reasoning" | "answer" | undefined;

  const closeSection = () => {
    if (section) {
      stdout.write("\n");
      section = undefined;
    }
  };

  const delta = (next: "reasoning" | "answer", text: string) => {
    if (section !== next) {
      closeSection();
      stdout.write(`[${next}]\n`);
      section = next;
    }
    stdout.write(text);
  };

  return (event) => {
    switch (event.type) {
      case "model.reasoning":
        delta("reasoning", event.text);
        break;
      case "model.text":
        delta("answer", event.text);
        break;
      case "model.warning":
        stderr.write(`Warning: ${event.message}\n`);
        break;
      case "tool.proposed":
        closeSection();
        stderr.write(`[tool] proposed ${event.call.name}\n`);
        break;
      case "tool.decision":
        stderr.write(
          `[policy] ${event.decision.kind} ${event.call.name}: ${event.decision.reason}\n`,
        );
        break;
      case "tool.completed":
        stderr.write(`[tool] completed ${event.call.name}\n`);
        break;
      case "tool.failed":
        stderr.write(`[tool] failed ${event.call.name}`);
        if (!event.result.ok) {
          stderr.write(`: ${event.result.error.message}`);
        }
        stderr.write("\n");
        break;
      case "run.failed":
      case "run.denied":
      case "run.limit_reached":
      case "run.cancelled":
        closeSection();
        if (event.message) {
          stderr.write(`${event.message}\n`);
        }
        break;
      case "run.completed":
        closeSection();
        break;
      default:
        break;
    }
  };
}
