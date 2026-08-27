import type {
  ApprovalDecisionKind,
  ForgeTool,
  RunEvent,
  ToolCall,
  ToolRisk,
} from "@forge/core";
import type { z } from "zod";

export const PLUGIN_API_VERSION = "1" as const;

export type PluginCapability =
  | "commands:register"
  | "events:observe"
  | "network:access"
  | "policy:restrict"
  | "prompt:contribute"
  | "subagents:register"
  | "tools:register";

export interface PluginManifest {
  readonly schemaVersion: 1;
  readonly apiVersion: typeof PLUGIN_API_VERSION;
  readonly name: string;
  readonly version: string;
  readonly entry: string;
  readonly capabilities: readonly PluginCapability[];
}

export interface DiscoveredPlugin {
  readonly scope: "user" | "project";
  readonly directory: string;
  readonly manifestPath: string;
  readonly manifest: PluginManifest;
}

export interface PluginCommandContext {
  readonly cwd: string;
  readonly workspaceRoot: string;
  readonly args: readonly string[];
  readonly signal: AbortSignal;
  write(text: string): void;
  writeError(text: string): void;
}

// biome-ignore lint/suspicious/noConfusingVoidType: synchronous and asynchronous handlers may intentionally omit an exit code.
export type PluginCommandResult = void | number | Promise<void | number>;

export interface PluginCommand {
  readonly name: string;
  readonly description: string;
  execute(context: PluginCommandContext): PluginCommandResult;
}

export interface PluginPromptContext {
  readonly prompt: string;
  readonly workspaceRoot: string;
  readonly workingDirectory: string;
}

export interface PluginPolicyAction {
  readonly tool: { readonly name: string; readonly risk: ToolRisk };
  readonly call: ToolCall;
  readonly input: unknown;
}

export interface PluginPolicyContribution {
  readonly kind: Exclude<ApprovalDecisionKind, "allow">;
  readonly reason: string;
}

export interface PluginSubagentDefinition {
  readonly name: string;
  readonly toolName: string;
  readonly description: string;
  readonly instructions: string;
  readonly tools: readonly string[];
  readonly limits?: {
    readonly maxModelSteps?: number;
    readonly maxToolCalls?: number;
  };
}

export interface RegisteredPluginSubagent extends PluginSubagentDefinition {
  readonly pluginName: string;
  readonly sourcePath: string;
}

export interface ForgePluginApi {
  readonly apiVersion: typeof PLUGIN_API_VERSION;
  readonly z: typeof z;
  registerTool(tool: ForgeTool): void;
  registerCommand(command: PluginCommand): void;
  registerSubagent(subagent: PluginSubagentDefinition): void;
  observeRunEvents(observer: (event: RunEvent) => void | Promise<void>): void;
  contributePrompt(
    hook: (
      context: PluginPromptContext,
    ) => string | undefined | Promise<string | undefined>,
  ): void;
  restrictPolicy(
    hook: (
      action: PluginPolicyAction,
    ) =>
      | PluginPolicyContribution
      | undefined
      | Promise<PluginPolicyContribution | undefined>,
  ): void;
}

export type ForgePluginActivation = (
  api: ForgePluginApi,
) => void | Promise<void>;

export interface ForgePluginModule {
  readonly activate?: ForgePluginActivation;
  readonly default?: ForgePluginActivation;
}
