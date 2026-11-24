import type {
  ContextStatus,
  InteractiveSessionPersistence,
} from "@forge/application/persistent-session";
import {
  formatSlashCommandHelp,
  parseSlashCommand,
} from "@forge/application/slash-commands";
import type { ProviderProfile } from "@forge/config";
import type {
  ModelConversationMessage,
  SessionApprovalStore,
} from "@forge/core";
import type { SessionSummary } from "@forge/persistence";
import type React from "react";
import type { AskOptions, WritableOutput } from "../ask.js";
import type {
  CodexCommandDependencies,
  discoverCodexModels,
} from "../codex-command.js";
import { createEditorState, type EditorState } from "../interactive-model.js";
import type { UpdateService, UpdateState } from "../update.js";
import {
  asPersistedReasoningEffort,
  type EffortChoice,
  effortsForModel,
  type LoginChoice,
  type ModelChoice,
  modelChoiceFor,
  providerModelChoices,
  type ReasoningEffort,
  STANDARD_EFFORTS,
  subscriptionModelChoices,
} from "./provider-choices.js";
import type { InteractiveSessionHost } from "./session-host.js";
import type {
  InteractivePhase as Phase,
  TranscriptEntry,
  TranscriptKind,
} from "./types.js";

export interface SlashCommandController {
  readonly activeOptions: AskOptions;
  readonly env: NodeJS.ProcessEnv;
  readonly cwd: string;
  readonly stdout: WritableOutput;
  readonly stderr: WritableOutput;
  readonly modelChoices: readonly ModelChoice[];
  readonly baseModelChoices: readonly ModelChoice[];
  readonly providerProfiles: Readonly<Record<string, ProviderProfile>>;
  readonly sessionPersistence?: InteractiveSessionPersistence;
  readonly sessionHost?: InteractiveSessionHost;
  readonly approvalStore: SessionApprovalStore;
  readonly updateState?: UpdateState;
  readonly updateService?: UpdateService;
  readonly conversationRef: { current: ModelConversationMessage[] };
  readonly nextTranscriptIdRef: { current: number };
  readonly discoverSubscriptionModels: typeof discoverCodexModels;
  readonly exit: (code: number) => void;
  readonly appendEntry: (
    kind: TranscriptKind,
    text: string,
    merge?: boolean,
  ) => void;
  readonly selectEffort: (effort: ReasoningEffort) => void;
  readonly setEditor: React.Dispatch<React.SetStateAction<EditorState>>;
  readonly setContextPanel: React.Dispatch<
    React.SetStateAction<ContextStatus | undefined>
  >;
  readonly setContextOfferDismissed: React.Dispatch<
    React.SetStateAction<boolean>
  >;
  readonly setContextActivity: React.Dispatch<
    React.SetStateAction<ContextStatus["pressure"]["state"] | undefined>
  >;
  readonly setStaticRenderRevision: React.Dispatch<
    React.SetStateAction<number>
  >;
  readonly setTranscript: React.Dispatch<
    React.SetStateAction<readonly TranscriptEntry[]>
  >;
  readonly setPermissionRevision: React.Dispatch<React.SetStateAction<number>>;
  readonly setSelectedIndex: React.Dispatch<React.SetStateAction<number>>;
  readonly setPhase: React.Dispatch<React.SetStateAction<Phase>>;
  readonly setPluginTrustIntent: React.Dispatch<
    React.SetStateAction<"trust" | "untrust" | undefined>
  >;
  readonly setSessions: React.Dispatch<
    React.SetStateAction<readonly SessionSummary[]>
  >;
  readonly setLoginKey: React.Dispatch<React.SetStateAction<string>>;
  readonly setLoginChoice: React.Dispatch<
    React.SetStateAction<LoginChoice | undefined>
  >;
  readonly setProviderSetupRoute: React.Dispatch<
    React.SetStateAction<string | undefined>
  >;
  readonly setSelectedProviderRoute: React.Dispatch<
    React.SetStateAction<string | undefined>
  >;
  readonly setModelQuery: React.Dispatch<React.SetStateAction<string>>;
  readonly setModelChoices: React.Dispatch<
    React.SetStateAction<readonly ModelChoice[]>
  >;
  readonly setModelsLoading: React.Dispatch<React.SetStateAction<boolean>>;
  readonly setPendingModelDeletion: React.Dispatch<
    React.SetStateAction<ModelChoice | undefined>
  >;
  readonly setDeleteModelReturnPhase: React.Dispatch<
    React.SetStateAction<"editing" | "provider-actions">
  >;
  readonly setEffortChoices: React.Dispatch<
    React.SetStateAction<readonly EffortChoice[]>
  >;
}

/** Dispatches a user-entered slash command against interactive session state. */
export function executeSlashCommand(
  command: string,
  ctx: SlashCommandController,
): void {
  const {
    activeOptions,
    env,
    cwd,
    stdout,
    stderr,
    modelChoices,
    baseModelChoices,
    providerProfiles,
    sessionPersistence,
    sessionHost,
    approvalStore,
    updateState,
    updateService,
    conversationRef,
    nextTranscriptIdRef,
    discoverSubscriptionModels,
    exit,
    appendEntry,
    selectEffort,
    setEditor,
    setContextPanel,
    setContextOfferDismissed,
    setContextActivity,
    setStaticRenderRevision,
    setTranscript,
    setPermissionRevision,
    setSelectedIndex,
    setPhase,
    setPluginTrustIntent,
    setSessions,
    setLoginKey,
    setLoginChoice,
    setProviderSetupRoute,
    setSelectedProviderRoute,
    setModelQuery,
    setModelChoices,
    setModelsLoading,
    setPendingModelDeletion,
    setDeleteModelReturnPhase,
    setEffortChoices,
  } = ctx;

  const parsed = parseSlashCommand(command);
  if (parsed.kind !== "command") {
    appendEntry(
      "warning",
      `Unknown command or invalid arguments: ${command.trim()}. Type /help for commands.`,
    );
    setEditor(createEditorState());
    return;
  }
  const normalizedCommand = command.trim();
  const codexDependencies: CodexCommandDependencies = {
    env,
    cwd,
    stdout,
    stderr,
    signal: new AbortController().signal,
    isTTY: true,
  };

  if (normalizedCommand.startsWith("/effort ")) {
    const requested = asPersistedReasoningEffort(
      normalizedCommand.slice("/effort ".length).trim().toLocaleLowerCase(),
    );
    if (!requested) {
      appendEntry(
        "warning",
        `Unsupported effort. Choose one of: ${STANDARD_EFFORTS.map(({ effort }) => effort).join(", ")}.`,
      );
      setEditor(createEditorState());
      return;
    }
    setEditor(createEditorState());
    if (
      activeOptions.engine === "codex" &&
      !modelChoiceFor(modelChoices, activeOptions)
    ) {
      void discoverSubscriptionModels(codexDependencies).then(
        (models) => {
          const subscriptionChoices = subscriptionModelChoices(models);
          setModelChoices([...subscriptionChoices, ...baseModelChoices]);
          const matching = modelChoiceFor(subscriptionChoices, activeOptions);
          if (!matching) {
            appendEntry(
              "warning",
              `Could not find effort metadata for ${activeOptions.model}.`,
            );
            return;
          }
          const supported = matching.supportedReasoningEfforts;
          if (supported.some(({ effort }) => effort === requested)) {
            selectEffort(requested);
          } else {
            appendEntry(
              "warning",
              `Unsupported effort for ${activeOptions.model}: ${requested}. Choose one of: ${supported.map(({ effort }) => effort).join(", ")}.`,
            );
          }
        },
        (error: unknown) =>
          appendEntry(
            "warning",
            `Could not discover supported effort levels: ${error instanceof Error ? error.message : "unknown error"}`,
          ),
      );
      return;
    }
    const supported = effortsForModel(modelChoices, activeOptions);
    if (!supported.some(({ effort }) => effort === requested)) {
      appendEntry(
        "warning",
        `Unsupported effort for ${activeOptions.model}: ${requested}. Choose one of: ${supported.map(({ effort }) => effort).join(", ")}.`,
      );
      return;
    }
    selectEffort(requested);
    return;
  }

  switch (normalizedCommand) {
    case "/exit":
      exit(0);
      return;
    case "/clear":
      conversationRef.current = [];
      sessionPersistence?.clear();
      setContextPanel(undefined);
      setContextOfferDismissed(false);
      setContextActivity(undefined);
      setStaticRenderRevision((current) => current + 1);
      setTranscript([]);
      nextTranscriptIdRef.current = 0;
      setEditor(createEditorState());
      return;
    case "/new":
      if (sessionHost) {
        setEditor(createEditorState());
        sessionHost.newSession();
        return;
      }
      conversationRef.current = [];
      sessionPersistence?.clear();
      setContextPanel(undefined);
      setContextOfferDismissed(false);
      setContextActivity(undefined);
      setStaticRenderRevision((current) => current + 1);
      setTranscript([]);
      nextTranscriptIdRef.current = 0;
      setEditor(createEditorState());
      approvalStore.clear();
      setPermissionRevision((current) => current + 1);
      appendEntry("system", "Started a new session.");
      return;
    case "/context":
      setEditor(createEditorState());
      if (sessionPersistence?.contextDetails) {
        setContextPanel(sessionPersistence.contextDetails());
      } else {
        appendEntry(
          "system",
          sessionPersistence?.contextStatus?.() ??
            "Context status is unavailable because persistence is disabled.",
        );
      }
      return;
    case "/permissions":
      setEditor(createEditorState());
      setSelectedIndex(0);
      setPhase("permissions");
      return;
    case "/update-dismiss":
      setEditor(createEditorState());
      if (updateState?.latestVersion && updateService) {
        void updateService.dismiss(updateState.latestVersion);
      }
      return;
    case "/plugins":
      setEditor(createEditorState());
      setSelectedIndex(0);
      setPluginTrustIntent(undefined);
      setPhase("plugins");
      return;
    case "/resources":
      setEditor(createEditorState());
      setPhase("resources");
      return;
    case "/compact --dry-run":
    case "/compact": {
      setEditor(createEditorState());
      if (!sessionPersistence?.compact) {
        appendEntry(
          "warning",
          "Compaction is unavailable because persistence is disabled.",
        );
        return;
      }
      const dryRun = normalizedCommand === "/compact --dry-run";
      void sessionPersistence.compact(dryRun).then(
        (message) => {
          appendEntry("system", message);
          if (sessionPersistence.contextDetails) {
            setContextPanel(sessionPersistence.contextDetails());
          }
        },
        (error: unknown) =>
          appendEntry(
            "error",
            `Could not compact session: ${error instanceof Error ? error.message : "unknown error"}`,
          ),
      );
      return;
    }
    case "/sessions":
    case "/resume":
      if (sessionHost) {
        setEditor(createEditorState());
        sessionHost.showSessions();
        return;
      }
      setEditor(createEditorState());
      setContextPanel(undefined);
      approvalStore.clear();
      setPermissionRevision((current) => current + 1);
      if (!sessionPersistence) {
        appendEntry("warning", "Persistent sessions are unavailable.\n");
        return;
      }
      setSessions([]);
      setPhase("resuming");
      setSelectedIndex(0);
      void sessionPersistence.list().then(
        (available) => {
          if (available.length === 0) {
            appendEntry(
              "system",
              "No saved session exists for this workspace.",
            );
            setPhase("editing");
            return;
          }
          setSessions(available);
        },
        (error: unknown) => {
          appendEntry(
            "error",
            `Could not list sessions: ${error instanceof Error ? error.message : "unknown error"}`,
          );
          setPhase("editing");
        },
      );
      return;
    case "/login":
      setEditor(createEditorState());
      setLoginKey("");
      setLoginChoice(undefined);
      setProviderSetupRoute(undefined);
      setSelectedProviderRoute(undefined);
      setSelectedIndex(0);
      setPhase("login-providers");
      return;
    case "/logout":
      setEditor(createEditorState());
      setSelectedIndex(0);
      setPhase("logout-providers");
      return;
    case "/model":
      setEditor(createEditorState());
      setSelectedIndex(0);
      setModelQuery("");
      setPhase("models");
      setModelsLoading(true);
      void discoverSubscriptionModels(codexDependencies).then(
        (models) => {
          const subscriptionChoices = subscriptionModelChoices(models);
          setModelChoices([
            ...subscriptionChoices.slice(0, 40),
            ...baseModelChoices,
          ]);
          setModelsLoading(false);
        },
        (error: unknown) => {
          appendEntry(
            "warning",
            `${error instanceof Error ? error.message : "Could not discover Codex models."} API models remain available.`,
          );
          setModelChoices(baseModelChoices);
          setModelsLoading(false);
        },
      );
      return;
    case "/delete-model": {
      setEditor(createEditorState());
      setSelectedIndex(0);
      setModelQuery("");
      setPendingModelDeletion(undefined);
      setDeleteModelReturnPhase("editing");
      const configured = providerModelChoices(providerProfiles);
      if (configured.length === 0) {
        appendEntry("system", "No configured provider model can be deleted.");
        return;
      }
      setModelChoices(configured);
      setPhase("delete-models");
      return;
    }
    case "/effort": {
      setEditor(createEditorState());
      const knownModel = modelChoiceFor(modelChoices, activeOptions);
      const availableEfforts =
        activeOptions.engine === "codex" && !knownModel
          ? []
          : effortsForModel(modelChoices, activeOptions);
      setEffortChoices(availableEfforts);
      setSelectedIndex(
        Math.max(
          0,
          availableEfforts.findIndex(
            ({ effort }) => effort === activeOptions.reasoningEffort,
          ),
        ),
      );
      setPhase("effort");
      if (activeOptions.engine === "codex") {
        void discoverSubscriptionModels(codexDependencies).then(
          (models) => {
            const subscriptionChoices = subscriptionModelChoices(models);
            setModelChoices([...subscriptionChoices, ...baseModelChoices]);
            const matching = modelChoiceFor(subscriptionChoices, activeOptions);
            if (!matching) {
              appendEntry(
                "warning",
                `Could not find effort metadata for ${activeOptions.model}.`,
              );
              setPhase("editing");
              return;
            }
            setEffortChoices(matching.supportedReasoningEfforts);
            setSelectedIndex(() => {
              const efforts = matching.supportedReasoningEfforts;
              return Math.max(
                0,
                efforts.findIndex(
                  ({ effort }) => effort === activeOptions.reasoningEffort,
                ),
              );
            });
          },
          () => undefined,
        );
      }
      return;
    }
    case "/help":
      appendEntry("system", formatSlashCommandHelp());
      setEditor(createEditorState());
      return;
    default:
      appendEntry(
        "warning",
        `Unknown command: ${command.trim()}. Type /help for commands.\n`,
      );
      setEditor(createEditorState());
  }
}
