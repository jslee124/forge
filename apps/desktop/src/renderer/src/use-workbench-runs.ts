import type { ProductRunCompletion } from "@forge/application";
import type { ProductRunDelivery } from "@forge/persistence";
import React from "react";
import { useTranslation } from "react-i18next";
import type {
  BrowsedSession,
  DesktopState,
  ManagementCommand,
  ModelSelection,
  RecoveryPlan,
} from "../../shared/application-protocol.js";
import type { DesktopApi } from "../../shared/desktop-api.js";
import type { RunEvent, RunPayload } from "../../shared/run-protocol.js";
import { activityReducer, initialActivity } from "./run-state.js";
import {
  createSessionRun,
  reduceSessionRun,
  type SessionRun,
} from "./session-runs.js";
import { commands, routeCommand } from "./slash-commands.js";
import { useStreamedAnswer } from "./use-streamed-answer.js";
import { operationError } from "./workbench-errors.js";

export interface UseWorkbenchRunsArgs {
  readonly api: DesktopApi | undefined;
  readonly zh: boolean;
  readonly state: DesktopState | undefined;
  readonly setState: React.Dispatch<
    React.SetStateAction<DesktopState | undefined>
  >;
  readonly drafts: Record<string, string>;
  readonly setDrafts: React.Dispatch<
    React.SetStateAction<Record<string, string>>
  >;
  readonly draft: string;
  readonly draftKey: string;
  readonly engine: "native" | "codex";
  readonly setEngine: React.Dispatch<React.SetStateAction<"native" | "codex">>;
  readonly model: string;
  readonly setModel: React.Dispatch<React.SetStateAction<string>>;
  readonly selection: ModelSelection | undefined;
  readonly setSelection: React.Dispatch<
    React.SetStateAction<ModelSelection | undefined>
  >;
  readonly permission: "safe" | "workspace-write";
  readonly setPermission: React.Dispatch<
    React.SetStateAction<"safe" | "workspace-write">
  >;
  readonly pending: boolean;
  readonly setPending: React.Dispatch<React.SetStateAction<boolean>>;
  readonly setError: React.Dispatch<React.SetStateAction<string>>;
  readonly setNotice: React.Dispatch<React.SetStateAction<string>>;
  readonly setLiteralOffer: React.Dispatch<React.SetStateAction<boolean>>;
  readonly setCommandClosed: React.Dispatch<React.SetStateAction<boolean>>;
  readonly setSettings: React.Dispatch<React.SetStateAction<boolean>>;
  readonly setSettingsSection: React.Dispatch<React.SetStateAction<string>>;
  readonly setSidebarOpen: React.Dispatch<React.SetStateAction<boolean>>;
  readonly setPanel: React.Dispatch<React.SetStateAction<boolean>>;
  readonly setPanelTab: React.Dispatch<React.SetStateAction<string>>;
  readonly viewed: BrowsedSession | undefined;
  readonly viewedRef: React.RefObject<BrowsedSession | undefined>;
  readonly savePosition: () => void;
  readonly prepareExecutionView: (
    sessionId: string,
    canCaptureCurrent: boolean,
  ) => { panel: boolean; tab: string };
  readonly invalidateRead: () => void;
  readonly clearBrowsing: () => void;
  readonly composerRef: React.RefObject<HTMLTextAreaElement | null>;
}

export function useWorkbenchRuns({
  api,
  zh,
  state,
  setState,
  drafts,
  setDrafts,
  draft,
  draftKey,
  engine,
  setEngine,
  model,
  setModel,
  selection,
  setSelection,
  permission,
  setPermission,
  pending,
  setPending,
  setError,
  setNotice,
  setLiteralOffer,
  setCommandClosed,
  setSettings,
  setSettingsSection,
  setSidebarOpen,
  setPanel,
  setPanelTab,
  viewed,
  viewedRef,
  savePosition,
  prepareExecutionView,
  invalidateRead,
  clearBrowsing,
  composerRef,
}: UseWorkbenchRunsArgs) {
  const { t } = useTranslation();
  const [active, setActive] = React.useState<{
    sessionId: string;
    runId: string;
    requestId: string;
  }>();
  const activeRef = React.useRef(active);
  const sessionRuns = React.useRef(new Map<string, SessionRun>());
  const [, refreshRuns] = React.useReducer((value: number) => value + 1, 0);
  const selectedSessionRef = React.useRef(state?.sessionId);
  selectedSessionRef.current = state?.sessionId;
  const [status, setStatus] = React.useState("ready");
  const {
    answer,
    omittedCharacters,
    append: appendAnswer,
    flush: flushAnswer,
    reset: resetAnswer,
    replace: replaceAnswer,
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
  const [setupIssue, setSetupIssue] = React.useState<
    | "missing_credentials"
    | "invalid_configuration"
    | "codex_sign_in"
    | "codex_unavailable"
  >();
  const [recoveryReview, setRecoveryReview] = React.useState<RecoveryPlan>();
  const [retryPlan, setRetryPlan] = React.useState<RecoveryPlan>();
  const commandPending = React.useRef(false);
  const startSubmitting = React.useRef(false);
  const busy = Boolean(active) || pending;

  const clearActivity = React.useCallback(() => {
    dispatchActivity({ type: "reset" });
    setCompletion(undefined);
    setCompletionRunId(undefined);
    setCurrentDelivery(undefined);
  }, []);

  React.useEffect(() => {
    const guard = (event: BeforeUnloadEvent) => {
      if (
        [...sessionRuns.current.values()].some((run) => run.active) ||
        busy ||
        Object.values(drafts).some((value) => value.trim())
      ) {
        event.preventDefault();
        event.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", guard);
    return () => window.removeEventListener("beforeunload", guard);
  }, [busy, drafts]);

  const manage = React.useCallback(
    async (command: Exclude<ManagementCommand, { type: "workspace" }>) => {
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
    },
    [api, selection, setError, setModel, setPending, setSelection, setState],
  );

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
  }, [composerRef, viewedRef]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: Initial load and global event subscription bind once to the current bridge.
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
      const stored = sessionRuns.current.get(event.sessionId);
      if (stored) {
        const updated = reduceSessionRun(stored, event);
        sessionRuns.current.set(event.sessionId, updated);
        // Completed conversations live on disk; bound their transient live projections.
        const completed = [...sessionRuns.current.entries()].filter(
          ([, run]) => !run.active,
        );
        for (const [id] of completed.slice(0, -20)) {
          if (id !== selectedSessionRef.current) sessionRuns.current.delete(id);
        }
        refreshRuns();
        if (
          stored.active &&
          !updated.active &&
          event.payload.type === "complete" &&
          event.payload.outcome !== "completed" &&
          !stored.preserveDraft
        )
          setDrafts((values) =>
            values[event.sessionId]?.trim()
              ? values
              : { ...values, [event.sessionId]: stored.prompt },
          );
      }
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
      else if (payload.type === "phase")
        setStatus(
          sessionRuns.current.get(event.sessionId)?.status ?? payload.phase,
        );
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
              if (
                !disposed &&
                selectedSessionRef.current === current.sessionId &&
                next.sessionId === current.sessionId
              ) {
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

  // biome-ignore lint/correctness/useExhaustiveDependencies: Polling only reacts to auth transition while signing-in.
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

  const newTask = async (mode: "new" | "clear" = "new") => {
    const next = await manage({ type: "reset", mode });
    if (!next) return false;
    activeRef.current = undefined;
    setActive(undefined);
    setApprovals([]);
    submittedRef.current = undefined;
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

  const removeSession = async (sessionId: string) => {
    if (pending || activeRef.current) return false;
    const wasCurrent = state?.sessionId === sessionId;
    const wasViewed = viewed?.sessionId === sessionId;
    const next = await manage({ type: "delete-session", sessionId });
    if (!next) return false;
    setDrafts((values) => {
      const remaining = { ...values };
      delete remaining[sessionId];
      return remaining;
    });
    if (wasCurrent || wasViewed) {
      clearBrowsing();
      setPrompt("");
      resetAnswer();
      clearActivity();
      setStatus("ready");
      setPanel(false);
    }
    return true;
  };

  const resumeSession = async (sessionId: string) => {
    if (pending) return;
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
    const run = sessionRuns.current.get(sessionId);
    const identity = run?.active ? run.identity : undefined;
    activeRef.current = identity;
    setActive(identity);
    submittedRef.current = run
      ? {
          sessionId,
          prompt: run.prompt,
          preserveDraft: Boolean(run.preserveDraft),
        }
      : undefined;
    setStatus(run?.status ?? "ready");
    setNotice("");
    dispatchActivity({
      type: "restore",
      state: run?.activity ?? initialActivity,
    });
    setCompletion(run?.completion);
    setCompletionRunId(run?.completion ? run.identity.runId : undefined);
    setCurrentDelivery(next.runHistory?.selected?.delivery);
    setPrompt(run?.active ? run.prompt : "");
    replaceAnswer(run?.active ? run.answer : "", run?.active ? run.omitted : 0);
    setApprovals(run?.active ? run.approvals : []);
    setApprovalPending(false);
    approvalSubmitting.current = false;
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
        values[draftKey] === draft ? { ...values, [draftKey]: "" } : values,
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
      responseLocale: zh ? "zh-CN" : "en",
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
      sessionRuns.current.set(
        current.sessionId,
        createSessionRun(identity, input, Boolean(preserveDraft)),
      );
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
          [draftKey]:
            values[draftKey] === draft ? "" : (values[draftKey] ?? ""),
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
        const failed = sessionRuns.current.get(current.sessionId);
        if (failed)
          sessionRuns.current.set(current.sessionId, {
            ...failed,
            active: false,
            status: "failed",
            completion: { outcome: "failed", reason: "execution_error" },
          });
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
      if (submitted) {
        const failed = sessionRuns.current.get(submitted.sessionId);
        if (failed)
          sessionRuns.current.set(submitted.sessionId, {
            ...failed,
            active: false,
            status: "failed",
          });
      }
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
      if (activeRef.current === current) {
        setError("management-failed");
        setStatus(approval ? "approval" : "running");
      }
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
    const current = active;
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
      ) {
        if (activeRef.current === current) setError("management-failed");
      }
    } catch {
      if (activeRef.current === current) setError("management-failed");
    } finally {
      if (activeRef.current === current) {
        approvalSubmitting.current = false;
        setApprovalPending(false);
      }
    }
  };

  return {
    active,
    activeRef,
    sessionRuns,
    status,
    answer,
    omittedCharacters,
    resetAnswer,
    followRequest,
    prompt,
    setPrompt,
    activity,
    clearActivity,
    completion,
    completionRunId,
    currentDelivery,
    submittedRef,
    approvals,
    approval,
    approvalPending,
    setupIssue,
    recoveryReview,
    setRecoveryReview,
    retryPlan,
    setRetryPlan,
    manage,
    newTask,
    removeSession,
    resumeSession,
    executeSlash,
    prepareRecovery,
    send,
    cancel,
    decide,
  };
}
