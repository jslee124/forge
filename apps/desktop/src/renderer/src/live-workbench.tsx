import type { ProductRunCompletion } from "@forge/application";
import type { ProductRunDelivery } from "@forge/persistence";
import { ChatCircle } from "@phosphor-icons/react/ChatCircle";
import { Code } from "@phosphor-icons/react/Code";
import { FileText } from "@phosphor-icons/react/FileText";
import { GearSix } from "@phosphor-icons/react/GearSix";
import { Globe } from "@phosphor-icons/react/Globe";
import { Plus } from "@phosphor-icons/react/Plus";
import { SidebarSimple } from "@phosphor-icons/react/SidebarSimple";
import { X } from "@phosphor-icons/react/X";
import React from "react";
import { useTranslation } from "react-i18next";
import type {
  DesktopState,
  ManagementCommand,
  ModelSelection,
  RecoveryPlan,
} from "../../shared/application-protocol.js";
import type { ChangeReview, FilePreview } from "../../shared/file-protocol.js";
import type { RunEvent, RunPayload } from "../../shared/run-protocol.js";
import { ApprovalCard } from "./approval-card.js";
import logoUrl from "./assets/forge-logo.svg";
import markUrl from "./assets/forge-mark.svg";
import { ComposerControls } from "./composer-controls.js";
import { ConversationMessage } from "./conversation-message.js";
import { ContentPreview, DiffViewer } from "./file-preview.js";
import { RecoveryReview } from "./recovery-review.js";
import { RunActivity } from "./run-activity.js";
import { RunDelivery } from "./run-delivery.js";
import { RunHistory } from "./run-history.js";
import { RunResult } from "./run-result.js";
import { activityReducer, initialActivity } from "./run-state.js";
import { SettingsView } from "./settings-view.js";
import { SlashCommandMenu } from "./slash-command-menu.js";
import { commands, routeCommand, suggestions } from "./slash-commands.js";
import { SystemFallback } from "./system-fallback.js";
import { Transcript } from "./transcript.js";
import { UpdateView } from "./update-view.js";
import { useConversationBrowser } from "./use-conversation-browser.js";
import { useStreamedAnswer } from "./use-streamed-answer.js";
import { WorkspaceHeader } from "./workspace-header.js";

export function LiveWorkbench(): React.JSX.Element {
  const { t, i18n } = useTranslation();
  const [panelTab, setPanelTab] = React.useState("files");
  const [sidebarOpen, setSidebarOpen] = React.useState(true);
  const [viewportWidth, setViewportWidth] = React.useState(window.innerWidth);
  React.useEffect(() => {
    const update = () => setViewportWidth(window.innerWidth);
    window.addEventListener("resize", update);
    return () => window.removeEventListener("resize", update);
  }, []);
  const [sidebarWidth, setSidebarWidth] = React.useState(() => {
    const stored = Number(localStorage.getItem("forge.desktop.sidebarWidth"));
    return Number.isFinite(stored) && stored >= 160 && stored <= 360
      ? stored
      : 224;
  });
  const sidebarDrag = React.useRef<{ x: number; width: number } | undefined>(
    undefined,
  );
  React.useEffect(() => {
    localStorage.setItem("forge.desktop.sidebarWidth", String(sidebarWidth));
  }, [sidebarWidth]);
  React.useEffect(() => {
    const stop = () => {
      sidebarDrag.current = undefined;
    };
    window.addEventListener("blur", stop);
    return () => window.removeEventListener("blur", stop);
  }, []);
  const [panelWidth, setPanelWidth] = React.useState(360);
  const composerRef = React.useRef<HTMLTextAreaElement>(null);
  const [state, setState] = React.useState<DesktopState>();
  const [drafts, setDrafts] = React.useState<Record<string, string>>({});
  const [engine, setEngine] = React.useState<"native" | "codex">("native");
  const [model, setModel] = React.useState("");
  const [selection, setSelection] = React.useState<ModelSelection>();
  const [sessionQuery, setSessionQuery] = React.useState("");
  const [permission, setPermission] = React.useState<
    "safe" | "workspace-write"
  >("safe");
  const [active, setActive] = React.useState<{
    sessionId: string;
    runId: string;
    requestId: string;
  }>();
  const activeRef = React.useRef(active);
  const [status, setStatus] = React.useState("ready");
  const {
    answer,
    omittedCharacters,
    append: appendAnswer,
    flush: flushAnswer,
    reset: resetAnswer,
  } = useStreamedAnswer();
  const [followRequest, setFollowRequest] = React.useState(0);
  const [prompt, setPrompt] = React.useState("");
  const [activity, dispatchActivity] = React.useReducer(
    activityReducer,
    initialActivity,
  );
  const [completion, setCompletion] = React.useState<ProductRunCompletion>();
  const [completionRunId, setCompletionRunId] = React.useState<string>();
  const [currentDelivery, setCurrentDelivery] =
    React.useState<ProductRunDelivery>();
  const submittedRef = React.useRef<
    { sessionId: string; prompt: string; preserveDraft?: boolean } | undefined
  >(undefined);
  const [approvals, setApprovals] = React.useState<
    Extract<RunPayload, { type: "approval" }>[]
  >([]);
  const approval = approvals[0];
  const [approvalPending, setApprovalPending] = React.useState(false);
  const approvalSubmitting = React.useRef(false);
  const clearActivity = () => {
    dispatchActivity({ type: "reset" });
    setCompletion(undefined);
    setCompletionRunId(undefined);
    setCurrentDelivery(undefined);
  };
  const [error, setError] = React.useState("");
  const [pending, setPending] = React.useState(false);
  const [setupIssue, setSetupIssue] = React.useState<
    | "missing_credentials"
    | "invalid_configuration"
    | "codex_sign_in"
    | "codex_unavailable"
  >();
  const [settings, setSettings] = React.useState(false);
  const [settingsSection, setSettingsSection] = React.useState("appearance");
  const [panel, setPanel] = React.useState(false);
  const {
    viewed,
    viewedRef,
    viewLoading,
    shellRef,
    key,
    hasSavedPosition,
    savePosition,
    invalidateRead,
    clearBrowsing,
    returnToExecution,
    browseSession,
    readSession,
    prepareExecutionView,
  } = useConversationBrowser({
    state,
    panel,
    tab: panelTab,
    setPanel,
    setTab: setPanelTab,
    onError: (cause) => setError(operationError(cause)),
    onNavigate: () => {
      setSettings(false);
      setNotice("");
      setError("");
    },
  });

  const panelReserve =
    panel && viewportWidth > 900
      ? Math.min(panelWidth, viewportWidth * 0.48)
      : 0;
  const sidebarMax = Math.max(
    160,
    Math.min(360, viewportWidth - 520 - panelReserve),
  );
  const displayedSidebarWidth = Math.min(sidebarWidth, sidebarMax);
  const [filePath, setFilePath] = React.useState("");
  const [filePreview, setFilePreview] = React.useState<FilePreview>();
  const [review, setReview] = React.useState<ChangeReview>();
  const [recoveryReview, setRecoveryReview] = React.useState<RecoveryPlan>();
  const [retryPlan, setRetryPlan] = React.useState<RecoveryPlan>();
  const executionScope = `${state?.sessionId ?? ""}:${state?.cwd ?? ""}`;
  const scope = viewed ? `${viewed.sessionId}:${viewed.cwd}` : executionScope;
  const displayState =
    viewed && state
      ? {
          ...state,
          sessionId: viewed.sessionId,
          cwd: viewed.cwd,
          messages: viewed.messages,
          runHistory: viewed.runHistory,
        }
      : state;

  const scopeRef = React.useRef(scope);
  scopeRef.current = scope;
  const previousSelectionScope = React.useRef(executionScope);
  // biome-ignore lint/correctness/useExhaustiveDependencies: A viewed workspace identity change invalidates file previews and recovery review.
  React.useEffect(() => {
    setFilePath("");
    setRetryPlan(undefined);
    setRecoveryReview(undefined);
    setFilePreview(undefined);
    setReview(undefined);
  }, [scope]);
  React.useEffect(() => {
    const previous = previousSelectionScope.current;
    previousSelectionScope.current = executionScope;
    if (!(previous.startsWith(":") && !executionScope.startsWith(":"))) {
      setSelection(undefined);
      setModel("");
      setPermission("safe");
    }
  }, [executionScope]);
  const draft = drafts[key] ?? "";
  const [commandIndex, setCommandIndex] = React.useState(0);
  const [commandClosed, setCommandClosed] = React.useState(false);
  const commandPending = React.useRef(false);
  const startSubmitting = React.useRef(false);
  const [literalOffer, setLiteralOffer] = React.useState(false);
  const [notice, setNotice] = React.useState("");
  const candidates = viewed || commandClosed ? [] : suggestions(draft);
  const zh = i18n.language.startsWith("zh");
  const busy = Boolean(active) || pending;
  const api = window.forgeDesktop;
  React.useEffect(() => {
    void api?.setLocale?.(zh ? "zh-CN" : "en").catch(() => {});
  }, [zh]);
  const sessions = state?.sessions ?? [];
  const navigationSessions =
    active && !sessions.some((session) => session.id === active.sessionId)
      ? [
          {
            id: active.sessionId,
            title: submittedRef.current?.prompt.slice(0, 80) || "Forge",
            cwd: state?.cwd ?? "",
          },
          ...sessions,
        ]
      : sessions;

  React.useEffect(() => {
    const guard = (event: BeforeUnloadEvent) => {
      if (busy || Object.values(drafts).some((value) => value.trim())) {
        event.preventDefault();
        event.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", guard);
    return () => window.removeEventListener("beforeunload", guard);
  }, [busy, drafts]);
  const manage = async (
    command: Exclude<ManagementCommand, { type: "workspace" }>,
  ) => {
    if (!api) {
      setError("management-failed");
      return;
    }
    setPending(true);
    setError("");
    try {
      const next = await api.manage(command);
      if (
        command.type === "model-delete" &&
        selection?.provider === command.provider &&
        selection.model === command.model
      ) {
        setSelection(undefined);
        setModel("");
      }
      setState(next);
      return next;
    } catch (cause) {
      setError(operationError(cause));
      return;
    } finally {
      setPending(false);
    }
  };
  const restoreRunFocus = React.useCallback(() => {
    const focused = document.activeElement;
    if (
      !(focused instanceof HTMLElement) ||
      !focused.closest(".run-approval,[data-testid=stop-active]")
    )
      return;
    requestAnimationFrame(() => {
      if (
        document.activeElement !== document.body &&
        document.activeElement !== focused
      )
        return;
      const target =
        document.querySelector<HTMLButtonElement>(
          viewedRef.current
            ? "[data-testid=return-active]"
            : "[data-testid=stop-active]",
        ) ?? composerRef.current;
      target?.focus({ preventScroll: true });
    });
  }, [viewedRef]);
  React.useEffect(() => {
    if (!api) {
      setError("management-failed");
      return;
    }
    let disposed = false;
    void api
      .manage({ type: "state" })
      .then((next) => {
        if (!disposed) {
          setState(next);
          if (next.defaultSelection) {
            setEngine(next.defaultSelection.engine);
            setPermission(
              next.defaultSelection.engine === "codex"
                ? "workspace-write"
                : "safe",
            );
          }
        }
      })
      .catch(() => {
        if (!disposed) setError("management-failed");
      });
    const unsubscribe = api.onRunEvent((event: RunEvent) => {
      const current = activeRef.current;
      if (
        !current ||
        event.runId !== current.runId ||
        event.sessionId !== current.sessionId ||
        event.requestId !== current.requestId
      )
        return;
      const payload = event.payload;
      dispatchActivity({ type: "event", event });
      if (payload.type === "text") appendAnswer(payload.text);
      else if (payload.type === "phase") setStatus(payload.phase);
      else if (payload.type === "approval") {
        setApprovals((values) => [...values, payload]);
        setStatus("approval");
      } else if (payload.type === "approval-resolved") {
        restoreRunFocus();
        setApprovals((values) =>
          values.filter((value) => value.approvalId !== payload.approvalId),
        );
        setStatus("running");
      } else if (payload.type === "complete") {
        restoreRunFocus();
        flushAnswer();
        activeRef.current = undefined;
        setActive(undefined);
        setApprovals([]);
        setCompletion(payload);
        setCompletionRunId(current.runId);
        setStatus(payload.outcome);
        if (payload.outcome !== "completed") {
          const submitted = submittedRef.current;
          if (
            submitted?.sessionId === current.sessionId &&
            !submitted.preserveDraft
          )
            setDrafts((values) =>
              values[current.sessionId]?.trim()
                ? values
                : { ...values, [current.sessionId]: submitted.prompt },
            );
        }
        if (payload.outcome !== "interrupted") {
          setPending(true);
          void api
            .manage({ type: "state" })
            .then((next) => {
              if (!disposed) {
                setState(next);
                setCurrentDelivery(
                  next.runHistory?.selected?.summary.runId === current.runId
                    ? next.runHistory.selected.delivery
                    : undefined,
                );
                setPrompt("");
                resetAnswer();
              }
            })
            .catch(() => {
              if (!disposed) setError("management-failed");
            })
            .finally(() => {
              if (!disposed) setPending(false);
            });
        }
      }
    });
    return () => {
      disposed = true;
      unsubscribe();
    };
  }, [appendAnswer, flushAnswer, resetAnswer, restoreRunFocus]);
  React.useEffect(() => {
    if (state?.auth !== "signing-in" || !api) return;
    const timer = setInterval(() => {
      void api
        .manage({ type: "state" })
        .then(setState)
        .catch(() => setError("management-failed"));
    }, 1000);
    return () => clearInterval(timer);
  }, [state?.auth]);
  const previewDeliveryFile = async (path: string) => {
    if (viewedRef.current) {
      setNotice(t("browsing.noSend"));
      return;
    }
    setPanel(true);
    setPanelTab("files");
    setFilePath(path);
    setFilePreview(undefined);
    try {
      const value = await api?.previewFile({ path });
      if (scopeRef.current === scope) setFilePreview(value);
    } catch (cause) {
      if (scopeRef.current === scope) setError(operationError(cause));
    }
  };
  const importFile = async () => {
    try {
      const imported = await api?.importFile();
      if (imported) {
        setFilePath(imported.path);
        setFilePreview(await api?.previewFile({ path: imported.path }));
        setPanel(true);
      }
    } catch (cause) {
      setError(operationError(cause));
    }
  };
  const onChooseWorkspace = async () => {
    setPending(true);
    try {
      const next = await api?.chooseWorkspace();
      if (next) {
        setState(next);
        setPrompt("");
        resetAnswer();
        clearActivity();
      }
    } catch (cause) {
      setError(operationError(cause));
    } finally {
      setPending(false);
    }
  };
  const newTask = async (mode: "new" | "clear" = "new") => {
    const next = await manage({ type: "reset", mode });
    if (!next) return false;
    clearBrowsing();
    setSetupIssue(undefined);
    setPrompt("");
    resetAnswer();
    clearActivity();
    setNotice("");
    setLiteralOffer(false);
    setSettings(false);
    setPanel(false);
    setStatus("ready");
    return true;
  };
  const resumeSession = async (sessionId: string) => {
    if (activeRef.current || pending) return;
    savePosition();
    const position = prepareExecutionView(
      sessionId,
      sessionId === state?.sessionId && !viewed,
    );
    invalidateRead();
    const next = await manage({ type: "resume", sessionId });
    if (!next) return;
    clearBrowsing();
    setPanel(position.panel);
    setPanelTab(position.tab);
    setSettings(false);
    setStatus("ready");
    setNotice("");
    clearActivity();
    setPrompt("");
    resetAnswer();
    setApprovals([]);
  };
  const executeSlash = async (input: string) => {
    if (viewedRef.current) {
      setNotice(t("browsing.noSend"));
      return;
    }
    const result = routeCommand(input, busy || commandPending.current);
    setCommandClosed(true);
    setNotice("");
    const clear = () =>
      setDrafts((values) =>
        values[key] === draft ? { ...values, [key]: "" } : values,
      );
    if (result.kind === "error" || result.kind === "not-applicable") {
      const reason = result.kind === "error" ? result.reason : "not-applicable";
      const labels = {
        "unknown-command": [
          "未知命令，可选择作为普通消息发送。",
          "Unknown command. You can send it as a message.",
        ],
        "invalid-arguments": [
          "参数无效，请检查命令格式。",
          "Invalid command arguments.",
        ],
        busy: [
          "当前操作进行中，请稍后重试。",
          "An operation is active. Try again later.",
        ],
        unsupported: [
          "此操作尚未接入桌面端，请使用 TUI。",
          "This operation is not connected on desktop. Use TUI.",
        ],
        "not-applicable": [
          "桌面端没有对应版本提示，此命令不适用。",
          "No corresponding desktop update notice; not applicable.",
        ],
      };
      setNotice(labels[reason][zh ? 0 : 1] ?? "");
      setLiteralOffer(
        reason === "unknown-command" || reason === "invalid-arguments",
      );
      composerRef.current?.focus();
      return;
    }
    setLiteralOffer(false);
    if (result.kind === "effort") {
      const current =
        selection ??
        (state?.defaultSelection?.engine === engine
          ? state.defaultSelection
          : undefined);
      const entry = state?.modelCatalog?.find(
        (x) =>
          x.engine === engine &&
          x.provider === current?.provider &&
          x.id === current?.model,
      );
      if (!result.value) {
        document
          .querySelector<HTMLButtonElement>("[data-testid=composer-model]")
          ?.click();
        clear();
        return;
      }
      if (!current || !entry?.efforts.includes(result.value)) {
        setNotice(
          zh
            ? "当前模型不支持此强度，请先选择模型。"
            : "Effort unavailable. Select a supported model first.",
        );
        return;
      }
      const value = {
        ...current,
        effort: result.value as NonNullable<ModelSelection["effort"]>,
      };
      commandPending.current = true;
      try {
        const next = await manage({ type: "model-save", selection: value });
        if (next) {
          setSelection(value);
          setModel(value.model);
          setNotice(next.operationResult || "");
          clear();
        }
      } finally {
        commandPending.current = false;
      }
      return;
    }
    if (result.kind === "read") {
      setNotice(
        result.target === "help"
          ? commands.map(([n, cn, en]) => `/${n}  ${zh ? cn : en}`).join("\n")
          : state?.context || (zh ? "尚无上下文" : "No context"),
      );
      if (result.target === "context") {
        const details = document.querySelector<HTMLDetailsElement>(
          ".studio-context-usage",
        );
        if (details) details.open = true;
        setNotice("");
      }
      clear();
      composerRef.current?.focus();
      return;
    }
    if (result.kind === "manage") {
      commandPending.current = true;
      try {
        if (result.target === "reset") {
          if (await newTask(result.mode)) clear();
        } else {
          const next = await manage({ type: "compact", dryRun: result.dryRun });
          if (next) {
            setNotice(next.operationResult || next.context);
            clear();
          }
        }
      } finally {
        commandPending.current = false;
        composerRef.current?.focus();
      }
      return;
    }
    clear();
    if (result.target === "settings") {
      const name = input.trim();
      setSettingsSection(
        name === "/delete-model"
          ? "models"
          : name === "/resources"
            ? "resources"
            : name === "/plugins"
              ? "plugins"
              : "credentials",
      );
      setSettings(true);
    } else if (result.target === "resume") {
      setSidebarOpen(true);
      requestAnimationFrame(() =>
        document
          .querySelector<HTMLInputElement>("[data-testid=session-search]")
          ?.focus(),
      );
      setNotice(
        zh ? "从左侧选择要恢复的任务。" : "Select a saved task in the sidebar.",
      );
    } else if (result.target === "exit") window.close();
    else if (result.target === "permissions") {
      const details = document.querySelector<HTMLDetailsElement>(
        ".studio-permissions-details",
      );
      if (details) details.open = true;
    } else
      requestAnimationFrame(() =>
        document
          .querySelector<HTMLButtonElement>("[data-testid=composer-model]")
          ?.click(),
      );
  };
  const prepareRecovery = async (
    kind: RecoveryPlan["kind"],
    sourceRunId: string,
  ) => {
    if (busy || !state?.sessionId) return;
    if (engine !== "native") {
      setNotice(t("recovery.nativeOnly"));
      return;
    }
    const base = selection ?? state.defaultSelection;
    if (base?.engine !== "native") {
      setNotice(t("recovery.nativeOnly"));
      return;
    }
    const entry = state.modelCatalog?.find(
      (value) =>
        value.engine === "native" &&
        value.provider === base.provider &&
        value.id === (model || base.model),
    );
    const chosen: ModelSelection = {
      ...base,
      model: model || base.model,
      effort: (base.effort && entry?.efforts.includes(base.effort)
        ? base.effort
        : (entry?.defaultEffort ?? base.effort)) as ModelSelection["effort"],
    };
    const next = await manage({
      type: "prepare-recovery",
      sourceRunId,
      kind,
      selection: chosen,
      permissionProfile: permission,
    });
    if (next?.recoveryPlan) setRecoveryReview(next.recoveryPlan);
  };
  const send = async (literal = false, explicitPlan?: RecoveryPlan) => {
    if (viewedRef.current) {
      setNotice(t("browsing.noSend"));
      return;
    }
    const recovery = explicitPlan ?? retryPlan;
    const input = explicitPlan ? explicitPlan.prompt : draft;
    const preserveDraft =
      recovery?.kind === "summarize" || recovery?.kind === "continue";
    if (!input.trim() || !api) return;
    if (!recovery && !literal && draft.trim().startsWith("/")) {
      await executeSlash(draft);
      return;
    }
    if (busy || commandPending.current || startSubmitting.current) return;
    if (
      engine === "native" &&
      !selection &&
      state?.defaultSelection?.engine === "codex"
    ) {
      setNotice(
        zh
          ? "请选择 Forge 模型后再发送。"
          : "Select a Forge model before sending.",
      );
      return;
    }
    setLiteralOffer(false);
    startSubmitting.current = true;
    setPending(true);
    setError("");
    try {
      const chosen =
        recovery?.selection ??
        selection ??
        (model && state
          ? {
              engine,
              provider: engine === "codex" ? "openai" : state.provider,
              model,
            }
          : undefined);
      let checked: DesktopState;
      try {
        checked = await api.manage({
          type: "check-readiness",
          engine: chosen?.engine ?? engine,
          ...(chosen ? { selection: chosen } : {}),
        });
      } catch (cause) {
        const code = operationError(cause);
        if (code === "configuration-invalid")
          setSetupIssue("invalid_configuration");
        else {
          setSetupIssue(undefined);
          setError(code);
        }
        return;
      }
      if (!checked.readiness?.ready) {
        setSetupIssue(checked.readiness?.issue ?? "invalid_configuration");
        return;
      }
      setSetupIssue(undefined);
      const current = state?.sessionId
        ? state
        : await api.manage({ type: "create", prompt: input });
      setState(current);
      const identity = {
        sessionId: current.sessionId,
        runId: crypto.randomUUID(),
        requestId: crypto.randomUUID(),
      };
      activeRef.current = identity;
      submittedRef.current = {
        sessionId: current.sessionId,
        prompt: input,
        preserveDraft,
      };
      setActive(identity);
      setFollowRequest((value) => value + 1);
      setStatus("running");
      setPrompt(input);
      resetAnswer();
      clearActivity();
      if (!preserveDraft)
        setDrafts((values) => ({
          ...values,
          [key]: values[key] === draft ? "" : (values[key] ?? ""),
          [current.sessionId]:
            values[current.sessionId] === draft
              ? ""
              : (values[current.sessionId] ?? ""),
        }));
      const accepted = await api.runCommand({
        type: "start",
        ...identity,
        prompt: input,
        engine: recovery ? recovery.selection.engine : engine,
        permissionProfile: recovery ? recovery.permissionProfile : permission,
        ...(recovery
          ? {
              recovery: {
                token: recovery.token,
                sourceRunId: recovery.sourceRunId,
                kind: recovery.kind,
              },
              model: recovery.selection.model,
              provider: recovery.selection.provider,
              ...(recovery.selection.effort
                ? { reasoningEffort: recovery.selection.effort }
                : {}),
            }
          : {}),
        ...(!recovery && selection
          ? {
              model: selection.model,
              provider: selection.provider,
              ...(selection.effort
                ? { reasoningEffort: selection.effort }
                : {}),
            }
          : !recovery && model
            ? { model }
            : {}),
      });
      if (accepted) setRetryPlan(undefined);
      if (!accepted && activeRef.current === identity) {
        activeRef.current = undefined;
        setActive(undefined);
        setStatus("failed");
        setCompletion({ outcome: "failed", reason: "execution_error" });
        if (!preserveDraft)
          setDrafts((values) =>
            values[current.sessionId]?.trim()
              ? values
              : { ...values, [current.sessionId]: input },
          );
        setError("management-failed");
      }
    } catch {
      setError("management-failed");
      setStatus("failed");
      setCompletion({ outcome: "failed", reason: "execution_error" });
      const submitted = submittedRef.current;
      if (submitted && !submitted.preserveDraft)
        setDrafts((values) =>
          values[submitted.sessionId]?.trim()
            ? values
            : { ...values, [submitted.sessionId]: submitted.prompt },
        );
      activeRef.current = undefined;
      setActive(undefined);
    } finally {
      startSubmitting.current = false;
      setPending(false);
    }
  };
  const cancel = async () => {
    if (!active || !api || status === "stopping") return;
    const current = active;
    setStatus("stopping");
    const rejected = () => {
      setError("management-failed");
      if (activeRef.current === current)
        setStatus(approval ? "approval" : "running");
    };
    try {
      if (
        !(await api.runCommand({
          ...active,
          type: "cancel",
          requestId: crypto.randomUUID(),
        }))
      )
        rejected();
    } catch {
      rejected();
    }
  };
  const decide = async (allow: boolean) => {
    if (!active || !approval || !api || approvalSubmitting.current) return;
    const approvalId = approval.approvalId;
    approvalSubmitting.current = true;
    setApprovalPending(true);
    try {
      if (
        !(await api.runCommand({
          ...active,
          type: "approve",
          requestId: crypto.randomUUID(),
          approvalId,
          ...(approval.descriptor
            ? { actionId: approval.descriptor.actionId }
            : {}),
          allow,
        }))
      )
        setError("management-failed");
    } catch {
      setError("management-failed");
    } finally {
      approvalSubmitting.current = false;
      setApprovalPending(false);
    }
  };
  return (
    <main
      ref={shellRef}
      className={`app-shell live-shell ${window.forgeDesktop?.platform === "darwin" ? "platform-mac" : "platform-windows"} ${sidebarOpen ? "" : "sidebar-collapsed"}`}
      style={
        {
          "--sidebar-width": `${sidebarWidth}px`,
          "--panel-width": `${panelWidth}px`,
        } as React.CSSProperties
      }
    >
      {recoveryReview && (
        <RecoveryReview
          plan={recoveryReview}
          hasDraft={Boolean(draft.trim())}
          busy={busy}
          onCancel={() => {
            setRecoveryReview(undefined);
            void manage({ type: "dismiss-recovery" });
          }}
          onConfirm={() => {
            const plan = recoveryReview;
            setRecoveryReview(undefined);
            if (plan.kind === "retry") {
              setDrafts((values) => ({ ...values, [key]: plan.prompt }));
              setSelection(plan.selection);
              setEngine(plan.selection.engine);
              setPermission(plan.permissionProfile);
              setModel(plan.selection.model);
              setRetryPlan(plan);
              requestAnimationFrame(() => composerRef.current?.focus());
            } else {
              void send(true, plan);
            }
          }}
        />
      )}

      <div className="app-frame">
        <aside className="sidebar">
          <div className="studio-brand">
            <img src={logoUrl} alt="Forge" width={124} />
            <button
              type="button"
              className="studio-icon studio-sidebar-toggle"
              data-testid="sidebar-toggle"
              title={`Forge · ${t("studio.sidebar")}`}
              aria-label={`Forge · ${t("studio.sidebar")}`}
              aria-expanded={sidebarOpen}
              onClick={() => setSidebarOpen(!sidebarOpen)}
            >
              {sidebarOpen ? (
                <SidebarSimple size={19} />
              ) : (
                <img
                  className="studio-square-mark"
                  src={markUrl}
                  alt=""
                  width={32}
                  height={32}
                />
              )}
            </button>
          </div>
          <button
            type="button"
            className="studio-new-task"
            title={t("live.new")}
            aria-label={t("live.new")}
            disabled={busy}
            onClick={() => void newTask()}
          >
            <Plus size={17} />
            <span>{t("live.new")}</span>
          </button>
          <p className="studio-section-label">{t("common.recentTasks")}</p>
          <input
            data-testid="session-search"
            aria-label={zh ? "搜索历史任务" : "Search saved tasks"}
            placeholder={zh ? "搜索任务" : "Search tasks"}
            value={sessionQuery}
            onChange={(e) => setSessionQuery(e.target.value)}
          />
          <div className="live-sessions">
            {sessionQuery &&
              !navigationSessions.some((session) =>
                `${session.title} ${session.cwd ?? ""}`
                  .toLowerCase()
                  .includes(sessionQuery.toLowerCase()),
              ) && <p>{zh ? "没有匹配任务" : "No matching tasks"}</p>}
            {!navigationSessions.length && (
              <p className="studio-empty-list">{t("studio.noTasks")}</p>
            )}
            {navigationSessions
              .filter((session) =>
                `${session.title} ${session.cwd ?? ""}`
                  .toLowerCase()
                  .includes(sessionQuery.toLowerCase()),
              )
              .map((session) => (
                <button
                  type="button"
                  key={session.id}
                  data-session-id={session.id}
                  aria-current={
                    session.id === (viewed?.sessionId ?? state?.sessionId) &&
                    !settings
                      ? "page"
                      : undefined
                  }
                  title={`${session.title} · ${session.cwd ?? ""}`}
                  disabled={
                    pending || (viewLoading && session.id !== state?.sessionId)
                  }
                  onClick={() => {
                    if (session.id === state?.sessionId) {
                      if (activeRef.current || viewed) returnToExecution();
                      else void resumeSession(session.id);
                    } else if (activeRef.current || viewed)
                      void browseSession(session.id);
                    else void resumeSession(session.id);
                  }}
                >
                  <ChatCircle size={16} />
                  <span>
                    {session.title === "Empty session"
                      ? t("setup.emptyTask")
                      : session.title}
                  </span>
                  {active?.sessionId === session.id && (
                    <small className="session-running">
                      {t("browsing.runningBadge")}
                    </small>
                  )}
                </button>
              ))}
          </div>
          <div className="sidebar-bottom">
            <button
              title={t("common.settings")}
              aria-label={t("common.settings")}
              data-testid="settings"
              type="button"
              onClick={() => {
                setSettingsSection("appearance");
                setSettings(!settings);
              }}
            >
              <GearSix size={17} />
              <span className="settings-label">{t("common.settings")}</span>
            </button>
            <UpdateView compact />
          </div>
          {sidebarOpen && (
            <hr
              className="studio-sidebar-resize"
              tabIndex={0}
              aria-label={zh ? "调整任务侧边栏宽度" : "Resize task sidebar"}
              aria-orientation="vertical"
              aria-valuemin={160}
              aria-valuemax={360}
              aria-valuenow={displayedSidebarWidth}
              onPointerDown={(event) => {
                if (event.button !== 0) return;
                event.currentTarget.focus();
                sidebarDrag.current = {
                  x: event.clientX,
                  width:
                    event.currentTarget.parentElement?.getBoundingClientRect()
                      .width ?? sidebarWidth,
                };
                event.currentTarget.setPointerCapture(event.pointerId);
                event.preventDefault();
              }}
              onPointerMove={(event) => {
                if (!sidebarDrag.current) return;
                const pointerPanelReserve =
                  panel && window.innerWidth > 900
                    ? Math.min(panelWidth, window.innerWidth * 0.48)
                    : 0;
                setSidebarWidth(
                  Math.max(
                    160,
                    Math.min(
                      360,
                      window.innerWidth - 520 - pointerPanelReserve,
                      sidebarDrag.current.width +
                        event.clientX -
                        sidebarDrag.current.x,
                    ),
                  ),
                );
              }}
              onPointerUp={(event) => {
                sidebarDrag.current = undefined;
                if (event.currentTarget.hasPointerCapture(event.pointerId))
                  event.currentTarget.releasePointerCapture(event.pointerId);
              }}
              onPointerCancel={() => {
                sidebarDrag.current = undefined;
              }}
              onLostPointerCapture={() => {
                sidebarDrag.current = undefined;
              }}
              onDoubleClick={() => setSidebarWidth(224)}
              onKeyDown={(event) => {
                const delta = event.shiftKey ? 20 : 10;
                const next =
                  event.key === "Home"
                    ? 160
                    : event.key === "End"
                      ? sidebarMax
                      : event.key === "ArrowLeft"
                        ? displayedSidebarWidth - delta
                        : event.key === "ArrowRight"
                          ? displayedSidebarWidth + delta
                          : undefined;
                if (next === undefined) return;
                event.preventDefault();
                setSidebarWidth(Math.max(160, Math.min(sidebarMax, next)));
              }}
            />
          )}
        </aside>
        <section className="live-main">
          <WorkspaceHeader
            state={displayState}
            sidebarOpen={sidebarOpen}
            setSidebarOpen={setSidebarOpen}
            panel={panel}
            setPanel={setPanel}
            settings={settings}
            busy={busy || Boolean(viewed)}
            onChooseWorkspace={onChooseWorkspace}
            onNewTask={() => void newTask()}
            onSettings={() => {
              setSettingsSection("appearance");
              setSettings(!settings);
            }}
          />
          {(active || viewed || viewLoading) && (
            <div
              className="run-navigation"
              data-browsing={Boolean(viewed)}
              role="status"
              aria-live="polite"
            >
              <div>
                <strong>
                  {t(active ? "browsing.activeTask" : "browsing.executionTask")}
                  :{" "}
                  {state?.sessions.find(
                    (session) =>
                      session.id === (active?.sessionId ?? state?.sessionId),
                  )?.title ??
                    submittedRef.current?.prompt.slice(0, 80) ??
                    "Forge"}
                </strong>
                <span>
                  {approval
                    ? t("browsing.approvalCount", { count: approvals.length })
                    : active
                      ? t(`runUi.phases.${status}`, {
                          defaultValue: t("live.running"),
                        })
                      : t(
                          `runUi.outcomes.${completion?.outcome ?? "completed"}`,
                        )}
                </span>
                {viewed && (
                  <span>{t("browsing.viewing", { title: viewed.title })}</span>
                )}
              </div>
              {(viewed || settings || viewLoading) && (
                <button
                  type="button"
                  data-testid="return-active"
                  onClick={returnToExecution}
                >
                  {t("browsing.return")}
                </button>
              )}
              {active && (
                <button
                  type="button"
                  data-testid="stop-active"
                  disabled={status === "stopping"}
                  onClick={() => void cancel()}
                >
                  {t("live.stop")}
                </button>
              )}
              {viewed && !active && (
                <button
                  type="button"
                  data-testid="resume-viewed"
                  disabled={pending || viewLoading}
                  onClick={() => void resumeSession(viewed.sessionId)}
                >
                  {t("browsing.resume")}
                </button>
              )}
            </div>
          )}
          {setupIssue && !settings && (
            <section
              role="alert"
              className="studio-notice setup-notice"
              data-testid="setup-required"
            >
              <div>
                <strong>{t("setup.title")}</strong>
                <p>{t(`setup.${setupIssue}`)}</p>
                <p>{t("setup.draftKept")}</p>
              </div>
              <button
                type="button"
                onClick={() => {
                  setSettingsSection(
                    setupIssue.startsWith("codex_") ? "login" : "credentials",
                  );
                  setSettings(true);
                }}
              >
                {t("setup.configure")}
              </button>
            </section>
          )}
          {error && (
            <p role="alert" className="field-error">
              {t(`live.errors.${error}`, { defaultValue: t("live.error") })}
            </p>
          )}
          {notice && (
            <div role="status" className="studio-notice">
              <pre>{notice}</pre>
              {literalOffer && (
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void send(true)}
                >
                  {zh ? "作为普通消息发送" : "Send as message"}
                </button>
              )}
              <button
                type="button"
                onClick={() => setNotice("")}
                aria-label={zh ? "关闭" : "Dismiss"}
              >
                <X size={16} />
              </button>
            </div>
          )}
          {settings ? (
            <SettingsView
              initialSection={settingsSection}
              state={state}
              busy={busy || Boolean(viewed)}
              onBack={() => {
                setSettings(false);
                requestAnimationFrame(() => composerRef.current?.focus());
              }}
              manage={manage}
              onOpenLogin={() =>
                void api?.openLogin().catch(() => setError("management-failed"))
              }
            />
          ) : (
            <>
              <Transcript
                key={key}
                viewKey={key}
                live={Boolean(active) && !viewed}
                preservePosition={hasSavedPosition}
                followRequest={followRequest}
              >
                {viewed && (
                  <p className="browsing-note">
                    {t("browsing.snapshot")}
                    {viewed.truncated && ` ${t("browsing.truncated")}`}
                  </p>
                )}
                {!displayState?.messages.length && (!prompt || viewed) && (
                  <div className="studio-welcome">
                    <span className="studio-welcome-icon">
                      <img src={markUrl} alt="" width={72} height={72} />
                    </span>

                    <h1>{t("studio.title")}</h1>
                    <p>{t("studio.subtitle")}</p>
                    <div className="studio-suggestions">
                      {[
                        { key: "code", icon: Code },
                        { key: "document", icon: FileText },
                        { key: "research", icon: Globe },
                      ].map(({ key: suggestion, icon: Icon }) => (
                        <button
                          type="button"
                          key={suggestion}
                          onClick={() => {
                            setDrafts((values) => ({
                              ...values,
                              [key]: t(`studio.prompts.${suggestion}`),
                            }));
                            composerRef.current?.focus();
                          }}
                        >
                          <Icon size={20} />
                          <span>{t(`studio.suggestions.${suggestion}`)}</span>
                          <Plus size={14} />
                        </button>
                      ))}
                    </div>
                  </div>
                )}
                {displayState?.messages
                  .filter(
                    (message) =>
                      !(
                        message.kind === "system-outcome" &&
                        !viewed &&
                        message.runId === completionRunId &&
                        completion
                      ),
                  )
                  .map((message) =>
                    message.kind === "system-outcome" ? (
                      <RunResult
                        key={message.id}
                        historical
                        result={{
                          outcome: message.outcome ?? "failed",
                          message: message.content,
                        }}
                      />
                    ) : message.kind === "system-fallback" ? (
                      <SystemFallback
                        key={message.id}
                        original={message.content}
                        delivery={
                          message.runId === completionRunId && currentDelivery
                            ? currentDelivery
                            : displayState?.runHistory?.selected?.summary
                                  .runId === message.runId
                              ? displayState?.runHistory?.selected?.delivery
                              : undefined
                        }
                      />
                    ) : (
                      <ConversationMessage
                        key={message.id}
                        author={message.role}
                        content={message.content}
                      />
                    ),
                  )}
                {!viewed && prompt && (
                  <ConversationMessage author="user" content={prompt} />
                )}
                {!viewed &&
                answer &&
                completion?.answerSource === "system-fallback" &&
                !active ? (
                  <SystemFallback
                    original={answer}
                    delivery={currentDelivery}
                  />
                ) : !viewed && answer ? (
                  <ConversationMessage
                    author="assistant"
                    content={answer}
                    streaming={Boolean(active)}
                  />
                ) : null}
                {!viewed && omittedCharacters > 0 && (
                  <p role="status">
                    {t("messages.omitted", { count: omittedCharacters })}
                  </p>
                )}
                {!viewed && active && (
                  <div
                    className="studio-run-state"
                    role="status"
                    aria-live="polite"
                  >
                    {!approval && <span className="spinner" />}
                    <span>
                      {approval
                        ? t("runUi.waiting")
                        : t(`runUi.phases.${status}`, {
                            defaultValue: t("live.running"),
                          })}
                    </span>
                  </div>
                )}
                {!viewed && activity.items.length > 0 && (
                  <details
                    className="run-activity-disclosure"
                    data-view-disclosure="activity"
                  >
                    <summary>{t("live.activity")}</summary>
                    <RunActivity state={activity} />
                  </details>
                )}
                {!viewed && !active && completion && (
                  <RunResult
                    result={completion}
                    recoveryDisabled={
                      busy ||
                      !state?.runHistory?.runs.some(
                        (run) =>
                          run.runId === completionRunId &&
                          run.engine === "native",
                      )
                    }
                    onRecover={
                      completionRunId
                        ? (kind) => void prepareRecovery(kind, completionRunId)
                        : undefined
                    }
                    onConfigure={() => {
                      setSettingsSection(
                        engine === "codex" ? "login" : "credentials",
                      );
                      setSettings(true);
                    }}
                    onSource={(sourceRunId) => {
                      setPanel(true);
                      setPanelTab("context");
                      void manage({ type: "run-history", runId: sourceRunId });
                    }}
                  />
                )}
                {!viewed && !active && completionRunId && currentDelivery && (
                  <RunDelivery
                    key={completionRunId}
                    delivery={currentDelivery}
                    busy={busy}
                    onPreview={(path) => void previewDeliveryFile(path)}
                  />
                )}
              </Transcript>
              {!viewed && approval && (
                <ApprovalCard
                  key={approval.approvalId}
                  approval={approval}
                  count={approvals.length}
                  pending={approvalPending || status === "stopping"}
                  onDecide={decide}
                />
              )}
              {retryPlan && (
                <div className="run-retry-draft" role="status">
                  <span>{t("recovery.retryDraft")}</span>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => {
                      setRetryPlan(undefined);
                      void manage({ type: "dismiss-recovery" });
                    }}
                  >
                    {t("recovery.unlink")}
                  </button>
                </div>
              )}
              <div className="live-composer">
                {candidates.length > 0 && (
                  <SlashCommandMenu
                    candidates={candidates}
                    commandIndex={commandIndex}
                    busy={busy}
                    zh={zh}
                    executeSlash={executeSlash}
                  />
                )}
                <textarea
                  ref={composerRef}
                  rows={3}
                  role="combobox"
                  aria-autocomplete="list"
                  aria-expanded={candidates.length > 0}
                  aria-controls={candidates.length ? "slash-menu" : undefined}
                  aria-activedescendant={
                    candidates.length
                      ? `slash-option-${commandIndex % candidates.length}`
                      : undefined
                  }
                  onKeyDown={(event) => {
                    if (
                      event.nativeEvent.isComposing ||
                      event.nativeEvent.keyCode === 229
                    )
                      return;
                    if (event.key === "Enter" && event.shiftKey) return;
                    if (candidates.length) {
                      if (event.key === "Escape") {
                        event.preventDefault();
                        setCommandClosed(true);
                        return;
                      }
                      if (
                        event.key === "ArrowDown" ||
                        event.key === "ArrowUp"
                      ) {
                        event.preventDefault();
                        setCommandIndex(
                          (v) =>
                            (v +
                              (event.key === "ArrowDown"
                                ? 1
                                : candidates.length - 1)) %
                            candidates.length,
                        );
                        return;
                      }
                      if (event.key === "Tab") {
                        event.preventDefault();
                        setDrafts((v) => ({
                          ...v,
                          [key]:
                            "/" +
                            candidates[commandIndex % candidates.length]![0],
                        }));
                        setCommandClosed(true);
                        return;
                      }
                      if (event.key === "Enter") {
                        event.preventDefault();
                        void executeSlash(
                          "/" +
                            candidates[commandIndex % candidates.length]![0],
                        );
                        return;
                      }
                    }
                    if (event.key === "Enter" && !event.altKey) {
                      event.preventDefault();
                      void send();
                    }
                  }}
                  aria-label={t("home.placeholder")}
                  title={
                    zh
                      ? "Enter 发送，Shift+Enter 换行"
                      : "Enter to send, Shift+Enter for a new line"
                  }
                  placeholder={t("home.placeholder")}
                  value={draft}
                  onChange={(event) => {
                    setLiteralOffer(false);
                    setCommandIndex(0);
                    setCommandClosed(false);
                    setDrafts((values) => ({
                      ...values,
                      [key]: event.target.value,
                    }));
                  }}
                />
                {viewed ? (
                  <div className="browsing-draft-note">
                    {t(
                      active
                        ? "browsing.draftWhileRunning"
                        : "browsing.draftReady",
                    )}
                  </div>
                ) : (
                  <ComposerControls
                    state={state}
                    engine={engine}
                    model={model}
                    permission={permission}
                    setPermission={setPermission}
                    busy={busy}
                    importFile={importFile}
                    onEngineChange={(value) => {
                      setEngine(value);
                      setModel("");
                      setSelection(undefined);
                      setPermission(
                        value === "codex" ? "workspace-write" : "safe",
                      );
                    }}
                    selection={selection}
                    onSelection={(value) => {
                      setSelection(value);
                      setModel(value.model);
                    }}
                    onRefresh={async () => {
                      await manage({
                        type: engine === "codex" ? "models-refresh" : "state",
                      });
                    }}
                    onSave={async (value) =>
                      Boolean(
                        await manage({ type: "model-save", selection: value }),
                      )
                    }
                    active={Boolean(active)}
                    status={status}
                    cancel={cancel}
                    send={send}
                    lockSettings={Boolean(retryPlan)}
                    canSend={!busy && Boolean(draft.trim()) && Boolean(api)}
                  />
                )}
              </div>
            </>
          )}
        </section>
        {panel && !settings && (
          <aside
            className="live-panel"
            style={
              { "--panel-width": `${panelWidth}px` } as React.CSSProperties
            }
          >
            <button
              type="button"
              className="studio-panel-resize"
              aria-label={t("studio.panelWidth")}
              title={t("studio.panelWidth")}
              onPointerDown={(event) => {
                event.currentTarget.setPointerCapture(event.pointerId);
              }}
              onPointerMove={(event) => {
                if (event.currentTarget.hasPointerCapture(event.pointerId))
                  setPanelWidth(
                    Math.max(
                      280,
                      Math.min(600, window.innerWidth - event.clientX),
                    ),
                  );
              }}
              onPointerUp={(event) =>
                event.currentTarget.releasePointerCapture(event.pointerId)
              }
              onKeyDown={(event) => {
                if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
                  event.preventDefault();
                  setPanelWidth((value) =>
                    Math.max(
                      280,
                      Math.min(
                        600,
                        value + (event.key === "ArrowLeft" ? 20 : -20),
                      ),
                    ),
                  );
                }
              }}
            />
            <div className="studio-panel-header">
              <strong>{t("studio.workbench")}</strong>
              <button
                type="button"
                className="studio-icon"
                aria-label={t("studio.closePanel")}
                onClick={() => setPanel(false)}
              >
                <X size={17} />
              </button>
            </div>
            <div className="studio-tabs">
              {["files", "changes", "context"].map((tab) => (
                <button
                  type="button"
                  aria-pressed={panelTab === tab}
                  disabled={Boolean(viewed) && tab !== "context"}
                  key={tab}
                  onClick={() => setPanelTab(tab)}
                >
                  {t(`studio.tabs.${tab}`)}
                </button>
              ))}
            </div>
            <div className="studio-panel-body" hidden={panelTab !== "files"}>
              <h3>{t("live.files")}</h3>
              <input
                data-testid="file-path"
                aria-label={t("live.filePath")}
                placeholder={t("live.filePath")}
                value={filePath}
                onChange={(event) => setFilePath(event.target.value)}
              />
              <div className="file-actions">
                <button
                  type="button"
                  data-testid="preview-file"
                  disabled={!filePath || !state?.cwd}
                  onClick={() => {
                    void api
                      ?.previewFile({ path: filePath })
                      .then((value) => {
                        if (scopeRef.current === scope) setFilePreview(value);
                      })
                      .catch((cause) => {
                        if (scopeRef.current === scope)
                          setError(operationError(cause));
                      });
                  }}
                >
                  {t("live.preview")}
                </button>
                <button
                  type="button"
                  disabled={!filePath}
                  onClick={() =>
                    void api
                      ?.openFile(filePath)
                      .catch((cause) => setError(operationError(cause)))
                  }
                >
                  {t("common.open")}
                </button>
                <button
                  type="button"
                  disabled={!filePath}
                  onClick={() =>
                    void api
                      ?.revealFile(filePath)
                      .catch((cause) => setError(operationError(cause)))
                  }
                >
                  {t("live.reveal")}
                </button>
                <button
                  type="button"
                  disabled={!filePath}
                  onClick={() =>
                    void api
                      ?.saveFileAs(filePath)
                      .catch((cause) => setError(operationError(cause)))
                  }
                >
                  {t("live.saveAs")}
                </button>
              </div>
              {filePreview && (
                <section className="artifact-preview">
                  <h4>{filePreview.document.source}</h4>
                  {filePreview.truncated && (
                    <p className="preview-limit">{t("live.previewLimited")}</p>
                  )}
                  <ContentPreview preview={filePreview} />
                </section>
              )}
              {!filePreview && (
                <div className="studio-panel-empty">
                  <FileText size={30} />
                  <p>{t("studio.fileHint")}</p>
                </div>
              )}
            </div>
            <div className="studio-panel-body" hidden={panelTab !== "changes"}>
              <h3>{t("live.changes")}</h3>
              <button
                type="button"
                data-testid="refresh-review"
                disabled={!state?.cwd}
                onClick={() =>
                  void api
                    ?.reviewChanges()
                    .then((value) => {
                      if (scopeRef.current === scope) setReview(value);
                    })
                    .catch((cause) => {
                      if (scopeRef.current === scope)
                        setError(operationError(cause));
                    })
                }
              >
                {t("live.refreshChanges")}
              </button>
              {review && (
                <div className="change-review">
                  <small>
                    {t("live.baseline")}:{" "}
                    {t(`live.baselines.${review.baseline}`)}
                  </small>
                  <details className="studio-review-scope">
                    <summary>{t("studio.reviewScope")}</summary>
                    {review.limitations.map((limit) => (
                      <small key={limit}>
                        {t(`live.reviewLimits.${limit}`)}
                      </small>
                    ))}
                    <small>
                      Forge:{" "}
                      {t(`live.engineCoverage.${review.engineCoverage.native}`)}
                    </small>
                    <small>
                      Codex:{" "}
                      {t(`live.engineCoverage.${review.engineCoverage.codex}`)}
                    </small>
                  </details>
                  {!review.entries.length && <p>{t("live.noChanges")}</p>}
                  {review.entries.map((entry) => (
                    <details key={entry.path}>
                      <summary>
                        {t(`live.changeStatus.${entry.status}`)} · {entry.path}
                      </summary>
                      <DiffViewer entry={entry} />
                    </details>
                  ))}
                </div>
              )}
              {!review && (
                <div className="studio-panel-empty">
                  <Code size={30} />
                  <p>{t("studio.reviewHint")}</p>
                </div>
              )}
            </div>
            <div className="studio-panel-body" hidden={panelTab !== "context"}>
              <RunHistory
                key={key}
                history={viewed?.runHistory ?? state?.runHistory}
                onPreview={(path) => void previewDeliveryFile(path)}
                busy={pending || viewLoading}
                executionBusy={Boolean(active) || Boolean(viewed)}
                onRecover={(kind, sourceRunId) =>
                  void prepareRecovery(kind, sourceRunId)
                }
                onLoad={async (command) => {
                  if (viewedRef.current)
                    await browseSession(
                      viewedRef.current.sessionId,
                      command.runId,
                      command.before,
                    );
                  else if (activeRef.current && api && state?.sessionId) {
                    const sourceSession = state.sessionId;
                    const view = await readSession(
                      sourceSession,
                      command.runId,
                      command.before,
                    );
                    if (view)
                      setState((value) =>
                        value?.sessionId === sourceSession
                          ? { ...value, runHistory: view.runHistory }
                          : value,
                      );
                  } else await manage(command);
                }}
              />
              {!viewed && activity.items.length > 0 && (
                <>
                  <h3>{t("live.activity")}</h3>
                  <RunActivity state={activity} />
                </>
              )}
              <details className="run-diagnostics" hidden={Boolean(viewed)}>
                <summary>{t("live.context")}</summary>
                <pre>{state?.context}</pre>
                <button
                  type="button"
                  disabled={busy || !state?.sessionId}
                  onClick={() => void manage({ type: "compact" })}
                >
                  {t("live.compact")}
                </button>
              </details>
              {!viewed && <p>{t("live.verification")}</p>}
            </div>
          </aside>
        )}
      </div>
    </main>
  );
}

function operationError(error: unknown): string {
  const message = error instanceof Error ? error.message : "";
  return (
    [
      "recovery-stale",
      "recovery-native-only",
      "recovery-source-active",
      "recovery-original-unavailable",
      "recovery-prompt-too-large",
      "recovery-select-source",
      "workspace-unavailable",
      "workspace-changed",
      "auto-workspace-boundary",
      "session-busy",
      "session-conflict",
      "session-storage-failed",
      "configuration-invalid",
      "outside-workspace",
      "outside_workspace",
      "already-exists",
      "limit_reached",
      "io_error",
      "source-changed",
      "web-settings-invalid",
      "web-bundle-unavailable",
      "web-plugin-exists",
      "web-plugin-missing",
    ].find((code) => message.includes(code)) ?? "management-failed"
  );
}
