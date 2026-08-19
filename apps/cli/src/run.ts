import { randomUUID } from "node:crypto";

import {
  ForgeConfigError,
  formatInstructionPrompt,
  loadForgeConfig,
  loadInstructions,
  MAX_TOTAL_INSTRUCTION_BYTES,
} from "@forge/config";
import {
  type ApprovalChannel,
  AutomaticWorkspaceWritePolicy,
  type ModelAdapter,
  ModelConfigurationError,
  type ModelConversationMessage,
  type RunEvent,
  type RunResult,
  runAgent,
  WorkspaceWritePolicy,
} from "@forge/core";
import type { DeepSeekThinkingMode } from "@forge/model-deepseek";
import {
  configuredSecrets,
  JsonlTraceWriter,
  PersistenceError,
  redactValue,
} from "@forge/persistence";
import {
  discoverPortableSkills,
  loadPluginHost,
  PluginError,
  selectPortableSkills,
} from "@forge/plugin-api";
import {
  type ApplyPatchInput,
  builtinTools,
  type CreateFileInput,
  previewCreateFile,
  previewPatch,
  resolveWorkspace,
  WorkspaceResolutionError,
} from "@forge/tools";

import type { AskOptions, WritableOutput } from "./ask.js";
import { parseThinkingMode } from "./ask.js";
import { formatDiffPanel } from "./diff.js";
import {
  type CreateForgeModelAdapterOptions,
  createForgeModelAdapter,
} from "./model-adapter.js";
import { createSigintCancellationScope } from "./signals.js";

export interface RunDependencies {
  readonly env: NodeJS.ProcessEnv;
  readonly cwd: string;
  readonly stdout: WritableOutput;
  readonly stderr: WritableOutput;
  readonly signal: AbortSignal;
  readonly approvalChannel?: ApprovalChannel;
  readonly conversation?: readonly ModelConversationMessage[];
  readonly sessionId?: string;
  readonly runId?: string;
  readonly onResult?: (result: RunResult, metadata?: RunMetadata) => void;
  readonly onEvent?: (event: RunEvent) => void | Promise<void>;
  readonly renderEventsToOutput?: boolean;
  readonly createAdapter?: (
    options: CreateForgeModelAdapterOptions,
  ) => ModelAdapter;
}

export interface RunMetadata {
  readonly runId: string;
  readonly sessionId?: string;
  readonly tracePersisted: boolean;
}

export async function runTask(
  prompt: string,
  options: AskOptions,
  dependencies: RunDependencies,
): Promise<number> {
  try {
    const loaded = await loadForgeConfig({
      cwd: dependencies.cwd,
      env: dependencies.env,
      cli: options,
    });
    const instructions = await loadInstructions(loaded);
    for (const warning of instructions.warnings) {
      dependencies.stderr.write(`Configuration warning: ${warning}\n`);
    }
    const thinking: DeepSeekThinkingMode = parseThinkingMode(
      loaded.config.model.thinking,
    );
    const portableSkills = await discoverPortableSkills(loaded.workspaceRoot);
    const selectedSkills = selectPortableSkills(prompt, portableSkills);
    const pluginHost = await loadPluginHost({
      forgeHome: loaded.forgeHome,
      workspaceRoot: loaded.workspaceRoot,
      enabledUserPlugins: loaded.config.plugins.enabled,
      reservedToolNames: builtinTools.map(({ name }) => name),
    });
    for (const warning of pluginHost.warnings) {
      dependencies.stderr.write(`Plugin warning: ${warning}\n`);
    }
    const pluginPrompt = await pluginHost.promptContributions({
      prompt,
      workspaceRoot: loaded.workspaceRoot,
      workingDirectory: loaded.workingDirectory,
    });
    const selectedSkillPrompt = formatInstructionPrompt(
      selectedSkills.map((skill) => ({
        path: skill.path,
        scope: "project" as const,
        content: skill.content,
        truncated: false,
      })),
    );
    const effectiveInstructions = [
      instructions.prompt,
      selectedSkillPrompt,
      pluginPrompt.prompt,
    ]
      .filter((value) => value !== "")
      .join("\n\n");
    if (
      Buffer.byteLength(effectiveInstructions) > MAX_TOTAL_INSTRUCTION_BYTES
    ) {
      throw new PluginError(
        `Effective instructions exceed ${MAX_TOTAL_INSTRUCTION_BYTES} bytes after selected skills and plugin contributions.`,
      );
    }
    const runId = dependencies.runId ?? randomUUID();
    const metadata: RunMetadata = {
      runId,
      ...(dependencies.sessionId ? { sessionId: dependencies.sessionId } : {}),
      tracePersisted: loaded.config.trace.enabled,
    };
    const secrets = configuredSecrets(dependencies.env);
    const trace = loaded.config.trace.enabled
      ? new JsonlTraceWriter({
          forgeHome: loaded.forgeHome,
          runId,
          ...(dependencies.sessionId
            ? { sessionId: dependencies.sessionId }
            : {}),
          secrets,
        })
      : undefined;
    const model = (dependencies.createAdapter ?? createForgeModelAdapter)({
      env: dependencies.env,
      provider: loaded.config.model.provider,
      model: loaded.config.model.id,
      thinking,
      reasoningEffort: loaded.config.model.reasoningEffort,
    } satisfies CreateForgeModelAdapterOptions);
    const workspace = await resolveWorkspace(
      loaded.workspaceRoot,
      loaded.workingDirectory,
    );
    const render = createRunEventRenderer(
      dependencies.stdout,
      dependencies.stderr,
    );
    const result = await runAgent({
      prompt,
      context: {
        workspaceRoot: loaded.workspaceRoot,
        workingDirectory: loaded.workingDirectory,
        modelId: loaded.config.model.id,
        permissionProfile: loaded.config.permissionProfile,
        instructionPaths: [
          ...instructions.files.map(({ path }) => path),
          ...selectedSkills.map(({ path }) => path),
          ...pluginPrompt.sourcePaths,
        ],
      },
      ...(effectiveInstructions ? { instructions: effectiveInstructions } : {}),
      ...(dependencies.conversation
        ? { conversation: dependencies.conversation }
        : {}),
      model,
      tools: [...builtinTools, ...pluginHost.tools],
      policy: pluginHost.extendPolicy(
        loaded.config.permissionProfile === "workspace-write"
          ? new AutomaticWorkspaceWritePolicy()
          : new WorkspaceWritePolicy(),
      ),
      ...(dependencies.approvalChannel
        ? { approvalChannel: dependencies.approvalChannel }
        : {}),
      toolContext: {
        workspace,
        signal: dependencies.signal,
        limits: {
          maxOutputBytes: loaded.config.limits.maxToolOutputBytes,
          maxEntries: 200,
          commandTimeoutMs: loaded.config.limits.commandTimeoutMs,
        },
      },
      signal: dependencies.signal,
      limits: {
        maxModelSteps: loaded.config.limits.maxSteps,
        maxToolCalls: loaded.config.limits.maxToolCalls,
      },
      onEvent: async (event) => {
        if (dependencies.renderEventsToOutput !== false) {
          render(event);
        }
        await trace?.append(event);
        const observerEvent = redactValue(event, secrets) as RunEvent;
        for (const warning of await pluginHost.observe(observerEvent)) {
          dependencies.stderr.write(`Plugin warning: ${warning}\n`);
        }
        await dependencies.onEvent?.(event);
      },
    });

    dependencies.onResult?.(result, metadata);

    return result.exitCode;
  } catch (error) {
    if (dependencies.signal.aborted) {
      dependencies.stderr.write("Cancelled.\n");
      return 130;
    }
    if (
      error instanceof ForgeConfigError ||
      error instanceof PluginError ||
      error instanceof ModelConfigurationError ||
      error instanceof WorkspaceResolutionError
    ) {
      dependencies.stderr.write(`Configuration error: ${error.message}\n`);
      return 2;
    }
    if (error instanceof PersistenceError) {
      dependencies.stderr.write(`Persistence error: ${error.message}\n`);
      return 1;
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
) => Promise<string | null>;

export interface CommandApprovalPreview {
  readonly command: string;
  readonly cwd: string;
  readonly timeoutMs: number;
}

export function createApprovalChannel(
  question: ApprovalQuestion,
  output: WritableOutput,
  options: {
    readonly color?: boolean;
    readonly onCommandPreview?: (preview: CommandApprovalPreview) => void;
  } = {},
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
        output.write(
          `${formatDiffPanel(preview.output.diff, options.color === true)}\n`,
        );
      } else if (action.tool.name === "create_file") {
        const preview = await previewCreateFile(
          action.input as CreateFileInput,
          context,
        );
        if (!preview.ok) {
          output.write(
            `Cannot preview file creation: ${preview.error.message}\n`,
          );
          return false;
        }
        if (preview.truncated) {
          output.write(
            "Cannot approve file creation because its diff exceeds the display limit.\n",
          );
          return false;
        }
        output.write(
          `${formatDiffPanel(preview.output.diff, options.color === true)}\n`,
        );
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
      }

      const answer = await question("Approve? [y/N] ", signal);
      return answer !== null && /^(?:y|yes)$/iu.test(answer.trim());
    },
  };
}

export function formatCommandApprovalPreview(
  preview: CommandApprovalPreview,
): string {
  return `$ ${preview.command}\n  Working directory  ${preview.cwd}\n  Timeout            ${formatDuration(preview.timeoutMs)}\n`;
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
