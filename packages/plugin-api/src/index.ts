export {
  discoverPlugins,
  discoverPortableSkills,
  PluginError,
  resolvePluginEntry,
  selectPortableSkills,
} from "./discovery.js";
export {
  type LoadPluginHostOptions,
  loadPluginHost,
  PluginHost,
  type PromptContributionResult,
} from "./host.js";
export { pluginCapabilitySchema, pluginManifestSchema } from "./schema.js";
export {
  isProjectTrusted,
  loadPluginTrust,
  type PluginTrustStore,
  trustProject,
  untrustProject,
} from "./trust.js";
export type {
  DiscoveredPlugin,
  ForgePluginActivation,
  ForgePluginApi,
  ForgePluginModule,
  PluginCapability,
  PluginCommand,
  PluginCommandContext,
  PluginCommandResult,
  PluginManifest,
  PluginPolicyAction,
  PluginPolicyContribution,
  PluginPromptContext,
  PortableSkill,
} from "./types.js";
export { PLUGIN_API_VERSION } from "./types.js";
