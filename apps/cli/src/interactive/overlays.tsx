import type { DetectedStartupResources } from "@forge/application";
import type { ContextStatus } from "@forge/application/persistent-session";
import type { SlashCommand } from "@forge/application/slash-commands";
import { AuthenticationManager } from "@forge/auth";
import type { ProviderProfile } from "@forge/config";
import type { SessionApprovalStore } from "@forge/core";
import type {
  DiscoveredModel,
  DiscoverModelsRequest,
} from "@forge/model-compat";
import type { SessionSummary } from "@forge/persistence";
import { Box, Text } from "ink";
import type React from "react";
import type { AskOptions } from "../ask.js";
import type { EditorState } from "../interactive-model.js";
import { ProviderSetup, type ProviderSetupResult } from "../provider-setup.js";
import type {
  CommandApprovalPreview,
  NetworkApprovalPreview,
  SubagentApprovalPreview,
} from "../run.js";
import type { UpdateState } from "../update.js";
import { PermissionsPanel } from "./approvals.js";
import { ContextPanel, formatDuration, UpdateBanner } from "./display.js";
import { PromptWithCursor } from "./prompt.js";
import {
  type EffortChoice,
  type LoginChoice,
  type LogoutChoice,
  type ModelChoice,
  modelChoiceKey,
  type ProviderActionChoice,
  type ProviderRouteState,
  providerCapabilitySummary,
} from "./provider-choices.js";
import { SignInPanel } from "./providers.js";
import { PluginsPanel, PluginTrustPanel, ResourcesPanel } from "./resources.js";
import type { PendingSignIn, InteractivePhase as Phase } from "./types.js";

export interface PendingApproval {
  readonly prompt: string;
  readonly allowSession: boolean;
  readonly command?: CommandApprovalPreview;
  readonly network?: NetworkApprovalPreview;
  readonly subagent?: SubagentApprovalPreview;
  readonly resolve: (answer: string | null) => void;
}

export interface PhaseOverlaysProps {
  readonly phase: Phase;
  readonly cwd: string;
  readonly env: NodeJS.ProcessEnv;
  readonly activeOptions: AskOptions;
  readonly permissionProfileSource: string;
  readonly approvalStore: SessionApprovalStore;
  readonly selectedIndex: number;
  readonly permissionRevision: number;
  readonly resources: DetectedStartupResources;
  readonly pluginTrustIntent: "trust" | "untrust" | undefined;
  readonly approval: PendingApproval | undefined;
  readonly approvalFeedback: string;
  readonly updateState: UpdateState | undefined;
  readonly terminalWidth: number;
  readonly sessions: readonly SessionSummary[];
  readonly sessionDeletionConfirmed: boolean;
  readonly canDeleteSession: boolean;
  readonly modelQuery: string;
  readonly modelsLoading: boolean;
  readonly modelChoices: readonly ModelChoice[];
  readonly visibleModelChoices: readonly ModelChoice[];
  readonly selectedModelIndex: number;
  readonly pendingModelDeletion: ModelChoice | undefined;
  readonly effortChoices: readonly EffortChoice[];
  readonly loginChoices: readonly LoginChoice[];
  readonly selectedProviderRoute: string | undefined;
  readonly selectedProviderProfile: ProviderProfile | undefined;
  readonly selectedProviderState: ProviderRouteState | undefined;
  readonly providerActionChoices: readonly ProviderActionChoice[];
  readonly logoutChoices: readonly LogoutChoice[];
  readonly loginPrompt: PendingSignIn | undefined;
  readonly loginChoice: LoginChoice | undefined;
  readonly loginKey: string;
  readonly providerProfiles: Readonly<Record<string, ProviderProfile>>;
  readonly providerSetupRoute: string | undefined;
  readonly discoverProviderModels: (
    request: DiscoverModelsRequest,
  ) => Promise<readonly DiscoveredModel[]>;
  readonly onCancelProviderSetup: () => void;
  readonly onCompleteProviderSetup: (result: ProviderSetupResult) => void;
  readonly contextPanel: ContextStatus | undefined;
  readonly contextModeSelector: boolean;
  readonly contextModeSelection: number;
  readonly editor: EditorState;
  readonly completionKind: "file" | "command" | undefined;
  readonly visibleCandidates: readonly (string | SlashCommand)[];
  readonly fileCandidatesCount: number;
  readonly contextOfferVisible: boolean;
}

function PendingApprovalCard({
  approval,
  phase,
  approvalFeedback,
}: {
  readonly approval: PendingApproval;
  readonly phase: Phase;
  readonly approvalFeedback: string;
}): React.JSX.Element {
  return (
    <Box
      borderStyle="round"
      borderColor="yellow"
      flexDirection="column"
      paddingX={1}
    >
      <Text bold color="yellow">
        Approval required
      </Text>
      {approval.command ? (
        <Box flexDirection="column" marginY={1}>
          <Text bold>
            <Text color="cyan">$ </Text>
            {approval.command.command}
          </Text>
          <Text>
            <Text dimColor>Working directory</Text>
            {"  "}
            {approval.command.cwd}
          </Text>
          <Text>
            <Text dimColor>Timeout</Text>
            {"            "}
            {formatDuration(approval.command.timeoutMs)}
          </Text>
        </Box>
      ) : null}
      {approval.network ? (
        <Box flexDirection="column" marginY={1}>
          <Text bold>
            <Text color="cyan">Network </Text>
            {approval.network.tool}
          </Text>
          <Text>
            <Text dimColor>{approval.network.label}</Text>
            {"  "}
            {approval.network.value}
          </Text>
        </Box>
      ) : null}
      {approval.subagent ? (
        <Box flexDirection="column" marginY={1}>
          <Text bold>
            <Text color="cyan">Subagent </Text>
            {approval.subagent.tool}
          </Text>
          <Text>
            <Text dimColor>Task</Text>
            {"  "}
            {approval.subagent.task}
          </Text>
        </Box>
      ) : null}
      {phase === "approval-feedback" ? (
        <>
          <Text color="red">Deny with optional guidance</Text>
          <Text>{approvalFeedback || "_"}</Text>
          <Text dimColor>Enter deny · Esc deny without feedback</Text>
        </>
      ) : (
        <Text>{approval.prompt}</Text>
      )}
      {phase === "approving" ? (
        <Text>
          <Text bold color="green">
            1
          </Text>{" "}
          allow once
          {approval.allowSession ? (
            <>
              {" · "}
              <Text bold color="green">
                2
              </Text>{" "}
              allow displayed session scope
            </>
          ) : null}
          {" · "}
          <Text bold color="red">
            3
          </Text>{" "}
          deny
        </Text>
      ) : null}
    </Box>
  );
}

/** Renders the active interactive modal panel, prompt composer, and completion menu. */
export function PhaseOverlays(props: PhaseOverlaysProps): React.JSX.Element {
  const {
    phase,
    cwd,
    env,
    activeOptions,
    permissionProfileSource,
    approvalStore,
    selectedIndex,
    permissionRevision,
    resources,
    pluginTrustIntent,
    approval,
    approvalFeedback,
    updateState,
    terminalWidth,
    sessions,
    sessionDeletionConfirmed,
    canDeleteSession,
    modelQuery,
    modelsLoading,
    modelChoices,
    visibleModelChoices,
    selectedModelIndex,
    pendingModelDeletion,
    effortChoices,
    loginChoices,
    selectedProviderRoute,
    selectedProviderProfile,
    selectedProviderState,
    providerActionChoices,
    logoutChoices,
    loginPrompt,
    loginChoice,
    loginKey,
    providerProfiles,
    providerSetupRoute,
    discoverProviderModels,
    onCancelProviderSetup,
    onCompleteProviderSetup,
    contextPanel,
    contextModeSelector,
    contextModeSelection,
    editor,
    completionKind,
    visibleCandidates,
    fileCandidatesCount,
    contextOfferVisible,
  } = props;

  return (
    <>
      {contextPanel ? (
        <ContextPanel
          status={contextPanel}
          modeSelector={contextModeSelector}
          selectedModeIndex={contextModeSelection}
        />
      ) : null}

      {phase === "plugins" ? <PluginsPanel resources={resources} /> : null}

      {phase === "resources" ? <ResourcesPanel resources={resources} /> : null}

      {phase === "permissions" ? (
        <PermissionsPanel
          profile={activeOptions.permissionProfile ?? "safe"}
          provenance={permissionProfileSource}
          grants={approvalStore.list()}
          selectedIndex={selectedIndex}
          revision={permissionRevision}
        />
      ) : null}

      {phase === "plugin-trust" && pluginTrustIntent ? (
        <PluginTrustPanel
          cwd={cwd}
          intent={pluginTrustIntent}
          resources={resources}
        />
      ) : null}

      {(phase === "approving" || phase === "approval-feedback") && approval ? (
        <PendingApprovalCard
          approval={approval}
          phase={phase}
          approvalFeedback={approvalFeedback}
        />
      ) : null}

      {updateState?.state === "available" &&
      updateState.latestVersion &&
      !updateState.dismissed ? (
        <UpdateBanner state={updateState} terminalWidth={terminalWidth} />
      ) : null}

      {phase === "delete-session-confirm" ? (
        <Box
          borderStyle="round"
          borderColor="yellow"
          flexDirection="column"
          paddingX={1}
        >
          <Text bold>Delete “{sessions[selectedIndex]?.title}”?</Text>
          <Text>
            Local conversation, run records and traces will be permanently
            deleted.
          </Text>
          <Text>
            Project files and external engine history remain unchanged.
          </Text>
          <Text>
            {sessionDeletionConfirmed
              ? "  Cancel    › Delete"
              : "› Cancel      Delete"}
          </Text>
          <Text dimColor>←→ choose · Enter confirm · Esc cancel</Text>
        </Box>
      ) : null}
      {phase === "deleting-session" ? <Text>Deleting session…</Text> : null}
      {phase === "resuming" ? (
        <Box
          borderStyle="round"
          borderColor="cyan"
          flexDirection="column"
          paddingX={1}
        >
          <Text bold color="cyan">
            Saved sessions
          </Text>
          {sessions.length === 0 ? (
            <Text dimColor>Loading sessions…</Text>
          ) : null}
          {sessions
            .slice(
              Math.floor(selectedIndex / 10) * 10,
              Math.floor(selectedIndex / 10) * 10 + 10,
            )
            .map((session, offset) => {
              const index = Math.floor(selectedIndex / 10) * 10 + offset;
              return (
                <Text
                  key={session.id}
                  bold={index === selectedIndex}
                  {...(index === selectedIndex
                    ? { color: "cyan" as const }
                    : {})}
                >
                  {index === selectedIndex ? "› " : "  "}
                  {session.title} · {session.updatedAt} ·{" "}
                  {session.id.slice(0, 8)}
                </Text>
              );
            })}
          <Text dimColor>
            Page {Math.floor(selectedIndex / 10) + 1}/
            {Math.max(1, Math.ceil(sessions.length / 10))} · ←→ page · Enter
            resume{canDeleteSession ? " · Ctrl+D delete" : ""} · Esc cancel
          </Text>
        </Box>
      ) : null}

      {phase === "models" ? (
        <Box
          borderStyle="round"
          borderColor="cyan"
          flexDirection="column"
          paddingX={1}
        >
          <Text bold color="cyan">
            Choose model
          </Text>
          <Text>
            Search models: <Text color="cyan">{modelQuery || "_"}</Text>
          </Text>
          {modelsLoading ? (
            <Text dimColor>Discovering ChatGPT subscription models…</Text>
          ) : null}
          {modelQuery.trim() !== "" ? (
            <Text dimColor>
              Showing {visibleModelChoices.length} of {modelChoices.length}{" "}
              matches
            </Text>
          ) : null}
          {visibleModelChoices.length === 0 ? (
            <Text dimColor>No matching models.</Text>
          ) : null}
          {visibleModelChoices.map((choice, index) => (
            <Text
              key={modelChoiceKey(choice)}
              bold={index === selectedModelIndex}
              {...(index === selectedModelIndex
                ? { color: "cyan" as const }
                : {})}
            >
              {index === selectedModelIndex ? "› " : "  "}
              {choice.label} · {choice.description}
            </Text>
          ))}
          <Text dimColor>
            ChatGPT entries use Codex Engine; OpenAI API-key entries are billed
            separately · Type to fuzzy search · Enter select · Esc cancel
          </Text>
        </Box>
      ) : null}

      {phase === "delete-models" ? (
        <Box
          borderStyle="round"
          borderColor="red"
          flexDirection="column"
          paddingX={1}
        >
          <Text bold color="red">
            Delete configured provider model
          </Text>
          <Text>
            Search models: <Text color="cyan">{modelQuery || "_"}</Text>
          </Text>
          {visibleModelChoices.length === 0 ? (
            <Text dimColor>No matching configured models.</Text>
          ) : null}
          {visibleModelChoices.map((choice, index) => (
            <Text
              key={modelChoiceKey(choice)}
              bold={index === selectedModelIndex}
              {...(index === selectedModelIndex
                ? { color: "red" as const }
                : {})}
            >
              {index === selectedModelIndex ? "› " : "  "}
              {choice.label} · {choice.description}
            </Text>
          ))}
          <Text dimColor>
            Type to fuzzy search · Enter review deletion · Esc cancel
          </Text>
        </Box>
      ) : null}

      {phase === "delete-model-confirm" && pendingModelDeletion ? (
        <Box
          borderStyle="round"
          borderColor="red"
          flexDirection="column"
          paddingX={1}
        >
          <Text bold color="red">
            Delete model configuration?
          </Text>
          <Text>
            {pendingModelDeletion.selection.provider}/
            {pendingModelDeletion.selection.id}
          </Text>
          <Text dimColor>
            The provider route and stored credential will remain.
          </Text>
          <Text>
            <Text bold color="red">
              y
            </Text>{" "}
            delete · <Text bold>n</Text> cancel
          </Text>
        </Box>
      ) : null}

      {phase === "effort" ? (
        <Box
          borderStyle="round"
          borderColor="cyan"
          flexDirection="column"
          paddingX={1}
        >
          <Text bold color="cyan">
            Choose thinking effort
          </Text>
          <Text dimColor>{activeOptions.model ?? "Current model"}</Text>
          {effortChoices.length === 0 ? (
            <Text dimColor>Discovering supported effort levels…</Text>
          ) : null}
          {effortChoices.map((choice, index) => (
            <Text
              key={choice.effort}
              bold={index === selectedIndex}
              {...(index === selectedIndex ? { color: "cyan" as const } : {})}
            >
              {index === selectedIndex ? "› " : "  "}
              {choice.effort} · {choice.description}
              {choice.effort === activeOptions.reasoningEffort
                ? " · current"
                : ""}
            </Text>
          ))}
          <Text dimColor>
            ↑/↓ or ←/→ adjust · Enter select · Esc cancel · /effort
            &lt;level&gt; also works
          </Text>
        </Box>
      ) : null}

      {phase === "login-providers" ? (
        <Box
          borderStyle="round"
          borderColor="cyan"
          flexDirection="column"
          paddingX={1}
        >
          <Text bold color="cyan">
            Choose model provider
          </Text>
          {loginChoices.map((choice, index) => (
            <Box
              key={`${choice.kind}:${choice.route ?? choice.provider ?? choice.label}`}
              flexDirection="column"
            >
              <Text
                bold={index === selectedIndex}
                {...(index === selectedIndex ? { color: "cyan" as const } : {})}
              >
                {index === selectedIndex ? "› " : "  "}
                {choice.label} · {choice.description}
              </Text>
              {choice.details ? (
                <Text
                  dimColor
                  {...(index === selectedIndex
                    ? { color: "cyan" as const }
                    : {})}
                >
                  {"    "}
                  {choice.details}
                </Text>
              ) : null}
            </Box>
          ))}
          <Text dimColor>Enter continue · Esc cancel</Text>
        </Box>
      ) : null}

      {phase === "provider-actions" &&
      selectedProviderRoute &&
      selectedProviderProfile &&
      selectedProviderState ? (
        <Box
          borderStyle="round"
          borderColor="cyan"
          flexDirection="column"
          paddingX={1}
        >
          <Text bold color="cyan">
            Manage provider · {selectedProviderRoute}
          </Text>
          <Text>
            {selectedProviderState.label} ·{" "}
            {selectedProviderProfile.models?.length ?? 0} models
          </Text>
          <Text dimColor>{selectedProviderProfile.baseUrl}</Text>
          <Text dimColor>
            {providerCapabilitySummary(selectedProviderProfile)}
          </Text>
          {providerActionChoices.map((action, index) => (
            <Text
              key={action.kind}
              bold={index === selectedIndex}
              {...(index === selectedIndex ? { color: "cyan" as const } : {})}
            >
              {index === selectedIndex ? "› " : "  "}
              {action.label} · {action.description}
            </Text>
          ))}
          <Text dimColor>Enter continue · Esc back</Text>
        </Box>
      ) : null}

      {phase === "provider-remove-confirm" &&
      selectedProviderRoute &&
      selectedProviderProfile ? (
        <Box
          borderStyle="round"
          borderColor="red"
          flexDirection="column"
          paddingX={1}
        >
          <Text bold color="red">
            Remove provider "{selectedProviderRoute}"?
          </Text>
          <Text>{selectedProviderProfile.baseUrl}</Text>
          <Text dimColor>
            This deletes the route, all configured models, and its stored
            credential. Environment variables cannot be removed by Forge.
          </Text>
          <Text>
            <Text bold color="red">
              y
            </Text>{" "}
            remove · <Text bold>n</Text> cancel
          </Text>
        </Box>
      ) : null}

      {phase === "logout-providers" ? (
        <Box
          borderStyle="round"
          borderColor="cyan"
          flexDirection="column"
          paddingX={1}
        >
          <Text bold color="cyan">
            Log out provider
          </Text>
          {logoutChoices.map((choice, index) => (
            <Text
              key={`${choice.kind}:${choice.provider}`}
              bold={index === selectedIndex}
              {...(index === selectedIndex ? { color: "cyan" as const } : {})}
            >
              {index === selectedIndex ? "› " : "  "}
              {choice.label} · {choice.description}
            </Text>
          ))}
          <Text dimColor>
            Removes stored credentials only · environment variables remain ·
            Enter log out · Esc cancel
          </Text>
        </Box>
      ) : null}

      {loginPrompt ? <SignInPanel prompt={loginPrompt} env={env} /> : null}

      {phase === "login-key" && loginChoice?.provider ? (
        <Box
          borderStyle="round"
          borderColor="cyan"
          flexDirection="column"
          paddingX={1}
        >
          <Text bold color="cyan">
            Enter {loginChoice.label} key
          </Text>
          <Text>
            API key:{" "}
            <Text color="cyan">
              {loginKey ? "•".repeat(Array.from(loginKey).length) : "_"}
            </Text>
          </Text>
          <Text dimColor>
            Saved under $FORGE_HOME/auth.json with owner-only permissions. The
            key is never shown in the transcript.
          </Text>
          <Text dimColor>Enter save · Esc back</Text>
        </Box>
      ) : null}

      {phase === "provider-setup" ? (
        <ProviderSetup
          existingProviders={providerProfiles}
          {...(providerSetupRoute ? { initialRoute: providerSetupRoute } : {})}
          discover={discoverProviderModels}
          hasExistingCredential={(route, profile) =>
            profile.auth.type === "none" ||
            new AuthenticationManager(env).status(route, {
              endpoint: profile.baseUrl,
              ...(profile.auth.type === "bearer" && profile.auth.apiKeyEnv
                ? { environmentVariable: profile.auth.apiKeyEnv }
                : {}),
            }).authenticated
          }
          discoverExisting={async ({ route, profile, signal }) => {
            const apiKey =
              profile.auth.type === "bearer"
                ? new AuthenticationManager(env).requireApiKey(route, {
                    endpoint: profile.baseUrl,
                    ...(profile.auth.apiKeyEnv
                      ? { environmentVariable: profile.auth.apiKeyEnv }
                      : {}),
                  }).apiKey
                : undefined;
            return discoverProviderModels({
              api: profile.api,
              baseUrl: profile.baseUrl,
              ...(apiKey === undefined ? {} : { apiKey }),
              signal,
            });
          }}
          onCancel={onCancelProviderSetup}
          onComplete={onCompleteProviderSetup}
        />
      ) : null}

      {phase !== "login-providers" &&
      phase !== "login-key" &&
      phase !== "provider-setup" ? (
        <Box
          borderStyle="round"
          borderColor={phase === "editing" ? "green" : "gray"}
          paddingX={1}
          flexDirection="column"
          marginTop={1}
        >
          {editor.images.length > 0 ? (
            <Text color="cyan">
              {editor.images
                .map(
                  ({ filename }, index) => `[Image #${index + 1}] ${filename}`,
                )
                .join("  ")}
            </Text>
          ) : null}
          <Box>
            <Text color="green">❯ </Text>
            <PromptWithCursor state={editor} active={phase === "editing"} />
          </Box>
        </Box>
      ) : null}

      {phase === "editing" && completionKind && visibleCandidates.length > 0 ? (
        <Box
          borderStyle="single"
          borderColor="gray"
          flexDirection="column"
          paddingX={1}
        >
          {visibleCandidates.map((candidate, index) => {
            const label =
              typeof candidate === "string" ? candidate : candidate.name;
            const description =
              typeof candidate === "string" ? "" : candidate.description;
            return (
              <Text
                key={label}
                bold={index === selectedIndex}
                {...(index === selectedIndex ? { color: "cyan" as const } : {})}
              >
                {index === selectedIndex ? "› " : "  "}
                {label}
                {description ? `  ${description}` : ""}
              </Text>
            );
          })}
          {completionKind === "file" && fileCandidatesCount > 10 ? (
            <Text dimColor> More matches—keep typing to narrow the list</Text>
          ) : null}
        </Box>
      ) : null}

      {contextOfferVisible ? (
        <Box paddingX={1}>
          <Text color="yellow">
            Context is nearing its limit · <Text bold>c</Text> compact once ·{" "}
            <Text bold>a</Text> auto for session · <Text bold>d</Text> dismiss
          </Text>
        </Box>
      ) : null}
    </>
  );
}
