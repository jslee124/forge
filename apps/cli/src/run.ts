import {
  type RunDependencies as ApplicationRunDependencies,
  runTask as runApplicationTask,
} from "@forge/application/run";
import {
  type ApprovalChannel,
  type ApprovalDescriptor,
  type ApprovalResponse,
  describeApproval,
  formatApprovalScope,
  type RunEvent,
} from "@forge/core";
import { type EditFileInput, previewEditFile } from "@forge/tools";
import type { AskOptions, WritableOutput } from "./ask.js";
import { formatDiffPanel } from "./diff.js";
import { createSigintCancellationScope } from "./signals.js";

export type { RunMetadata } from "@forge/application/run";
export interface RunDependencies extends ApplicationRunDependencies {
  readonly stdout: WritableOutput;
  readonly renderEventsToOutput?: boolean;
}
export function runTask(
  prompt: string,
  options: AskOptions,
  dependencies: RunDependencies,
): Promise<number> {
  const render = createRunEventRenderer(
    dependencies.stdout,
    dependencies.stderr,
  );
  return runApplicationTask(prompt, options, {
    ...dependencies,
    onEvent: async (event) => {
      if (dependencies.renderEventsToOutput !== false) render(event);
      await dependencies.onEvent?.(event);
    },
  });
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
      onResult: (_result, metadata) => {
        if (metadata?.tracePersisted) {
          process.stderr.write(`[run] ${metadata.runId}\n`);
        }
      },
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
  return createApprovalChannel(
    async (prompt, signal) => {
      const { createInterface } = await import("node:readline/promises");
      const readline = createInterface({ input, output });
      try {
        return await readline.question(prompt, { signal });
      } catch {
        return null;
      } finally {
        readline.close();
      }
    },
    output,
    {
      color:
        "isTTY" in output &&
        output.isTTY === true &&
        !("NO_COLOR" in process.env),
    },
  );
}

export type ApprovalQuestion = (
  prompt: string,
  signal: AbortSignal,
  descriptor: ApprovalDescriptor,
) => Promise<string | null>;

export interface CommandApprovalPreview {
  readonly command: string;
  readonly cwd: string;
  readonly timeoutMs: number;
}

export interface NetworkApprovalPreview {
  readonly tool: string;
  readonly label: "Destination" | "Query" | "Target";
  readonly value: string;
}

export interface SubagentApprovalPreview {
  readonly tool: string;
  readonly task: string;
}

export interface DiffApprovalPreview {
  readonly diff: string;
}

export function createApprovalChannel(
  question: ApprovalQuestion,
  output: WritableOutput,
  options: {
    readonly color?: boolean;
    readonly onDiffPreview?: (preview: DiffApprovalPreview) => void;
    readonly onCommandPreview?: (preview: CommandApprovalPreview) => void;
    readonly onNetworkPreview?: (preview: NetworkApprovalPreview) => void;
    readonly onSubagentPreview?: (preview: SubagentApprovalPreview) => void;
  } = {},
): ApprovalChannel {
  const requestStructured: NonNullable<
    ApprovalChannel["requestStructured"]
  > = async (action, signal, context, descriptor) => {
    if (signal.aborted) {
      return { kind: "deny" };
    }
    if (action.tool.name === "edit_file") {
      const preview = await previewEditFile(
        action.input as EditFileInput,
        context,
      );
      if (!preview.ok) {
        output.write(`Cannot preview file edit: ${preview.error.message}\n`);
        return { kind: "preflight-failed", result: preview };
      }
      if (preview.truncated) {
        output.write(
          "Cannot approve file edit because its diff exceeds the display limit.\n",
        );
        return {
          kind: "preflight-failed",
          result: {
            ok: false,
            error: {
              code: "output_limit",
              message: "The file edit preview exceeds the display limit.",
              retryable: true,
            },
          },
        };
      }
      if (options.onDiffPreview) {
        options.onDiffPreview({ diff: preview.output.diff });
      } else {
        output.write(
          `${formatDiffPanel(preview.output.diff, options.color === true)}\n`,
        );
      }
    } else if (action.tool.name === "run_command") {
      const command = action.input as {
        readonly program: string;
        readonly args: readonly string[];
        readonly cwd: string;
        readonly timeoutMs: number;
      };
      const preview = {
        command: [
          command.program,
          ...command.args.map(quoteShellArgument),
        ].join(" "),
        cwd: command.cwd,
        timeoutMs: Math.min(
          command.timeoutMs,
          context.limits.commandTimeoutMs ?? command.timeoutMs,
        ),
      };
      if (options.onCommandPreview) {
        options.onCommandPreview(preview);
      } else {
        output.write(formatCommandApprovalPreview(preview));
      }
    } else if (action.tool.risk === "network") {
      const input = action.input as {
        readonly query?: unknown;
        readonly url?: unknown;
      };
      const preview: NetworkApprovalPreview = {
        tool: action.tool.name,
        ...(typeof input.url === "string"
          ? { label: "Destination", value: input.url }
          : typeof input.query === "string"
            ? { label: "Query", value: input.query }
            : { label: "Target", value: "Plugin-defined external service" }),
      };
      if (options.onNetworkPreview) {
        options.onNetworkPreview(preview);
      } else {
        output.write(formatNetworkApprovalPreview(preview));
      }
    } else if (action.tool.risk === "model") {
      const input = action.input as { readonly task?: unknown };
      const preview: SubagentApprovalPreview = {
        tool: action.tool.name,
        task:
          typeof input.task === "string"
            ? input.task.slice(0, 2_000)
            : "Plugin-defined delegated task",
      };
      if (options.onSubagentPreview) {
        options.onSubagentPreview(preview);
      } else {
        output.write(formatSubagentApprovalPreview(preview));
      }
    }

    const answer = await question(
      formatApprovalQuestion(descriptor),
      signal,
      descriptor,
    );
    return parseApprovalResponse(answer, descriptor);
  };
  return {
    request: async (action, signal, context) => {
      const descriptor = await describeApproval(action, context);
      const response = await requestStructured(
        action,
        signal,
        context,
        descriptor,
      );
      return (
        response.kind === "allow-once" || response.kind === "allow-session"
      );
    },
    requestStructured,
  };
}

export function formatApprovalQuestion(descriptor: ApprovalDescriptor): string {
  const scope = descriptor.allowedScopes[0];
  const sessionChoice = scope
    ? `\n  2  Allow this session: ${formatApprovalScope(scope)}`
    : "";
  const risk = descriptor.riskFlags.length
    ? `\n  Re-confirmation required: ${descriptor.riskFlags.join(", ")}`
    : "";
  return `Approve ${descriptor.effect}: ${descriptor.resource}?${risk}\n  1  Allow once${sessionChoice}\n  3  Deny (use "3: feedback" to guide the run)\nChoice [3] `;
}

export function parseApprovalResponse(
  answer: string | null,
  descriptor: ApprovalDescriptor,
): ApprovalResponse {
  const normalized = answer?.trim() ?? "";
  if (/^(?:1|y|yes)$/iu.test(normalized)) return { kind: "allow-once" };
  if (/^2$/u.test(normalized) && descriptor.allowedScopes.length > 0) {
    return { kind: "allow-session" };
  }
  const feedback = normalized.match(/^(?:3|n|no)\s*:\s*(.+)$/iu)?.[1]?.trim();
  return {
    kind: "deny",
    ...(feedback ? { feedback: feedback.slice(0, 2_000) } : {}),
  };
}

export function formatCommandApprovalPreview(
  preview: CommandApprovalPreview,
): string {
  return `$ ${preview.command}\n  Working directory  ${preview.cwd}\n  Timeout            ${formatDuration(preview.timeoutMs)}\n`;
}

export function formatNetworkApprovalPreview(
  preview: NetworkApprovalPreview,
): string {
  return `Network request\n  Tool         ${preview.tool}\n  ${preview.label.padEnd(13)}${preview.value}\n`;
}

export function formatSubagentApprovalPreview(
  preview: SubagentApprovalPreview,
): string {
  return `Delegated model run\n  Tool         ${preview.tool}\n  Task         ${preview.task}\n`;
}

function quoteShellArgument(value: string): string {
  if (/^[\w@%+=:,./-]+$/u.test(value)) return value;
  if (value === "") return "''";
  return `'${value.replaceAll("'", `'"'"'`)}'`;
}

function formatDuration(milliseconds: number): string {
  return milliseconds % 1000 === 0
    ? `${milliseconds / 1000}s`
    : `${milliseconds}ms`;
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
      case "model.reasoning-unavailable":
        closeSection();
        stderr.write(
          `[reasoning] Provider used ${event.reasoningTokens} reasoning tokens but did not return reasoning text.\n`,
        );
        break;
      case "model.text":
        delta("answer", event.text);
        break;
      case "model.warning":
        stderr.write(`Warning: ${event.message}\n`);
        break;
      case "context.warning":
        stderr.write(`Context warning: ${event.message}\n`);
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
      case "docs.search":
        stderr.write(
          `[docs] ${event.resultCount} result(s) · ${event.locale}${event.fallback ? " · English fallback" : ""}\n`,
        );
        break;
      case "docs.read":
        stderr.write(`[docs] read ${event.reference}\n`);
        break;
      case "docs.rejected":
        stderr.write(`[docs] rejected ${event.tool}: ${event.message}\n`);
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
