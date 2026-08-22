import type { z } from "zod";

export type ToolRisk = "network" | "process" | "read" | "write";

export interface WorkspaceContext {
  readonly root: string;
  readonly cwd: string;
}

export interface ToolLimits {
  readonly maxOutputBytes: number;
  readonly maxEntries: number;
  readonly commandTimeoutMs?: number;
}

export interface ToolContext {
  readonly workspace: WorkspaceContext;
  readonly signal: AbortSignal;
  readonly limits: ToolLimits;
}

export interface ModelToolDefinition {
  readonly name: string;
  readonly description: string;
  readonly inputSchema: z.ZodType;
}

export interface ForgeTool {
  readonly name: string;
  readonly description: string;
  readonly inputSchema: z.ZodType;
  readonly risk: ToolRisk;
  execute(input: unknown, context: ToolContext): Promise<ToolResult>;
}

export interface ToolCall {
  readonly id: string;
  readonly name: string;
  readonly input: unknown;
  readonly providerMetadata?: Readonly<Record<string, unknown>>;
}

export interface ToolProposal {
  readonly call: ToolCall;
  readonly tool: ForgeTool;
  readonly input: unknown;
}

export type ToolErrorCode =
  | "already_exists"
  | "cancelled"
  | "invalid_input"
  | "io_error"
  | "not_directory"
  | "not_file"
  | "not_found"
  | "outside_workspace"
  | "output_limit"
  | "process_error"
  | "stale_patch"
  | "timed_out"
  | "unknown_tool";

export interface ToolError {
  readonly code: ToolErrorCode;
  readonly message: string;
  readonly retryable: boolean;
}

export type ToolResult<T = unknown> =
  | {
      readonly ok: true;
      readonly output: T;
      readonly truncated: boolean;
    }
  | {
      readonly ok: false;
      readonly error: ToolError;
    };

export type ToolProposalResult =
  | { readonly ok: true; readonly proposal: ToolProposal }
  | { readonly ok: false; readonly error: ToolError };
