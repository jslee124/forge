import { Code } from "@phosphor-icons/react/Code";
import { FileText } from "@phosphor-icons/react/FileText";
import { Globe } from "@phosphor-icons/react/Globe";
import { Plus } from "@phosphor-icons/react/Plus";
import { X } from "@phosphor-icons/react/X";
import React from "react";
import { useTranslation } from "react-i18next";
import type {
  DesktopState,
  ManagementCommand,
  ModelSelection,
} from "../../shared/application-protocol.js";
import type { ChangeReview, FilePreview } from "../../shared/file-protocol.js";
import { ApprovalCard } from "./approval-card.js";
import markUrl from "./assets/forge-mark.svg";
import { ConversationMessage } from "./conversation-message.js";
import { RecoveryFacts } from "./recovery-facts.js";
import { RecoveryReview } from "./recovery-review.js";
import { RunActivity } from "./run-activity.js";
import { RunDelivery } from "./run-delivery.js";
import { RunResult } from "./run-result.js";
import { SettingsView } from "./settings-view.js";
import { suggestions } from "./slash-commands.js";
import { SystemFallback } from "./system-fallback.js";
import { Transcript } from "./transcript.js";
import { useConversationBrowser } from "./use-conversation-browser.js";
import { useWorkbenchRuns } from "./use-workbench-runs.js";
import { WorkbenchComposer } from "./workbench-composer.js";
import { operationError } from "./workbench-errors.js";
import { WorkbenchPanel } from "./workbench-panel.js";
import { WorkbenchSidebar } from "./workbench-sidebar.js";
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
  React.useEffect(() => {
    localStorage.setItem("forge.desktop.sidebarWidth", String(sidebarWidth));
  }, [sidebarWidth]);
  const [panelWidth, setPanelWidth] = React.useState(360);
  const composerRef = React.useRef<HTMLTextAreaElement>(null);
  const [state, setState] = React.useState<DesktopState>();
  const [drafts, setDrafts] = React.useState<Record<string, string>>({});
  const [engine, setEngine] = React.useState<"native" | "codex">("native");
  const [model, setModel] = React.useState("");
  const [selection, setSelection] = React.useState<ModelSelection>();
  const [sessionToDelete, setSessionToDelete] = React.useState<{
    id: string;
    title: string;
  }>();
  const [sessionQuery, setSessionQuery] = React.useState("");
  const [permission, setPermission] = React.useState<
    "safe" | "workspace-write"
  >("safe");
  const sessionSelections = React.useRef(
    new Map<
      string,
      {
        engine: "native" | "codex";
        model: string;
        selection: ModelSelection | undefined;
        permission: "safe" | "workspace-write";
      }
    >(),
  );
  const [error, setError] = React.useState("");
  const [pending, setPending] = React.useState(false);
  const [settings, setSettings] = React.useState(false);
  const [settingsSection, setSettingsSection] = React.useState("appearance");
  const [panel, setPanel] = React.useState(false);
  const [commandIndex, setCommandIndex] = React.useState(0);
  const [commandClosed, setCommandClosed] = React.useState(false);
  const [literalOffer, setLiteralOffer] = React.useState(false);
  const [notice, setNotice] = React.useState("");

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
  const executionScope = `${state?.sessionId ?? ""}:${state?.cwd ?? ""}`;
  const scope = viewed ? `${viewed.sessionId}:${viewed.cwd}` : executionScope;
  const scopeRef = React.useRef(scope);
  scopeRef.current = scope;
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

  const draft = drafts[key] ?? "";
  const candidates = viewed || commandClosed ? [] : suggestions(draft);
  const zh = i18n.language.startsWith("zh");
  const api = window.forgeDesktop;
  React.useEffect(() => {
    void api?.setLocale?.(zh ? "zh-CN" : "en").catch(() => {});
  }, [zh]);

  const runs = useWorkbenchRuns({
    api,
    zh,
    state,
    setState,
    drafts,
    setDrafts,
    draft,
    draftKey: key,
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
  });

  const {
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
  } = runs;

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
      const saved = sessionSelections.current.get(state?.sessionId ?? "");
      setSelection(saved?.selection);
      setModel(saved?.model ?? "");
      setPermission(saved?.permission ?? "safe");
      if (saved) setEngine(saved.engine);
    }
  }, [executionScope, state?.sessionId]);

  React.useEffect(() => {
    if (state?.sessionId)
      sessionSelections.current.set(state.sessionId, {
        engine,
        model,
        selection,
        permission,
      });
  }, [state?.sessionId, engine, model, selection, permission]);

  const busy = Boolean(active) || pending;
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

  const retainedRun =
    !displayState?.messages.length && (!prompt || viewed)
      ? (displayState?.runHistory?.selected?.summary ??
        displayState?.runHistory?.runs[0])
      : undefined;

  const loadHistory = async (
    command: Extract<ManagementCommand, { type: "run-history" }>,
  ) => {
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
  };

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

  const handleRemoveSession = async () => {
    if (!sessionToDelete) return;
    if (await removeSession(sessionToDelete.id)) {
      setSessionToDelete(undefined);
      requestAnimationFrame(() => composerRef.current?.focus());
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
        <WorkbenchSidebar
          zh={zh}
          sidebarOpen={sidebarOpen}
          setSidebarOpen={setSidebarOpen}
          sidebarWidth={sidebarWidth}
          setSidebarWidth={setSidebarWidth}
          sidebarMax={sidebarMax}
          displayedSidebarWidth={displayedSidebarWidth}
          panel={panel}
          panelWidth={panelWidth}
          pending={pending}
          busy={busy}
          viewLoading={viewLoading}
          error={error}
          settings={settings}
          currentSessionId={state?.sessionId}
          viewedSessionId={viewed?.sessionId}
          sessionQuery={sessionQuery}
          setSessionQuery={setSessionQuery}
          navigationSessions={navigationSessions}
          getSessionRun={(id) => sessionRuns.current.get(id)}
          sessionToDelete={sessionToDelete}
          setSessionToDelete={setSessionToDelete}
          onNewTask={() => newTask()}
          onReturnToExecution={returnToExecution}
          onResumeSession={resumeSession}
          onRemoveSession={handleRemoveSession}
          onToggleSettings={() => {
            setSettingsSection("appearance");
            setSettings(!settings);
          }}
        />
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
                {retainedRun && (
                  <section
                    className="retained-task"
                    aria-labelledby="retained-task-title"
                  >
                    <h2 id="retained-task-title">
                      {t(
                        retainedRun.completion?.outcome === "interrupted"
                          ? "browsing.interruptedTitle"
                          : "browsing.retainedTitle",
                      )}
                    </h2>
                    <section
                      className="retained-task-prompt"
                      aria-label={t("browsing.savedRequest")}
                      // biome-ignore lint/a11y/noNoninteractiveTabindex: Scrollable saved requests need keyboard scrolling.
                      tabIndex={0}
                    >
                      {retainedRun.prompt}
                    </section>
                    <p>{t("browsing.retainedDescription")}</p>
                    <button
                      type="button"
                      disabled={pending || viewLoading}
                      onClick={async () => {
                        await loadHistory({
                          type: "run-history",
                          runId: retainedRun.runId,
                        });
                        setPanel(true);
                        setPanelTab("context");
                      }}
                    >
                      {t("browsing.openRecord")}
                    </button>
                  </section>
                )}
                {!retainedRun &&
                  !displayState?.messages.length &&
                  (!prompt || viewed) && (
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
                      <div key={message.id}>
                        {message.role === "assistant" &&
                          message.runId ===
                            displayState?.runHistory?.selected?.summary.runId &&
                          displayState?.runHistory?.selected
                            ?.recoverySource && (
                            <RecoveryFacts
                              source={
                                displayState?.runHistory?.selected
                                  ?.recoverySource
                              }
                              onPreview={(path) =>
                                void previewDeliveryFile(path)
                              }
                            />
                          )}
                        <ConversationMessage
                          author={message.role}
                          content={message.content}
                          explanation={Boolean(
                            message.role === "assistant" &&
                              displayState?.runHistory?.runs.some(
                                (run) =>
                                  run.runId === message.runId &&
                                  run.recovery?.kind === "summarize",
                              ),
                          )}
                        />
                      </div>
                    ),
                  )}
                {!viewed && prompt && (
                  <ConversationMessage author="user" content={prompt} />
                )}
                {!viewed &&
                  answer &&
                  completionRunId ===
                    state?.runHistory?.selected?.summary.runId &&
                  state?.runHistory?.selected?.recoverySource && (
                    <RecoveryFacts
                      source={state?.runHistory?.selected?.recoverySource}
                      onPreview={(path) => void previewDeliveryFile(path)}
                    />
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
                    explanation={completion?.recovery?.kind === "summarize"}
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
              <WorkbenchComposer
                composerRef={composerRef}
                zh={zh}
                viewed={Boolean(viewed)}
                active={Boolean(active)}
                busy={busy}
                hasApi={Boolean(api)}
                status={status}
                draftKey={key}
                draft={draft}
                setDrafts={setDrafts}
                candidates={candidates}
                commandIndex={commandIndex}
                setCommandIndex={setCommandIndex}
                setCommandClosed={setCommandClosed}
                setLiteralOffer={setLiteralOffer}
                state={state}
                engine={engine}
                model={model}
                permission={permission}
                setPermission={setPermission}
                selection={selection}
                retryPlan={retryPlan}
                onUnlinkRetry={() => {
                  setRetryPlan(undefined);
                  void manage({ type: "dismiss-recovery" });
                }}
                onImportFile={importFile}
                onEngineChange={(value) => {
                  setEngine(value);
                  setModel("");
                  setSelection(undefined);
                  setPermission(value === "codex" ? "workspace-write" : "safe");
                }}
                onSelection={(value) => {
                  setSelection(value);
                  setModel(value.model);
                }}
                onRefreshModels={async () => {
                  await manage({
                    type: engine === "codex" ? "models-refresh" : "state",
                  });
                }}
                onSaveSelection={async (value) =>
                  Boolean(
                    await manage({ type: "model-save", selection: value }),
                  )
                }
                onExecuteSlash={executeSlash}
                onCancel={cancel}
                onSend={send}
              />
            </>
          )}
        </section>
        {panel && !settings && (
          <WorkbenchPanel
            api={api}
            state={state}
            viewed={viewed}
            viewLoading={viewLoading}
            active={Boolean(active)}
            busy={busy}
            pending={pending}
            scope={scope}
            scopeRef={scopeRef}
            historyKey={key}
            panelWidth={panelWidth}
            setPanelWidth={setPanelWidth}
            panelTab={panelTab}
            setPanelTab={setPanelTab}
            setPanel={setPanel}
            filePath={filePath}
            setFilePath={setFilePath}
            filePreview={filePreview}
            setFilePreview={setFilePreview}
            review={review}
            setReview={setReview}
            activity={activity}
            onError={setError}
            onPreviewFile={previewDeliveryFile}
            onPrepareRecovery={prepareRecovery}
            onLoadHistory={loadHistory}
            onCompact={async () => {
              await manage({ type: "compact" });
            }}
          />
        )}
      </div>
    </main>
  );
}
