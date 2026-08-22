import path from "node:path";
import { pathToFileURL } from "node:url";

import type {
  ApprovalPolicy,
  ForgeTool,
  ProposedAction,
  RunEvent,
} from "@forge/core";
import { z } from "zod";

import {
  discoverPlugins,
  PluginError,
  resolvePluginEntry,
} from "./discovery.js";
import { isProjectTrusted } from "./trust.js";
import {
  type DiscoveredPlugin,
  type ForgePluginApi,
  type ForgePluginModule,
  PLUGIN_API_VERSION,
  type PluginCapability,
  type PluginCommand,
  type PluginPolicyAction,
  type PluginPolicyContribution,
  type PluginPromptContext,
} from "./types.js";

interface RegisteredPromptHook {
  readonly plugin: DiscoveredPlugin;
  readonly hook: NonNullable<Parameters<ForgePluginApi["contributePrompt"]>[0]>;
}

interface RegisteredPolicyHook {
  readonly plugin: DiscoveredPlugin;
  readonly hook: NonNullable<Parameters<ForgePluginApi["restrictPolicy"]>[0]>;
}

interface RegisteredObserver {
  readonly plugin: DiscoveredPlugin;
  readonly observer: NonNullable<
    Parameters<ForgePluginApi["observeRunEvents"]>[0]
  >;
}

export interface PromptContributionResult {
  readonly prompt: string;
  readonly sourcePaths: readonly string[];
}

export interface LoadPluginHostOptions {
  readonly forgeHome: string;
  readonly workspaceRoot: string;
  readonly enabledUserPlugins: readonly string[];
  readonly reservedToolNames?: readonly string[];
}

export class PluginHost {
  readonly tools: readonly ForgeTool[];
  readonly commands: readonly PluginCommand[];
  readonly loadedPlugins: readonly DiscoveredPlugin[];
  readonly warnings: readonly string[];
  readonly #promptHooks: readonly RegisteredPromptHook[];
  readonly #policyHooks: readonly RegisteredPolicyHook[];
  readonly #observers: readonly RegisteredObserver[];

  constructor(state: {
    tools: readonly ForgeTool[];
    commands: readonly PluginCommand[];
    plugins: readonly DiscoveredPlugin[];
    warnings: readonly string[];
    promptHooks: readonly RegisteredPromptHook[];
    policyHooks: readonly RegisteredPolicyHook[];
    observers: readonly RegisteredObserver[];
  }) {
    this.tools = state.tools;
    this.commands = state.commands;
    this.loadedPlugins = state.plugins;
    this.warnings = state.warnings;
    this.#promptHooks = state.promptHooks;
    this.#policyHooks = state.policyHooks;
    this.#observers = state.observers;
  }

  async promptContributions(
    context: PluginPromptContext,
  ): Promise<PromptContributionResult> {
    const contributions: string[] = [];
    const sourcePaths: string[] = [];
    for (const registered of this.#promptHooks) {
      let contribution: string | undefined;
      try {
        contribution = await registered.hook(
          deepFreeze(structuredClone(context)),
        );
      } catch (error) {
        throw new PluginError(
          `Prompt hook failed in plugin "${registered.plugin.manifest.name}".`,
          registered.plugin.manifestPath,
          { cause: error },
        );
      }
      if (contribution === undefined || contribution.trim() === "") continue;
      if (Buffer.byteLength(contribution) > 32_768) {
        throw new PluginError(
          `Prompt contribution from plugin "${registered.plugin.manifest.name}" exceeds 32768 bytes.`,
          registered.plugin.manifestPath,
        );
      }
      contributions.push(
        `Plugin instructions from ${registered.plugin.manifestPath}:\n${contribution}`,
      );
      sourcePaths.push(registered.plugin.manifestPath);
    }
    return { prompt: contributions.join("\n\n"), sourcePaths };
  }

  extendPolicy(core: ApprovalPolicy): ApprovalPolicy {
    if (this.#policyHooks.length === 0) return core;
    const hooks = this.#policyHooks;
    return {
      evaluate: async (action, signal) => {
        const base = await core.evaluate(action, signal);
        if (base.kind === "deny") return base;
        let effective = base;
        for (const registered of hooks) {
          const snapshot = policySnapshot(action);
          let contribution: PluginPolicyContribution | undefined;
          try {
            contribution = await registered.hook(snapshot);
          } catch (error) {
            throw new PluginError(
              `Policy hook failed in plugin "${registered.plugin.manifest.name}".`,
              registered.plugin.manifestPath,
              { cause: error },
            );
          }
          if (!contribution) continue;
          validatePolicyContribution(contribution, registered.plugin);
          if (contribution.kind === "deny" || effective.kind === "allow") {
            effective = {
              kind: contribution.kind,
              reason: `${registered.plugin.manifest.name}: ${contribution.reason}`,
            };
          }
          if (effective.kind === "deny") break;
        }
        return effective;
      },
      ...(core.recordApproval
        ? { recordApproval: (action) => core.recordApproval?.(action) }
        : {}),
    };
  }

  async observe(event: RunEvent): Promise<readonly string[]> {
    const warnings: string[] = [];
    for (const registered of this.#observers) {
      try {
        await registered.observer(deepFreeze(structuredClone(event)));
      } catch {
        warnings.push(
          `Observer in plugin "${registered.plugin.manifest.name}" failed.`,
        );
      }
    }
    return warnings;
  }
}

export async function loadPluginHost(
  options: LoadPluginHostOptions,
): Promise<PluginHost> {
  const userPlugins = await discoverPlugins({
    root: path.join(options.forgeHome, "plugins"),
    scope: "user",
    names: options.enabledUserPlugins,
  });
  const projectPlugins = await discoverPlugins({
    root: path.join(options.workspaceRoot, ".forge", "plugins"),
    scope: "project",
  });
  const projectTrusted =
    projectPlugins.length > 0 &&
    (await isProjectTrusted(options.forgeHome, options.workspaceRoot));
  const warnings =
    projectPlugins.length > 0 && !projectTrusted
      ? [
          `Skipped ${projectPlugins.length} project plugin(s): trust this canonical workspace with \`forge plugins trust\` first.`,
        ]
      : [];
  const selected = [...userPlugins, ...(projectTrusted ? projectPlugins : [])];
  return activatePlugins(selected, options.reservedToolNames ?? [], warnings);
}

async function activatePlugins(
  plugins: readonly DiscoveredPlugin[],
  reservedToolNames: readonly string[],
  warnings: readonly string[],
): Promise<PluginHost> {
  const tools: ForgeTool[] = [];
  const commands: PluginCommand[] = [];
  const promptHooks: RegisteredPromptHook[] = [];
  const policyHooks: RegisteredPolicyHook[] = [];
  const observers: RegisteredObserver[] = [];
  const toolNames = new Set(reservedToolNames);
  const commandNames = new Set<string>();
  const pluginNames = new Set<string>();

  for (const plugin of plugins) {
    if (pluginNames.has(plugin.manifest.name)) {
      throw new PluginError(
        `Duplicate loaded plugin name "${plugin.manifest.name}".`,
        plugin.manifestPath,
      );
    }
    pluginNames.add(plugin.manifest.name);
    const entry = await resolvePluginEntry(plugin);
    let module: ForgePluginModule;
    try {
      module = (await import(pathToFileURL(entry).href)) as ForgePluginModule;
    } catch (error) {
      throw new PluginError(
        `Could not load plugin "${plugin.manifest.name}" from ${entry}.`,
        entry,
        {
          cause: error,
        },
      );
    }
    const activate = module.activate ?? module.default;
    if (typeof activate !== "function") {
      throw new PluginError(
        `Plugin "${plugin.manifest.name}" must export an activate function or a default activation function.`,
        entry,
      );
    }
    const capabilities = new Set<PluginCapability>(
      plugin.manifest.capabilities,
    );
    const requireCapability = (capability: PluginCapability): void => {
      if (!capabilities.has(capability)) {
        throw new PluginError(
          `Plugin "${plugin.manifest.name}" used undeclared capability "${capability}".`,
          plugin.manifestPath,
        );
      }
    };
    const api: ForgePluginApi = Object.freeze({
      apiVersion: PLUGIN_API_VERSION,
      z,
      registerTool: (tool: ForgeTool) => {
        requireCapability("tools:register");
        validateTool(tool, plugin);
        if (toolNames.has(tool.name)) {
          throw new PluginError(
            `Plugin tool name "${tool.name}" is already registered.`,
            plugin.manifestPath,
          );
        }
        toolNames.add(tool.name);
        tools.push(Object.freeze(tool));
      },
      registerCommand: (command: PluginCommand) => {
        requireCapability("commands:register");
        validateCommand(command, plugin);
        if (commandNames.has(command.name)) {
          throw new PluginError(
            `Plugin command name "${command.name}" is already registered.`,
            plugin.manifestPath,
          );
        }
        commandNames.add(command.name);
        commands.push(Object.freeze(command));
      },
      observeRunEvents: (observer: RegisteredObserver["observer"]) => {
        requireCapability("events:observe");
        if (typeof observer !== "function")
          throw new PluginError(
            "Plugin event observer must be a function.",
            plugin.manifestPath,
          );
        observers.push({ plugin, observer });
      },
      contributePrompt: (hook: RegisteredPromptHook["hook"]) => {
        requireCapability("prompt:contribute");
        if (typeof hook !== "function")
          throw new PluginError(
            "Plugin prompt hook must be a function.",
            plugin.manifestPath,
          );
        promptHooks.push({ plugin, hook });
      },
      restrictPolicy: (hook: RegisteredPolicyHook["hook"]) => {
        requireCapability("policy:restrict");
        if (typeof hook !== "function")
          throw new PluginError(
            "Plugin policy hook must be a function.",
            plugin.manifestPath,
          );
        policyHooks.push({ plugin, hook });
      },
    });
    try {
      await activate(api);
    } catch (error) {
      if (error instanceof PluginError) throw error;
      throw new PluginError(
        `Activation failed for plugin "${plugin.manifest.name}".`,
        entry,
        { cause: error },
      );
    }
  }

  return new PluginHost({
    tools,
    commands,
    plugins,
    warnings,
    promptHooks,
    policyHooks,
    observers,
  });
}

function policySnapshot(action: ProposedAction): PluginPolicyAction {
  return deepFreeze({
    tool: { name: action.tool.name, risk: action.tool.risk },
    call: structuredClone(action.call),
    input: structuredClone(action.input),
  });
}

function validatePolicyContribution(
  contribution: PluginPolicyContribution,
  plugin: DiscoveredPlugin,
): void {
  if (
    (contribution.kind !== "confirm" && contribution.kind !== "deny") ||
    typeof contribution.reason !== "string" ||
    contribution.reason.trim() === ""
  ) {
    throw new PluginError(
      `Plugin "${plugin.manifest.name}" returned an invalid policy contribution; only confirm or deny is accepted.`,
      plugin.manifestPath,
    );
  }
}

function validateTool(tool: ForgeTool, plugin: DiscoveredPlugin): void {
  if (
    !tool ||
    !/^[a-z][a-z0-9_]{0,63}$/u.test(tool.name) ||
    typeof tool.description !== "string" ||
    !["network", "read", "write", "process"].includes(tool.risk) ||
    typeof tool.execute !== "function" ||
    !tool.inputSchema ||
    typeof tool.inputSchema.safeParse !== "function"
  ) {
    throw new PluginError(
      `Plugin "${plugin.manifest.name}" registered an invalid tool.`,
      plugin.manifestPath,
    );
  }
  if (
    tool.risk === "network" &&
    !plugin.manifest.capabilities.includes("network:access")
  ) {
    throw new PluginError(
      `Plugin "${plugin.manifest.name}" registered a network tool without declaring capability "network:access".`,
      plugin.manifestPath,
    );
  }
}

function validateCommand(
  command: PluginCommand,
  plugin: DiscoveredPlugin,
): void {
  if (
    !command ||
    !/^[a-z][a-z0-9-]{0,63}$/u.test(command.name) ||
    typeof command.description !== "string" ||
    command.description.trim() === "" ||
    typeof command.execute !== "function"
  ) {
    throw new PluginError(
      `Plugin "${plugin.manifest.name}" registered an invalid command.`,
      plugin.manifestPath,
    );
  }
}

function deepFreeze<T>(value: T): T {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const nested of Object.values(value as Record<string, unknown>))
      deepFreeze(nested);
  }
  return value;
}
