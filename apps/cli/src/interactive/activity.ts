import type { ToolCall } from "@forge/core";

import type { RunActivity } from "./types.js";

export function toolRunActivity(
  call: Pick<ToolCall, "name" | "input">,
  stage: "preparing" | "executing",
): RunActivity {
  const target = toolActivityTarget(call);
  const operation =
    call.name === "edit_file" && isRecord(call.input)
      ? stringInputField(call.input, "operation")
      : undefined;
  return {
    kind: "tool",
    stage,
    toolName: call.name,
    ...(target ? { target } : {}),
    ...(operation === "create" ||
    operation === "replace" ||
    operation === "rewrite"
      ? { operation }
      : {}),
  };
}

export function formatToolCallSummary(
  call: Pick<ToolCall, "name" | "input">,
): string {
  if (call.name !== "edit_file" || !isRecord(call.input)) return call.name;
  const operation = stringInputField(call.input, "operation");
  const path = stringInputField(call.input, "path");
  return [call.name, operation, path].filter(Boolean).join(" · ");
}

export function formatRunActivity(activity: RunActivity | undefined): string {
  if (!activity) return "Working…";
  if (activity.kind === "thinking") {
    return activity.step ? `Thinking · step ${activity.step}…` : "Thinking…";
  }
  const target = activity.target ? ` · ${activity.target}` : "";
  if (activity.toolName === "edit_file") {
    if (activity.operation === "create") {
      return `${activity.stage === "preparing" ? "Preparing file creation" : "Creating file"}${target}`;
    }
    if (activity.operation === "rewrite") {
      return `${activity.stage === "preparing" ? "Preparing file rewrite" : "Rewriting file"}${target}`;
    }
    return `${activity.stage === "preparing" ? "Preparing file edit" : "Editing file"}${target}`;
  }
  if (activity.toolName === "apply_patch") {
    return `${activity.stage === "preparing" ? "Preparing file edit" : "Editing file"}${target}`;
  }
  if (activity.toolName === "create_file") {
    return `${activity.stage === "preparing" ? "Preparing file creation" : "Creating file"}${target}`;
  }
  return `${activity.stage === "preparing" ? "Preparing" : "Running"} ${activity.toolName}${target}`;
}

function toolActivityTarget(
  call: Pick<ToolCall, "name" | "input">,
): string | undefined {
  if (!isRecord(call.input)) return undefined;
  const path = stringInputField(call.input, "path");
  if (
    (call.name === "edit_file" ||
      call.name === "apply_patch" ||
      call.name === "create_file" ||
      call.name === "read_file") &&
    path
  ) {
    return path;
  }
  if (call.name === "run_command") {
    const program = stringInputField(call.input, "program");
    // biome-ignore lint/complexity/useLiteralKeys: strict TypeScript requires bracket access on this unknown input record.
    const args = call.input["args"];
    if (program && Array.isArray(args)) {
      return [
        program,
        ...args.filter(
          (argument): argument is string => typeof argument === "string",
        ),
      ].join(" ");
    }
    return program;
  }
  return undefined;
}

function stringInputField(
  input: Record<string, unknown>,
  key: string,
): string | undefined {
  const value = input[key];
  return typeof value === "string" && value.trim() !== "" ? value : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
