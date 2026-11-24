import type { DetectedStartupResources } from "@forge/application";
import type { ContextStatus } from "@forge/application/persistent-session";
import type { ModelConversationMessage, RunEvent } from "@forge/core";
import { canonicalText } from "@forge/core";
import type { SessionReasoning } from "@forge/persistence";
import { Box, Text } from "ink";
import type React from "react";
import type { AskOptions } from "../ask.js";
import { terminalHyperlink } from "../hyperlink.js";
import { FORGE_RELEASES_URL, type UpdateState } from "../update.js";
import { formatRunActivity, formatToolCallSummary } from "./activity.js";
import {
  contextModeChoices,
  contextPressureColor,
  contextRing,
  formatContextIndicator,
} from "./context.js";
import type {
  InteractivePhase as Phase,
  RunActivity,
  TranscriptEntry,
  TranscriptKind,
} from "./types.js";

export type StaticOutputItem =
  | {
      readonly kind: "header";
      readonly resources: DetectedStartupResources;
    }
  | { readonly kind: "transcript"; readonly entry: TranscriptEntry };

export const RUN_ACTIVITY_FRAMES = [
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

const FORGE_WORDMARK = [
  " _____ ___  ____   ____ _____ ",
  "|  ___/ _ \\|  _ \\ / ___| ____|",
  "| |_ | | | | |_) | |  _|  _|  ",
  "|  _|| |_| |  _ <| |_| | |___ ",
  "|_|   \\___/|_| \\_\\\\____|_____|",
].join("\n");

export function ForgeHeader({
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

export function conversationTranscript(
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
        append("tool", `○ Proposed ${formatToolCallSummary(event.call)}`);
        break;
      case "tool.decision":
        append(
          "tool",
          `◇ ${event.decision.kind.toUpperCase()} ${formatToolCallSummary(event.call)} — ${event.decision.reason}`,
        );
        break;
      case "tool.completed":
        append("tool", `✓ Completed ${formatToolCallSummary(event.call)}`);
        break;
      case "tool.failed":
        append(
          "error",
          `✗ Failed ${formatToolCallSummary(event.call)}${event.result.ok ? "" : ` — ${event.result.error.message}`}`,
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

export function formatDuration(milliseconds: number): string {
  return milliseconds % 1000 === 0
    ? `${milliseconds / 1000}s`
    : `${milliseconds}ms`;
}

export function formatModelStatus(options: AskOptions): string {
  const model = options.model?.trim() || "default";
  const effort =
    options.reasoningEffort?.trim() || options.thinking?.trim() || "default";
  return `${model} · thinking effort: ${effort}`;
}

export function formatCompactModelStatus(options: AskOptions): string {
  const model = options.model?.trim() || "default";
  const effort =
    options.reasoningEffort?.trim() || options.thinking?.trim() || "default";
  return `${model} · ${effort}`;
}

export function PromptFooter({
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

export function ContextPanel({
  status,
  modeSelector,
  selectedModeIndex,
}: {
  readonly status: ContextStatus;
  readonly modeSelector: boolean;
  readonly selectedModeIndex: number;
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

      {modeSelector ? (
        <Box flexDirection="column" marginTop={1}>
          <Text bold color="cyan">
            Context mode
          </Text>
          {contextModeChoices(status).map((choice, index) => (
            <Text key={`${choice.kind}-${choice.mode}`}>
              {index === selectedModeIndex ? "› " : "  "}
              {choice.label}
            </Text>
          ))}
          <Text dimColor>↑/↓ choose · Enter apply · Esc back</Text>
        </Box>
      ) : (
        <Text color="cyan">
          m change mode · c compact now · p preview · Esc close
        </Text>
      )}
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

function contextModeLabel(mode: ContextStatus["pressure"]["mode"]): string {
  switch (mode) {
    case "automatic-session":
      return "Automatic · this session";
    case "automatic-default":
      return "Automatic · user default";
    case "paused":
      return "Automatic · paused";
    case "off":
      return "Off";
    default:
      return "Manual · ask before compacting";
  }
}

export function appendTranscriptEntry(
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
