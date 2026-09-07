import { ModelConfigurationError } from "@forge/core";
import type { DeepSeekThinkingMode } from "@forge/model-deepseek";
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
  readonly image?: readonly string[];
}

export function parseThinkingMode(value: string): DeepSeekThinkingMode {
  if (value === "enabled" || value === "disabled") {
    return value;
  }

  throw new ModelConfigurationError(
    `Invalid thinking mode "${value}". Use "enabled" or "disabled".`,
  );
}
