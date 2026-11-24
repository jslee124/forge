import type { DetectedStartupResources } from "@forge/application";
import type {
  ContextStatus,
  InteractiveSessionPersistence,
} from "@forge/application/persistent-session";
import type { SlashCommand } from "@forge/application/slash-commands";
import type { ApiKeyProvider } from "@forge/auth";
import type { PersistedModelSelection, ProviderProfile } from "@forge/config";
import type {
  ModelConversationMessage,
  SessionApprovalStore,
} from "@forge/core";
import type { SessionSummary } from "@forge/persistence";
import type { Key } from "ink";
import type React from "react";
import type { AskOptions, WritableOutput } from "../ask.js";
import type {
  CodexCommandDependencies,
  CodexOutputEvent,
  discoverCodexModels,
} from "../codex-command.js";
import {
  classifySubmissionKey,
  createEditorState,
  deleteEditorRange,
  type EditorState,
  insertEditorText,
  insertFileMention,
  type MentionQuery,
  moveEditorCursor,
} from "../interactive-model.js";
import { contextModeChoices } from "./context.js";
import { conversationTranscript } from "./display.js";
import type { PendingApproval } from "./overlays.js";
import { nextCursor, previousCursor } from "./prompt.js";
import {
  asPersistedReasoningEffort,
  type EffortChoice,
  type LoginChoice,
  type LogoutChoice,
  MODEL_CHOICES,
  type ModelChoice,
  modelChoiceFor,
  type ProviderActionChoice,
  providerModelChoices,
  type ReasoningEffort,
  subscriptionModelChoices,
} from "./provider-choices.js";
import type { InteractiveSessionHost } from "./session-host.js";
import type {
  InteractivePhase as Phase,
  TranscriptEntry,
  TranscriptKind,
} from "./types.js";

export interface InteractiveInputController {
  readonly phase: Phase;
  readonly env: NodeJS.ProcessEnv;
  readonly cwd: string;
  readonly stdout: WritableOutput;
  readonly stderr: WritableOutput;
  readonly sessionHost?: InteractiveSessionHost;
  readonly sessionPersistence?: InteractiveSessionPersistence;
  readonly transcriptLength: number;
  readonly activeOptions: AskOptions;
  readonly approvalStore: SessionApprovalStore;
  readonly approval?: PendingApproval;
  readonly approvalFeedback: string;
  readonly contextPanel?: ContextStatus;
  readonly contextModeSelector: boolean;
  readonly contextModeSelection: number;
  readonly contextOfferVisible: boolean;
  readonly completionKind?: "file" | "command";
  readonly completionSignature: string;
  readonly mentionQuery?: MentionQuery;
  readonly fileCandidates: readonly string[];
  readonly visibleCandidates: readonly (string | SlashCommand)[];
  readonly selectedIndex: number;
  readonly resources: DetectedStartupResources;
  readonly pluginTrustIntent?: "trust" | "untrust";
  readonly sessions: readonly SessionSummary[];
  readonly sessionDeletionConfirmed: boolean;
  readonly loginChoices: readonly LoginChoice[];
  readonly loginKey: string;
  readonly loginChoice?: LoginChoice;
  readonly selectedProviderRoute?: string;
  readonly providerProfiles: Readonly<Record<string, ProviderProfile>>;
  readonly providerActionChoices: readonly ProviderActionChoice[];
  readonly logoutChoices: readonly LogoutChoice[];
  readonly modelChoices: readonly ModelChoice[];
  readonly baseModelChoices: readonly ModelChoice[];
  readonly visibleModelChoices: readonly ModelChoice[];
  readonly selectedModelIndex: number;
  readonly pendingModelDeletion?: ModelChoice;
  readonly deleteModelReturnPhase: "editing" | "provider-actions";
  readonly effortChoices: readonly EffortChoice[];
  readonly conversationRef: { current: ModelConversationMessage[] };
  readonly activeControllerRef: { current: AbortController | undefined };
  readonly idleExitArmedRef: { current: boolean };
  readonly nextTranscriptIdRef: { current: number };
  readonly cancelOrExit: () => void;
  readonly exit: (code: number) => void;
  readonly finishApproval: (answer: string | null) => void;
  readonly appendEntry: (
    kind: TranscriptKind,
    text: string,
    merge?: boolean,
  ) => void;
  readonly updateEditor: (
    update: (current: EditorState) => EditorState,
  ) => void;
  readonly executeCommand: (command: string) => void;
  readonly submitPrompt: () => void;
  readonly selectEffort: (effort: ReasoningEffort) => void;
  readonly cycleEffort: (choices: readonly ModelChoice[]) => void;
  readonly logoutApiProvider: (selected: LogoutChoice) => void;
  readonly handleCodexOutput: (event: CodexOutputEvent) => void;
  readonly updateProjectPluginTrust: (
    trusted: boolean,
  ) => Promise<DetectedStartupResources>;
  readonly executeAuthentication: (
    dependencies: CodexCommandDependencies,
  ) => Promise<number>;
  readonly executeLogout: (
    dependencies: CodexCommandDependencies,
  ) => Promise<number>;
  readonly saveApiKey: (options: {
    readonly provider: ApiKeyProvider;
    readonly apiKey: string;
    readonly env: NodeJS.ProcessEnv;
    readonly endpoint?: string;
  }) => Promise<string>;
  readonly removeApiKey: (options: {
    readonly provider: ApiKeyProvider;
    readonly env: NodeJS.ProcessEnv;
  }) => Promise<boolean>;
  readonly removeProviderRoute: (options: {
    readonly cwd: string;
    readonly env: NodeJS.ProcessEnv;
    readonly route: string;
  }) => Promise<{ readonly path: string; readonly removed: boolean }>;
  readonly removeProviderModel: (options: {
    readonly cwd: string;
    readonly env: NodeJS.ProcessEnv;
    readonly route: string;
    readonly model: string;
  }) => Promise<{ readonly path: string; readonly removed: boolean }>;
  readonly persistModelSelection: (options: {
    readonly cwd: string;
    readonly env: NodeJS.ProcessEnv;
    readonly selection: PersistedModelSelection;
  }) => Promise<string>;
  readonly discoverSubscriptionModels: typeof discoverCodexModels;
  readonly setTranscriptOffset: React.Dispatch<React.SetStateAction<number>>;
  readonly setTranscript: React.Dispatch<
    React.SetStateAction<readonly TranscriptEntry[]>
  >;
  readonly setStaticRenderRevision: React.Dispatch<
    React.SetStateAction<number>
  >;
  readonly setContextModeSelector: React.Dispatch<
    React.SetStateAction<boolean>
  >;
  readonly setContextModeSelection: React.Dispatch<
    React.SetStateAction<number>
  >;
  readonly setContextRevision: React.Dispatch<React.SetStateAction<number>>;
  readonly setContextPanel: React.Dispatch<
    React.SetStateAction<ContextStatus | undefined>
  >;
  readonly setContextOfferDismissed: React.Dispatch<
    React.SetStateAction<boolean>
  >;
  readonly setContextActivity: React.Dispatch<
    React.SetStateAction<ContextStatus["pressure"]["state"] | undefined>
  >;
  readonly setApprovalFeedback: React.Dispatch<React.SetStateAction<string>>;
  readonly setPhase: React.Dispatch<React.SetStateAction<Phase>>;
  readonly setSelectedIndex: React.Dispatch<React.SetStateAction<number>>;
  readonly setPermissionRevision: React.Dispatch<React.SetStateAction<number>>;
  readonly setPluginTrustIntent: React.Dispatch<
    React.SetStateAction<"trust" | "untrust" | undefined>
  >;
  readonly setResources: React.Dispatch<
    React.SetStateAction<DetectedStartupResources>
  >;
  readonly setSessionDeletionConfirmed: React.Dispatch<
    React.SetStateAction<boolean>
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
  readonly setLoginPrompt: React.Dispatch<
    React.SetStateAction<
      { readonly url: string; readonly userCode?: string } | undefined
    >
  >;
  readonly setProviderProfiles: React.Dispatch<
    React.SetStateAction<Readonly<Record<string, ProviderProfile>>>
  >;
  readonly setModelChoices: React.Dispatch<
    React.SetStateAction<readonly ModelChoice[]>
  >;
  readonly setLoggedOutProviderRoutes: React.Dispatch<
    React.SetStateAction<ReadonlySet<string>>
  >;
  readonly setDeleteModelReturnPhase: React.Dispatch<
    React.SetStateAction<"editing" | "provider-actions">
  >;
  readonly setPendingModelDeletion: React.Dispatch<
    React.SetStateAction<ModelChoice | undefined>
  >;
  readonly setModelQuery: React.Dispatch<React.SetStateAction<string>>;
  readonly setActiveOptions: React.Dispatch<React.SetStateAction<AskOptions>>;
  readonly setDismissedCompletion: React.Dispatch<
    React.SetStateAction<string | undefined>
  >;
  readonly setEditor: React.Dispatch<React.SetStateAction<EditorState>>;
}

function handleContextPanelInput(
  input: string,
  key: Key,
  ctx: InteractiveInputController,
): void {
  const { contextPanel } = ctx;
  if (!contextPanel) return;
  const answer = input.toLocaleLowerCase();
  if (ctx.contextModeSelector) {
    const choices = contextModeChoices(contextPanel);
    if (key.escape) {
      ctx.setContextModeSelector(false);
    } else if (key.upArrow || key.downArrow) {
      const delta = key.upArrow ? -1 : 1;
      ctx.setContextModeSelection(
        (current) => (current + delta + choices.length) % choices.length,
      );
    } else if (key.return) {
      const choice = choices[ctx.contextModeSelection];
      ctx.setContextModeSelector(false);
      if (choice?.kind === "session") {
        ctx.sessionPersistence?.setContextModeForSession?.(choice.mode);
        ctx.appendEntry(
          "system",
          `Context mode · ${choice.mode === "automatic" ? "Automatic" : "Manual"} for this session.`,
        );
        ctx.setContextRevision((current) => current + 1);
        ctx.setContextPanel(ctx.sessionPersistence?.contextDetails?.());
      } else if (
        choice?.kind === "default" &&
        ctx.sessionPersistence?.saveContextModeDefault
      ) {
        void ctx.sessionPersistence.saveContextModeDefault(choice.mode).then(
          (saved) => {
            ctx.appendEntry(
              "system",
              saved.savedMode === saved.effectiveMode
                ? `Saved ${saved.savedMode === "automatic" ? "Automatic" : "Manual"} as the user default in ${saved.path}.`
                : `Saved user default: ${saved.savedMode === "automatic" ? "Automatic" : "Manual"}. Effective mode: ${saved.effectiveMode === "automatic" ? "Automatic" : saved.effectiveMode === "manual" ? "Manual" : "Off"} · ${saved.effectiveSource}.`,
            );
            ctx.setContextRevision((current) => current + 1);
            ctx.setContextPanel(ctx.sessionPersistence?.contextDetails?.());
          },
          (error: unknown) =>
            ctx.appendEntry(
              "error",
              `Could not save context default: ${error instanceof Error ? error.message : "unknown error"}`,
            ),
        );
      }
    }
  } else if (key.escape) {
    ctx.setContextPanel(undefined);
  } else if (answer === "m") {
    ctx.setContextModeSelection(0);
    ctx.setContextModeSelector(true);
  } else if (
    (answer === "c" || answer === "p") &&
    ctx.sessionPersistence?.compact
  ) {
    if (answer === "c") ctx.setContextActivity("compacting");
    void ctx.sessionPersistence.compact(answer === "p").then(
      (message) => {
        ctx.appendEntry("system", message);
        ctx.setContextRevision((current) => current + 1);
        ctx.setContextPanel(ctx.sessionPersistence?.contextDetails?.());
        if (answer === "c") ctx.setContextActivity("compacted");
      },
      (error: unknown) =>
        ctx.appendEntry(
          "error",
          `Could not compact session: ${error instanceof Error ? error.message : "unknown error"}`,
        ),
    );
  }
}

function handleContextOfferInput(
  input: string,
  key: Key,
  ctx: InteractiveInputController,
): void {
  const answer = input.toLocaleLowerCase();
  if (answer === "d" || key.escape) {
    ctx.setContextOfferDismissed(true);
  } else if (answer === "a") {
    ctx.sessionPersistence?.setContextModeForSession?.("automatic");
    ctx.setContextOfferDismissed(true);
    ctx.setContextRevision((current) => current + 1);
    ctx.appendEntry("system", "Automatic compaction enabled for this session.");
  } else if (answer === "c" && ctx.sessionPersistence?.compact) {
    ctx.setContextOfferDismissed(true);
    ctx.setContextActivity("compacting");
    void ctx.sessionPersistence.compact(false).then(
      (message) => {
        ctx.appendEntry("system", message);
        ctx.setContextRevision((current) => current + 1);
        ctx.setContextActivity("compacted");
      },
      (error: unknown) =>
        ctx.appendEntry(
          "error",
          `Could not compact session: ${error instanceof Error ? error.message : "unknown error"}`,
        ),
    );
  }
}

function handleApprovalInput(
  input: string,
  key: Key,
  ctx: InteractiveInputController,
): void {
  if (ctx.phase === "approving") {
    const answer = input.toLocaleLowerCase();
    if (answer === "1" || answer === "y") ctx.finishApproval("1");
    else if (answer === "2" && ctx.approval?.allowSession) {
      ctx.finishApproval("2");
    } else if (answer === "2") {
      ctx.appendEntry(
        "warning",
        "Session approval is unavailable for this action. Choose 1 or 3.",
      );
    } else if (answer === "3" || answer === "n") {
      ctx.setApprovalFeedback("");
      ctx.setPhase("approval-feedback");
    } else if (key.escape || key.return) ctx.finishApproval("3");
    return;
  }

  if (key.escape) {
    ctx.finishApproval("3");
  } else if (key.return) {
    ctx.finishApproval(
      ctx.approvalFeedback.trim() ? `3: ${ctx.approvalFeedback.trim()}` : "3",
    );
  } else if (key.backspace || key.delete) {
    ctx.setApprovalFeedback((current) => current.slice(0, -1));
  } else if (input && ctx.approvalFeedback.length < 2_000) {
    ctx.setApprovalFeedback((current) => `${current}${input}`.slice(0, 2_000));
  }
}

function handleResourceInput(
  input: string,
  key: Key,
  ctx: InteractiveInputController,
): boolean {
  if (ctx.phase === "permissions") {
    const grants = ctx.approvalStore.list();
    const selectedGrant = grants[ctx.selectedIndex];
    if (key.escape) {
      ctx.setPhase("editing");
    } else if (key.upArrow && grants.length > 0) {
      ctx.setSelectedIndex(
        (current) => (current - 1 + grants.length) % grants.length,
      );
    } else if (key.downArrow && grants.length > 0) {
      ctx.setSelectedIndex((current) => (current + 1) % grants.length);
    } else if (input.toLocaleLowerCase() === "r" && selectedGrant) {
      ctx.approvalStore.revoke(selectedGrant.id);
      ctx.setSelectedIndex((current) =>
        Math.max(0, Math.min(current, grants.length - 2)),
      );
      ctx.setPermissionRevision((current) => current + 1);
    } else if (input.toLocaleLowerCase() === "x") {
      ctx.approvalStore.clear();
      ctx.setSelectedIndex(0);
      ctx.setPermissionRevision((current) => current + 1);
    }
    return true;
  }

  if (ctx.phase === "plugins") {
    if (key.escape) {
      ctx.setPhase("editing");
      return true;
    }
    const projectPlugins = ctx.resources.plugins.filter(
      ({ scope }) => scope === "project",
    );
    const projectTrusted = projectPlugins.some(
      ({ state }) => state === "trusted",
    );
    const answer = input.toLocaleLowerCase();
    if (answer === "t" && projectPlugins.length > 0 && !projectTrusted) {
      ctx.setPluginTrustIntent("trust");
      ctx.setPhase("plugin-trust");
    } else if (answer === "u" && projectTrusted) {
      ctx.setPluginTrustIntent("untrust");
      ctx.setPhase("plugin-trust");
    }
    return true;
  }

  if (ctx.phase === "resources") {
    if (key.escape) ctx.setPhase("editing");
    return true;
  }

  if (ctx.phase === "plugin-trust") {
    const answer = input.toLocaleLowerCase();
    if (answer === "n" || key.escape || key.return) {
      ctx.setPluginTrustIntent(undefined);
      ctx.setPhase("plugins");
      return true;
    }
    if (answer !== "y" || !ctx.pluginTrustIntent) return true;
    const trusted = ctx.pluginTrustIntent === "trust";
    ctx.setPhase("running");
    void ctx.updateProjectPluginTrust(trusted).then(
      (nextResources) => {
        ctx.setResources(nextResources);
        ctx.setStaticRenderRevision((current) => current + 1);
        ctx.appendEntry(
          "system",
          trusted
            ? `Trusted project plugins for ${ctx.cwd}.\nThey will load on the next Forge task.`
            : `Removed project plugin trust for ${ctx.cwd}.`,
        );
        ctx.setPluginTrustIntent(undefined);
        ctx.setPhase("editing");
      },
      (error: unknown) => {
        ctx.appendEntry(
          "error",
          `Could not ${trusted ? "trust" : "untrust"} project plugins: ${error instanceof Error ? error.message : "unknown error"}`,
        );
        ctx.setPluginTrustIntent(undefined);
        ctx.setPhase("plugins");
      },
    );
    return true;
  }

  return false;
}

function handleSessionInput(
  input: string,
  key: Key,
  ctx: InteractiveInputController,
): boolean {
  if (ctx.phase === "deleting-session") return true;

  if (ctx.phase === "delete-session-confirm") {
    if (key.escape || input.toLowerCase() === "n") {
      ctx.setPhase("resuming");
      return true;
    }
    if (key.leftArrow || key.rightArrow || key.upArrow || key.downArrow) {
      ctx.setSessionDeletionConfirmed((current) => !current);
      return true;
    }
    if (key.return) {
      if (!ctx.sessionDeletionConfirmed) {
        ctx.setPhase("resuming");
        return true;
      }
      const selected = ctx.sessions[ctx.selectedIndex];
      if (!selected || !ctx.sessionPersistence?.delete) return true;
      const wasCurrent = ctx.sessionPersistence.sessionId === selected.id;
      ctx.setPhase("deleting-session");
      void ctx.sessionPersistence.delete(selected.id).then(
        () => {
          if (wasCurrent) {
            ctx.conversationRef.current = [];
            ctx.setTranscript([]);
            ctx.nextTranscriptIdRef.current = 0;
            ctx.setStaticRenderRevision((current) => current + 1);
            ctx.setContextPanel(undefined);
            ctx.setContextOfferDismissed(false);
            ctx.setContextActivity(undefined);
            ctx.approvalStore.clear();
            ctx.setPermissionRevision((current) => current + 1);
          }
          const remaining = ctx.sessions.filter(({ id }) => id !== selected.id);
          ctx.setSessions(remaining);
          ctx.setSelectedIndex(
            Math.max(0, Math.min(ctx.selectedIndex, remaining.length - 1)),
          );
          ctx.setPhase(
            wasCurrent || !remaining.length ? "editing" : "resuming",
          );
          ctx.appendEntry("system", `Deleted session ${selected.id}.`);
        },
        (error: unknown) => {
          ctx.appendEntry(
            "error",
            `Could not delete session: ${error instanceof Error ? error.message : "unknown error"}`,
          );
          ctx.setPhase("resuming");
        },
      );
    }
    return true;
  }

  if (ctx.phase === "resuming") {
    if (key.ctrl && input === "d") {
      if (ctx.sessions[ctx.selectedIndex] && ctx.sessionPersistence?.delete) {
        ctx.setSessionDeletionConfirmed(false);
        ctx.setPhase("delete-session-confirm");
      }
      return true;
    }
    if (key.leftArrow || key.rightArrow || key.pageUp || key.pageDown) {
      const direction = key.leftArrow || key.pageUp ? -1 : 1;
      ctx.setSelectedIndex((current) =>
        Math.max(
          0,
          Math.min(ctx.sessions.length - 1, current + direction * 10),
        ),
      );
      return true;
    }
    if (key.escape) {
      ctx.setSessions([]);
      ctx.setPhase("editing");
      return true;
    }
    if (key.upArrow || key.downArrow) {
      ctx.setSelectedIndex((current) => {
        if (ctx.sessions.length === 0) return 0;
        const delta = key.upArrow ? -1 : 1;
        return (current + delta + ctx.sessions.length) % ctx.sessions.length;
      });
      return true;
    }
    if (key.return) {
      const selected =
        ctx.sessions[Math.min(ctx.selectedIndex, ctx.sessions.length - 1)];
      const persistence = ctx.sessionPersistence;
      if (selected && persistence) {
        void persistence.resume(selected.id).then(
          (messages) => {
            ctx.conversationRef.current = [
              ...(persistence.history ?? messages),
            ];
            const restored = conversationTranscript(
              persistence.history ?? messages,
              persistence.reasoning ?? [],
              persistence.historyEvents,
            );
            ctx.nextTranscriptIdRef.current = restored.length;
            ctx.setStaticRenderRevision((current) => current + 1);
            ctx.setTranscript(restored);
            ctx.setSessions([]);
            ctx.setPhase("editing");
            ctx.setContextOfferDismissed(false);
            ctx.setContextActivity(undefined);
            ctx.appendEntry("system", `Resumed session ${selected.id}.`);
          },
          (error: unknown) => {
            ctx.appendEntry(
              "error",
              `Could not resume session: ${error instanceof Error ? error.message : "unknown error"}`,
            );
            ctx.setPhase("editing");
          },
        );
      }
      return true;
    }
    return true;
  }

  return false;
}

function handleAuthInput(
  input: string,
  key: Key,
  ctx: InteractiveInputController,
): boolean {
  if (ctx.phase === "login-providers") {
    if (key.escape) {
      ctx.setPhase("editing");
      return true;
    }
    if (key.upArrow || key.downArrow) {
      ctx.setSelectedIndex((current) => {
        const delta = key.upArrow ? -1 : 1;
        return (
          (current + delta + ctx.loginChoices.length) % ctx.loginChoices.length
        );
      });
      return true;
    }
    if (key.return) {
      const selected = ctx.loginChoices[ctx.selectedIndex];
      if (!selected) return true;
      if (selected.kind === "api-key") {
        ctx.setLoginChoice(selected);
        ctx.setLoginKey("");
        ctx.setPhase("login-key");
        return true;
      }
      if (selected.kind === "provider-route") {
        ctx.setProviderSetupRoute(undefined);
        ctx.setPhase("provider-setup");
        return true;
      }
      if (selected.kind === "configured-provider" && selected.route) {
        ctx.setSelectedProviderRoute(selected.route);
        ctx.setSelectedIndex(0);
        ctx.setPhase("provider-actions");
        return true;
      }
      const controller = new AbortController();
      ctx.activeControllerRef.current = controller;
      ctx.setPhase("running");
      void ctx
        .executeAuthentication({
          env: ctx.env,
          cwd: ctx.cwd,
          stdout: ctx.stdout,
          stderr: ctx.stderr,
          onOutput: ctx.handleCodexOutput,
          signal: controller.signal,
          isTTY: true,
        })
        .then((code) => {
          ctx.appendEntry(
            code === 0 ? "system" : "error",
            code === 0
              ? "ChatGPT subscription sign-in completed. Use /model to choose a Codex model."
              : "ChatGPT subscription sign-in did not complete.",
          );
        })
        .catch((error: unknown) =>
          ctx.appendEntry(
            "error",
            `Could not sign in: ${error instanceof Error ? error.message : "unknown error"}`,
          ),
        )
        .finally(() => {
          ctx.activeControllerRef.current = undefined;
          ctx.setLoginPrompt(undefined);
          ctx.setPhase("editing");
        });
      return true;
    }
    return true;
  }

  if (ctx.phase === "login-key") {
    if (key.escape) {
      ctx.setLoginKey("");
      ctx.setLoginChoice(undefined);
      ctx.setPhase("login-providers");
      return true;
    }
    if (key.return) {
      const apiKey = ctx.loginKey.trim();
      const loginChoice = ctx.loginChoice;
      const provider = loginChoice?.provider;
      if (!loginChoice || !provider || apiKey === "") return true;
      ctx.setLoginKey("");
      ctx.setPhase("running");
      void ctx.saveApiKey({ provider, apiKey, env: ctx.env }).then(
        (credentialPath) => {
          ctx.appendEntry(
            "system",
            `Saved ${loginChoice.label} credential to ${credentialPath}. Environment variables take precedence. Use /model to choose a model.`,
          );
          ctx.setLoginChoice(undefined);
          ctx.setPhase("editing");
        },
        (error: unknown) => {
          ctx.appendEntry(
            "error",
            `Could not save credential: ${error instanceof Error ? error.message : "unknown error"}`,
          );
          ctx.setPhase("login-key");
        },
      );
      return true;
    }
    if (key.backspace || key.delete) {
      ctx.setLoginKey((current) => Array.from(current).slice(0, -1).join(""));
      return true;
    }
    if (!key.ctrl && !key.meta && input !== "") {
      ctx.setLoginKey((current) => current + input);
    }
    return true;
  }

  if (ctx.phase === "provider-actions") {
    if (key.escape) {
      ctx.setSelectedProviderRoute(undefined);
      ctx.setSelectedIndex(0);
      ctx.setPhase("login-providers");
      return true;
    }
    if (key.upArrow || key.downArrow) {
      ctx.setSelectedIndex((current) => {
        if (ctx.providerActionChoices.length === 0) return 0;
        const delta = key.upArrow ? -1 : 1;
        return (
          (current + delta + ctx.providerActionChoices.length) %
          ctx.providerActionChoices.length
        );
      });
      return true;
    }
    if (key.return) {
      const action = ctx.providerActionChoices[ctx.selectedIndex];
      const route = ctx.selectedProviderRoute;
      const profile = route ? ctx.providerProfiles[route] : undefined;
      if (!action || !route || !profile) return true;
      if (action.kind === "add-model") {
        ctx.setProviderSetupRoute(route);
        ctx.setPhase("provider-setup");
        return true;
      }
      if (action.kind === "delete-model") {
        const configured = providerModelChoices({ [route]: profile });
        if (configured.length === 0) return true;
        ctx.setDeleteModelReturnPhase("provider-actions");
        ctx.setPendingModelDeletion(undefined);
        ctx.setModelQuery("");
        ctx.setSelectedIndex(0);
        ctx.setModelChoices(configured);
        ctx.setPhase("delete-models");
        return true;
      }
      if (action.kind === "logout") {
        ctx.logoutApiProvider({
          label: profile.displayName ?? route,
          description: `Provider route · ${route}`,
          kind: "api-key",
          provider: route,
          ...(profile.auth.type === "bearer" && profile.auth.apiKeyEnv
            ? { environmentVariable: profile.auth.apiKeyEnv }
            : {}),
        });
        return true;
      }
      if (ctx.activeOptions.provider === route) {
        ctx.appendEntry(
          "warning",
          `Choose a model from another provider before removing "${route}".`,
        );
        ctx.setSelectedProviderRoute(undefined);
        ctx.setPhase("editing");
        return true;
      }
      ctx.setPhase("provider-remove-confirm");
      return true;
    }
    return true;
  }

  if (ctx.phase === "provider-remove-confirm") {
    if (key.escape || input.toLocaleLowerCase() === "n") {
      ctx.setPhase("provider-actions");
      return true;
    }
    if (input.toLocaleLowerCase() === "y") {
      const route = ctx.selectedProviderRoute;
      const profile = route ? ctx.providerProfiles[route] : undefined;
      if (!route || !profile) {
        ctx.setPhase("editing");
        return true;
      }
      ctx.setPhase("running");
      void ctx.removeProviderRoute({ cwd: ctx.cwd, env: ctx.env, route }).then(
        async ({ path, removed }) => {
          if (!removed) {
            ctx.appendEntry(
              "warning",
              `Provider route "${route}" was not configured.`,
            );
          } else {
            let credentialRemoved = false;
            if (profile.auth.type === "bearer") {
              credentialRemoved = await ctx
                .removeApiKey({
                  provider: route,
                  env: ctx.env,
                })
                .catch(() => false);
            }
            const nextProviders = { ...ctx.providerProfiles };
            delete nextProviders[route];
            ctx.setProviderProfiles(nextProviders);
            ctx.setModelChoices([
              ...providerModelChoices(nextProviders),
              ...MODEL_CHOICES,
            ]);
            ctx.setLoggedOutProviderRoutes((current) => {
              const next = new Set(current);
              next.delete(route);
              return next;
            });
            ctx.appendEntry(
              "system",
              `Removed provider "${route}" and its model configuration from ${path}.${credentialRemoved ? " Removed its stored credential." : ""}`,
            );
          }
          ctx.setSelectedProviderRoute(undefined);
          ctx.setPhase("editing");
        },
        (error: unknown) => {
          ctx.appendEntry(
            "error",
            `Could not remove provider: ${error instanceof Error ? error.message : "unknown error"}`,
          );
          ctx.setPhase("provider-actions");
        },
      );
      return true;
    }
    return true;
  }

  if (ctx.phase === "logout-providers") {
    if (key.escape) {
      ctx.setPhase("editing");
      return true;
    }
    if (key.upArrow || key.downArrow) {
      ctx.setSelectedIndex((current) => {
        const delta = key.upArrow ? -1 : 1;
        return (
          (current + delta + ctx.logoutChoices.length) %
          ctx.logoutChoices.length
        );
      });
      return true;
    }
    if (key.return) {
      const selected = ctx.logoutChoices[ctx.selectedIndex];
      if (!selected) return true;
      ctx.setPhase("running");
      if (selected.kind === "subscription") {
        const controller = new AbortController();
        ctx.activeControllerRef.current = controller;
        void ctx
          .executeLogout({
            env: ctx.env,
            cwd: ctx.cwd,
            stdout: ctx.stdout,
            stderr: ctx.stderr,
            onOutput: ctx.handleCodexOutput,
            signal: controller.signal,
            isTTY: true,
          })
          .then((code) => {
            if (code !== 0) {
              ctx.appendEntry("error", "ChatGPT subscription logout failed.");
            }
          })
          .catch((error: unknown) =>
            ctx.appendEntry(
              "error",
              `Could not log out: ${error instanceof Error ? error.message : "unknown error"}`,
            ),
          )
          .finally(() => {
            ctx.activeControllerRef.current = undefined;
            ctx.setPhase("editing");
          });
        return true;
      }
      ctx.logoutApiProvider(selected);
      return true;
    }
    return true;
  }

  return false;
}

function handleModelPickerInput(
  input: string,
  key: Key,
  ctx: InteractiveInputController,
): boolean {
  if (ctx.phase === "delete-models") {
    if (key.escape) {
      ctx.setModelQuery("");
      ctx.setModelChoices(ctx.baseModelChoices);
      ctx.setSelectedIndex(0);
      ctx.setPhase(ctx.deleteModelReturnPhase);
      return true;
    }
    if (key.upArrow || key.downArrow) {
      ctx.setSelectedIndex((current) => {
        if (ctx.visibleModelChoices.length === 0) return 0;
        const delta = key.upArrow ? -1 : 1;
        return (
          (current + delta + ctx.visibleModelChoices.length) %
          ctx.visibleModelChoices.length
        );
      });
      return true;
    }
    if (key.return) {
      const selected = ctx.visibleModelChoices[ctx.selectedModelIndex];
      if (!selected) return true;
      if (
        ctx.activeOptions.provider === selected.selection.provider &&
        ctx.activeOptions.model === selected.selection.id
      ) {
        ctx.appendEntry(
          "warning",
          `Choose another model before deleting ${selected.selection.provider}/${selected.selection.id}.`,
        );
        ctx.setModelChoices(ctx.baseModelChoices);
        ctx.setSelectedIndex(0);
        ctx.setPhase(ctx.deleteModelReturnPhase);
        return true;
      }
      ctx.setPendingModelDeletion(selected);
      ctx.setPhase("delete-model-confirm");
      return true;
    }
    if (key.backspace || key.delete) {
      ctx.setModelQuery((current) => Array.from(current).slice(0, -1).join(""));
      ctx.setSelectedIndex(0);
      return true;
    }
    if (!key.ctrl && !key.meta && input !== "") {
      ctx.setModelQuery((current) => current + input);
      ctx.setSelectedIndex(0);
    }
    return true;
  }

  if (ctx.phase === "delete-model-confirm") {
    if (key.escape || input.toLocaleLowerCase() === "n") {
      ctx.setPendingModelDeletion(undefined);
      ctx.setPhase("delete-models");
      return true;
    }
    if (input.toLocaleLowerCase() === "y") {
      const selected = ctx.pendingModelDeletion;
      if (!selected) {
        ctx.setModelChoices(ctx.baseModelChoices);
        ctx.setPhase(ctx.deleteModelReturnPhase);
        return true;
      }
      ctx.setPhase("running");
      void ctx
        .removeProviderModel({
          cwd: ctx.cwd,
          env: ctx.env,
          route: selected.selection.provider,
          model: selected.selection.id,
        })
        .then(
          ({ path, removed }) => {
            if (!removed) {
              ctx.appendEntry(
                "warning",
                `Model ${selected.selection.provider}/${selected.selection.id} was not configured.`,
              );
              ctx.setModelChoices(ctx.baseModelChoices);
            } else {
              const profile = ctx.providerProfiles[selected.selection.provider];
              const nextProviders = { ...ctx.providerProfiles };
              if (profile) {
                nextProviders[selected.selection.provider] = {
                  ...profile,
                  models: (profile.models ?? []).filter(
                    ({ id }) => id !== selected.selection.id,
                  ),
                };
              }
              ctx.setProviderProfiles(nextProviders);
              ctx.setModelChoices([
                ...providerModelChoices(nextProviders),
                ...MODEL_CHOICES,
              ]);
              ctx.appendEntry(
                "system",
                `Deleted model configuration ${selected.selection.provider}/${selected.selection.id} from ${path}.`,
              );
            }
            ctx.setPendingModelDeletion(undefined);
            ctx.setModelQuery("");
            ctx.setSelectedIndex(0);
            ctx.setPhase(ctx.deleteModelReturnPhase);
          },
          (error: unknown) => {
            ctx.appendEntry(
              "error",
              `Could not delete model configuration: ${error instanceof Error ? error.message : "unknown error"}`,
            );
            ctx.setPendingModelDeletion(undefined);
            ctx.setModelChoices(ctx.baseModelChoices);
            ctx.setSelectedIndex(0);
            ctx.setPhase(ctx.deleteModelReturnPhase);
          },
        );
      return true;
    }
    return true;
  }

  if (ctx.phase === "effort") {
    if (key.escape) {
      ctx.setPhase("editing");
      return true;
    }
    if (key.upArrow || key.downArrow || key.leftArrow || key.rightArrow) {
      ctx.setSelectedIndex((current) => {
        if (ctx.effortChoices.length === 0) return 0;
        const delta = key.upArrow || key.leftArrow ? -1 : 1;
        return (
          (current + delta + ctx.effortChoices.length) %
          ctx.effortChoices.length
        );
      });
      return true;
    }
    if (key.return) {
      const selected =
        ctx.effortChoices[
          Math.min(ctx.selectedIndex, ctx.effortChoices.length - 1)
        ];
      if (selected) ctx.selectEffort(selected.effort);
      return true;
    }
    return true;
  }

  if (ctx.phase === "models") {
    if (key.escape) {
      ctx.setModelQuery("");
      ctx.setPhase("editing");
      return true;
    }
    if (key.upArrow || key.downArrow) {
      ctx.setSelectedIndex((current) => {
        if (ctx.visibleModelChoices.length === 0) return 0;
        const delta = key.upArrow ? -1 : 1;
        return (
          (current + delta + ctx.visibleModelChoices.length) %
          ctx.visibleModelChoices.length
        );
      });
      return true;
    }
    if (key.return) {
      const selected = ctx.visibleModelChoices[ctx.selectedModelIndex];
      if (!selected) return true;
      const currentEffort = asPersistedReasoningEffort(
        ctx.activeOptions.reasoningEffort ?? "",
      );
      const reasoningEffort =
        currentEffort &&
        selected.supportedReasoningEfforts.some(
          ({ effort }) => effort === currentEffort,
        )
          ? currentEffort
          : selected.defaultReasoningEffort;
      const thinking =
        selected.selection.provider === "deepseek"
          ? reasoningEffort === "none"
            ? "disabled"
            : "enabled"
          : undefined;
      const nextOptions: AskOptions = {
        ...ctx.activeOptions,
        engine: selected.selection.engine,
        provider: selected.selection.provider,
        model: selected.selection.id,
        reasoningEffort,
        ...(thinking ? { thinking } : {}),
      };
      const selection: PersistedModelSelection = {
        ...selected.selection,
        reasoningEffort,
        ...(thinking ? { thinking } : {}),
      };
      ctx.setActiveOptions(nextOptions);
      ctx.sessionPersistence?.selectModel?.(
        selected.selection.provider,
        selected.selection.id,
        ctx.providerProfiles[selected.selection.provider]?.models?.find(
          (model) => model.id === selected.selection.id,
        )?.contextWindow,
      );
      ctx.setPhase("editing");
      void ctx
        .persistModelSelection({
          cwd: ctx.cwd,
          env: ctx.env,
          selection,
        })
        .then(
          (configPath) =>
            ctx.appendEntry(
              "system",
              `Selected ${selected.label}. Saved to ${configPath}.`,
            ),
          (error: unknown) =>
            ctx.appendEntry(
              "error",
              `Could not persist model selection: ${error instanceof Error ? error.message : "unknown error"}`,
            ),
        );
      return true;
    }
    if (key.backspace || key.delete) {
      ctx.setModelQuery((current) => Array.from(current).slice(0, -1).join(""));
      ctx.setSelectedIndex(0);
      return true;
    }
    if (!key.ctrl && !key.meta && input !== "") {
      ctx.setModelQuery((current) => current + input);
      ctx.setSelectedIndex(0);
    }
    return true;
  }

  return false;
}

function handleEditingInput(
  input: string,
  key: Key,
  ctx: InteractiveInputController,
): void {
  if (key.shift && key.tab) {
    if (
      ctx.activeOptions.engine === "codex" &&
      !modelChoiceFor(ctx.modelChoices, ctx.activeOptions)
    ) {
      void ctx
        .discoverSubscriptionModels({
          env: ctx.env,
          cwd: ctx.cwd,
          stdout: ctx.stdout,
          stderr: ctx.stderr,
          signal: new AbortController().signal,
          isTTY: true,
        })
        .then(
          (models) => {
            const subscriptionChoices = subscriptionModelChoices(models);
            ctx.setModelChoices([
              ...subscriptionChoices,
              ...ctx.baseModelChoices,
            ]);
            if (modelChoiceFor(subscriptionChoices, ctx.activeOptions)) {
              ctx.cycleEffort(subscriptionChoices);
            } else {
              ctx.appendEntry(
                "warning",
                `Could not find effort metadata for ${ctx.activeOptions.model}.`,
              );
            }
          },
          (error: unknown) =>
            ctx.appendEntry(
              "warning",
              `Could not discover supported effort levels: ${error instanceof Error ? error.message : "unknown error"}`,
            ),
        );
    } else {
      ctx.cycleEffort(ctx.modelChoices);
    }
    return;
  }

  const submission = classifySubmissionKey(input, key);
  if (submission === "newline") {
    ctx.updateEditor((current) => insertEditorText(current, "\n"));
    return;
  }

  if (key.escape && ctx.completionKind) {
    ctx.setDismissedCompletion(ctx.completionSignature);
    return;
  }
  if (ctx.completionKind && (key.upArrow || key.downArrow)) {
    ctx.setSelectedIndex((current) => {
      if (ctx.visibleCandidates.length === 0) return 0;
      const delta = key.upArrow ? -1 : 1;
      return (
        (current + delta + ctx.visibleCandidates.length) %
        ctx.visibleCandidates.length
      );
    });
    return;
  }
  if (
    ctx.completionKind &&
    (key.return || key.tab) &&
    ctx.visibleCandidates.length > 0
  ) {
    const safeIndex = Math.min(
      ctx.selectedIndex,
      ctx.visibleCandidates.length - 1,
    );
    if (ctx.completionKind === "file" && ctx.mentionQuery) {
      const mentionQuery = ctx.mentionQuery;
      const filePath = ctx.fileCandidates[safeIndex];
      if (filePath) {
        ctx.updateEditor((current) =>
          insertFileMention(current, mentionQuery, filePath),
        );
      }
    } else {
      const command = ctx.visibleCandidates[safeIndex] as
        | SlashCommand
        | undefined;
      if (command) {
        if (key.return) ctx.executeCommand(command.name);
        else ctx.setEditor(createEditorState(`${command.name} `));
      }
    }
    return;
  }
  if (submission === "submit") {
    ctx.submitPrompt();
    return;
  }
  if (key.leftArrow) {
    ctx.updateEditor((current) =>
      moveEditorCursor(current, previousCursor(current)),
    );
    return;
  }
  if (key.rightArrow) {
    ctx.updateEditor((current) =>
      moveEditorCursor(current, nextCursor(current)),
    );
    return;
  }
  if (key.home) {
    ctx.updateEditor((current) =>
      moveEditorCursor(
        current,
        current.value.lastIndexOf("\n", current.cursor - 1) + 1,
      ),
    );
    return;
  }
  if (key.end) {
    ctx.updateEditor((current) => {
      const lineEnd = current.value.indexOf("\n", current.cursor);
      return moveEditorCursor(
        current,
        lineEnd < 0 ? current.value.length : lineEnd,
      );
    });
    return;
  }
  if (key.backspace) {
    ctx.updateEditor((current) => {
      if (
        current.cursor === 0 &&
        current.value === "" &&
        current.images.length > 0
      ) {
        return { ...current, images: current.images.slice(0, -1) };
      }
      return deleteEditorRange(
        current,
        previousCursor(current),
        current.cursor,
      );
    });
    return;
  }
  if (key.delete) {
    ctx.updateEditor((current) =>
      deleteEditorRange(current, current.cursor, nextCursor(current)),
    );
    return;
  }
  if (!key.ctrl && !key.meta && input !== "") {
    ctx.idleExitArmedRef.current = false;
    ctx.updateEditor((current) => insertEditorText(current, input));
  }
}

/** Handles keyboard events for all interactive TUI phases and modals. */
export function handleInteractiveInput(
  input: string,
  key: Key,
  ctx: InteractiveInputController,
): void {
  if (ctx.sessionHost && key.ctrl && ["n", "p"].includes(input.toLowerCase())) {
    return;
  }
  if (ctx.sessionHost && (key.pageUp || key.pageDown)) {
    ctx.setTranscriptOffset((current) =>
      key.pageUp
        ? Math.min(Math.max(0, ctx.transcriptLength - 1), current + 5)
        : Math.max(0, current - 5),
    );
    return;
  }
  if (ctx.phase === "provider-setup") return;
  const interruptCount = Array.from(input).filter(
    (character) => character === "\u0003",
  ).length;
  if ((key.ctrl && input.toLocaleLowerCase() === "c") || interruptCount > 0) {
    ctx.cancelOrExit();
    if (interruptCount > 1 && ctx.phase === "editing" && !ctx.completionKind) {
      ctx.exit(0);
    }
    return;
  }

  if (ctx.phase === "editing" && ctx.contextPanel) {
    handleContextPanelInput(input, key, ctx);
    return;
  }
  if (ctx.contextOfferVisible) {
    handleContextOfferInput(input, key, ctx);
    return;
  }
  if (ctx.phase === "approving" || ctx.phase === "approval-feedback") {
    handleApprovalInput(input, key, ctx);
    return;
  }
  if (handleResourceInput(input, key, ctx)) return;
  if (handleSessionInput(input, key, ctx)) return;
  if (handleAuthInput(input, key, ctx)) return;
  if (handleModelPickerInput(input, key, ctx)) return;
  if (ctx.phase === "running") return;

  handleEditingInput(input, key, ctx);
}
