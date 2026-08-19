import { ForgeConfigError, loadForgeConfig } from "@forge/config";
import {
  type ModelAdapter,
  ModelConfigurationError,
  ModelProviderError,
  type ModelUsage,
} from "@forge/core";
import {
  DEFAULT_DEEPSEEK_MODEL,
  type DeepSeekThinkingMode,
} from "@forge/model-deepseek";
import {
  type CreateForgeModelAdapterOptions,
  createForgeModelAdapter,
} from "./model-adapter.js";
import { createSigintCancellationScope } from "./signals.js";

export interface WritableOutput {
  write(chunk: string): unknown;
}

export interface AskOptions {
  readonly engine?: string;
  readonly provider?: string;
  readonly model?: string;
  readonly reasoningEffort?: string;
  readonly thinking?: string;
  readonly permissionProfile?: string;
  readonly maxSteps?: number;
  readonly maxToolCalls?: number;
  readonly commandTimeoutMs?: number;
  readonly maxToolOutputBytes?: number;
  readonly contextMode?: string;
  readonly reservedOutputTokens?: number;
  readonly bufferTokens?: number;
  readonly recentTailTokens?: number;
  readonly summaryTargetTokens?: number;
}

export interface AskDependencies {
  readonly env: NodeJS.ProcessEnv;
  readonly stdout: WritableOutput;
  readonly stderr: WritableOutput;
  readonly signal: AbortSignal;
  readonly createAdapter?: (
    options: CreateForgeModelAdapterOptions,
  ) => ModelAdapter;
}

export async function runAsk(
  prompt: string,
  options: AskOptions,
  dependencies: AskDependencies,
): Promise<number> {
  try {
    const thinking = parseThinkingMode(options.thinking ?? "enabled");
    const model = options.model?.trim() || DEFAULT_DEEPSEEK_MODEL;
    const adapterFactory =
      dependencies.createAdapter ?? createForgeModelAdapter;
    const adapter = adapterFactory({
      env: dependencies.env,
      provider: options.provider === "openai" ? "openai" : "deepseek",
      model,
      thinking,
      reasoningEffort: parseReasoningEffort(
        options.reasoningEffort ?? "medium",
      ),
    });

    return await consumeModelStream(
      adapter,
      prompt,
      dependencies.signal,
      dependencies.stdout,
      dependencies.stderr,
    );
  } catch (error) {
    if (dependencies.signal.aborted) {
      dependencies.stderr.write("Cancelled.\n");
      return 130;
    }

    if (error instanceof ModelConfigurationError) {
      dependencies.stderr.write(`Configuration error: ${error.message}\n`);
      return 2;
    }

    if (error instanceof ModelProviderError) {
      dependencies.stderr.write(`Provider error: ${error.message}\n`);
      return 1;
    }

    dependencies.stderr.write(
      "Unexpected error while contacting DeepSeek. Run with debug logging after checking your configuration.\n",
    );
    return 1;
  }
}

export async function runAskFromCli(
  prompt: string,
  options: AskOptions,
  env: NodeJS.ProcessEnv = process.env,
): Promise<number> {
  const cancellation = createSigintCancellationScope();

  try {
    const loaded = await loadForgeConfig({
      cwd: process.cwd(),
      env,
      cli: options,
    });
    return await runAsk(
      prompt,
      {
        model: loaded.config.model.id,
        provider: loaded.config.model.provider,
        reasoningEffort: loaded.config.model.reasoningEffort,
        thinking: loaded.config.model.thinking,
      },
      {
        env,
        stdout: process.stdout,
        stderr: process.stderr,
        signal: cancellation.signal,
      },
    );
  } catch (error) {
    if (error instanceof ForgeConfigError) {
      process.stderr.write(`Configuration error: ${error.message}\n`);
      return 2;
    }
    throw error;
  } finally {
    cancellation.dispose();
  }
}

async function consumeModelStream(
  adapter: ModelAdapter,
  prompt: string,
  signal: AbortSignal,
  stdout: WritableOutput,
  stderr: WritableOutput,
): Promise<number> {
  let section: "reasoning" | "answer" | undefined;
  let finished = false;

  for await (const event of adapter.stream({ prompt }, signal)) {
    switch (event.type) {
      case "reasoning.delta":
        section = renderDelta("reasoning", section, event.text, stdout);
        break;

      case "text.delta":
        section = renderDelta("answer", section, event.text, stdout);
        break;

      case "warning":
        stderr.write(`Warning: ${event.message}\n`);
        break;

      case "finish":
        finished = true;
        finishOutput(section, stdout);
        renderUsage(event.usage, stderr);
        return event.finishReason === "error" ? 1 : 0;

      case "abort":
        finishOutput(section, stdout);
        stderr.write("Cancelled.\n");
        return 130;
    }
  }

  if (!finished) {
    throw new ModelProviderError(
      "DeepSeek ended the stream without a finish event.",
      { provider: "deepseek", retryable: true },
    );
  }

  return 0;
}

function renderDelta(
  nextSection: "reasoning" | "answer",
  currentSection: "reasoning" | "answer" | undefined,
  text: string,
  stdout: WritableOutput,
): "reasoning" | "answer" {
  if (currentSection !== nextSection) {
    if (currentSection !== undefined) {
      stdout.write("\n");
    }
    stdout.write(`[${nextSection}]\n`);
  }

  stdout.write(text);
  return nextSection;
}

function finishOutput(
  section: "reasoning" | "answer" | undefined,
  stdout: WritableOutput,
): void {
  if (section !== undefined) {
    stdout.write("\n");
  }
}

function renderUsage(usage: ModelUsage, stderr: WritableOutput): void {
  const entries = [
    ["input", usage.inputTokens],
    ["output", usage.outputTokens],
    ["reasoning", usage.reasoningTokens],
    ["cached", usage.cachedInputTokens],
    ["total", usage.totalTokens],
  ].filter((entry): entry is [string, number] => entry[1] !== undefined);

  if (entries.length > 0) {
    stderr.write(
      `[usage] ${entries.map(([name, value]) => `${name}=${value}`).join(" ")}\n`,
    );
  }
}

export function parseThinkingMode(value: string): DeepSeekThinkingMode {
  if (value === "enabled" || value === "disabled") {
    return value;
  }

  throw new ModelConfigurationError(
    `Invalid thinking mode "${value}". Use "enabled" or "disabled".`,
  );
}

function parseReasoningEffort(
  value: string,
): CreateForgeModelAdapterOptions["reasoningEffort"] {
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
  throw new ModelConfigurationError(`Invalid reasoning effort "${value}".`);
}
