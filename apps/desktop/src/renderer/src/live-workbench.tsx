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
} from "../../shared/application-protocol.js";
import type { ChangeReview, FilePreview } from "../../shared/file-protocol.js";
import type { RunEvent } from "../../shared/run-protocol.js";
import logoUrl from "./assets/forge-logo.svg";
import markUrl from "./assets/forge-mark.svg";
import { ComposerControls } from "./composer-controls.js";
import { ContentPreview, DiffViewer } from "./file-preview.js";
import { Markdown } from "./markdown.js";
import { SettingsView } from "./settings-view.js";
import { SlashCommandMenu } from "./slash-command-menu.js";
import { commands, routeCommand, suggestions } from "./slash-commands.js";
import { WorkspaceHeader } from "./workspace-header.js";

export function LiveWorkbench(): React.JSX.Element {
  const { t, i18n } = useTranslation();
  const [panelTab, setPanelTab] = React.useState("files");
  const [sidebarOpen, setSidebarOpen] = React.useState(true);
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
  const [answer, setAnswer] = React.useState("");
  const [prompt, setPrompt] = React.useState("");
  const [details, setDetails] = React.useState<
    { id: number; kind: string; text: string }[]
  >([]);
  const [approval, setApproval] = React.useState<{
    approvalId: string;
    description: string;
  }>();
  const [error, setError] = React.useState("");
  const [pending, setPending] = React.useState(false);
  const [settings, setSettings] = React.useState(false);
  const [panel, setPanel] = React.useState(false);
  const [filePath, setFilePath] = React.useState("");
  const [filePreview, setFilePreview] = React.useState<FilePreview>();
  const [review, setReview] = React.useState<ChangeReview>();
  const scope = `${state?.sessionId ?? ""}:${state?.cwd ?? ""}`;
  const scopeRef = React.useRef(scope);
  scopeRef.current = scope;
  const previousSelectionScope = React.useRef(scope);
  // biome-ignore lint/correctness/useExhaustiveDependencies: Changing tasks must invalidate the previous task's artifact state.
  React.useEffect(() => {
    setFilePath("");
    setFilePreview(undefined);
    setReview(undefined);
    const previous = previousSelectionScope.current;
    previousSelectionScope.current = scope;
    if (!(previous.startsWith(":") && !scope.startsWith(":"))) {
      setSelection(undefined);
      setModel("");
      setPermission("safe");
    }
  }, [scope]);
  const key = state?.sessionId || `new:${state?.cwd ?? ""}`;
  const draft = drafts[key] ?? "";
  const [commandIndex, setCommandIndex] = React.useState(0);
  const [commandClosed, setCommandClosed] = React.useState(false);
  const commandPending = React.useRef(false);
  const [literalOffer, setLiteralOffer] = React.useState(false);
  const [notice, setNotice] = React.useState("");
  const candidates = commandClosed ? [] : suggestions(draft);
  const zh = i18n.language.startsWith("zh");
  const busy = Boolean(active) || pending;
  const api = window.forgeDesktop;
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
      setState(next);
      return next;
    } catch (cause) {
      setError(operationError(cause));
      return;
    } finally {
      setPending(false);
    }
  };
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
      if (payload.type === "text")
        setAnswer((value) => (value + payload.text).slice(-1_000_000));
      else if (payload.type === "detail")
        setDetails((value) => [
          ...value.slice(-199),
          { ...payload, id: event.sequence },
        ]);
      else if (payload.type === "approval") {
        setApproval(payload);
        setStatus("approval");
      } else {
        activeRef.current = undefined;
        setActive(undefined);
        setApproval(undefined);
        setStatus(payload.outcome);
        if (payload.outcome === "completed")
          setDrafts((values) => ({ ...values, [current.sessionId]: "" }));
        if (payload.outcome !== "interrupted") {
          setPending(true);
          void api
            .manage({ type: "state" })
            .then((next) => {
              if (!disposed) {
                setState(next);
                setPrompt("");
                setAnswer("");
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
  }, []);
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
        setAnswer("");
        setDetails([]);
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
    setPrompt("");
    setAnswer("");
    setDetails([]);
    setSettings(false);
    setPanel(false);
    setStatus("ready");
    return true;
  };
  const executeSlash = async (input: string) => {
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
    if (result.target === "settings") setSettings(true);
    else if (result.target === "resume") {
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
  const send = async (literal = false) => {
    if (!draft.trim() || !api) return;
    if (!literal && draft.trim().startsWith("/")) {
      await executeSlash(draft);
      return;
    }
    if (busy || commandPending.current) return;
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
    setPending(true);
    setError("");
    try {
      const current = state?.sessionId
        ? state
        : await api.manage({ type: "create", prompt: draft });
      setState(current);
      const identity = {
        sessionId: current.sessionId,
        runId: crypto.randomUUID(),
        requestId: crypto.randomUUID(),
      };
      activeRef.current = identity;
      setActive(identity);
      setStatus("running");
      setPrompt(draft);
      setAnswer("");
      setDetails([]);
      const accepted = await api.runCommand({
        type: "start",
        ...identity,
        prompt: draft,
        engine,
        permissionProfile: permission,
        ...(selection
          ? {
              model: selection.model,
              provider: selection.provider,
              ...(selection.effort
                ? { reasoningEffort: selection.effort }
                : {}),
            }
          : model
            ? { model }
            : {}),
      });
      if (!accepted) {
        activeRef.current = undefined;
        setActive(undefined);
        setStatus("failed");
        setError("management-failed");
      } else
        setDrafts((values) => ({
          ...values,
          [key]: "",
          [current.sessionId]: draft,
        }));
    } catch {
      setError("management-failed");
      setStatus("failed");
      activeRef.current = undefined;
      setActive(undefined);
    } finally {
      setPending(false);
    }
  };
  const cancel = async () => {
    if (!active || !api) return;
    setStatus("stopping");
    setApproval(undefined);
    try {
      if (
        !(await api.runCommand({
          ...active,
          type: "cancel",
          requestId: crypto.randomUUID(),
        }))
      )
        setError("management-failed");
    } catch {
      setError("management-failed");
    }
  };
  const decide = async (allow: boolean) => {
    if (!active || !approval || !api) return;
    const approvalId = approval.approvalId;
    setApproval(undefined);
    setStatus("running");
    try {
      if (
        !(await api.runCommand({
          ...active,
          type: "approve",
          requestId: crypto.randomUUID(),
          approvalId,
          allow,
        }))
      )
        setError("management-failed");
    } catch {
      setError("management-failed");
    }
  };
  return (
    <main
      className={`app-shell live-shell ${sidebarOpen ? "" : "sidebar-collapsed"}`}
    >
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
          <button type="button" disabled={busy} onClick={() => void newTask()}>
            <Plus size={17} />
            {t("live.new")}
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
              !state?.sessions.some((session) =>
                `${session.title} ${session.cwd ?? ""}`
                  .toLowerCase()
                  .includes(sessionQuery.toLowerCase()),
              ) && <p>{zh ? "没有匹配任务" : "No matching tasks"}</p>}
            {!state?.sessions.length && (
              <p className="studio-empty-list">{t("studio.noTasks")}</p>
            )}
            {state?.sessions
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
                    session.id === state?.sessionId && !settings
                      ? "page"
                      : undefined
                  }
                  title={`${session.title} · ${session.cwd ?? ""}`}
                  disabled={busy}
                  onClick={async () => {
                    if (session.cwd && state?.cwd && session.cwd !== state.cwd)
                      setNotice(
                        zh
                          ? `恢复任务的工作区：${session.cwd}`
                          : `Resuming workspace: ${session.cwd}`,
                      );
                    const next = await manage({
                      type: "resume",
                      sessionId: session.id,
                    });
                    if (!next) return;
                    setSelection(undefined);
                    setModel("");
                    setPermission("safe");
                    setPanel(true);
                    setPanelTab("files");
                    setStatus("ready");
                    setSettings(false);
                    setDetails([]);
                    setPrompt("");
                    setAnswer("");
                    setApproval(undefined);
                  }}
                >
                  <ChatCircle size={16} />
                  <span>{session.title}</span>
                </button>
              ))}
          </div>
          <button
            data-testid="settings"
            type="button"
            onClick={() => setSettings(!settings)}
          >
            <GearSix size={17} />
            {t("common.settings")}
          </button>
        </aside>
        <section className="live-main">
          <WorkspaceHeader
            state={state}
            sidebarOpen={sidebarOpen}
            setSidebarOpen={setSidebarOpen}
            panel={panel}
            setPanel={setPanel}
            settings={settings}
            busy={busy}
            onChooseWorkspace={onChooseWorkspace}
          />
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
              state={state}
              busy={busy}
              onBack={() => setSettings(false)}
              manage={manage}
              onOpenLogin={() =>
                void api?.openLogin().catch(() => setError("management-failed"))
              }
            />
          ) : (
            <>
              <div className="live-transcript" aria-live="polite">
                {!state?.messages.length && !prompt && (
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
                {state?.messages.map((message) => (
                  <div
                    key={message.id}
                    className={
                      message.role === "user" ? "live-user" : "live-answer"
                    }
                  >
                    {message.role === "assistant" && (
                      <img
                        className="studio-answer-avatar"
                        src={markUrl}
                        alt="Forge"
                      />
                    )}
                    <Markdown>{message.content}</Markdown>
                  </div>
                ))}
                {prompt && (
                  <div className="live-user">
                    <Markdown>{prompt}</Markdown>
                  </div>
                )}
                {answer && (
                  <div className="live-answer">
                    <img
                      className="studio-answer-avatar"
                      src={markUrl}
                      alt="Forge"
                    />
                    <Markdown>{answer}</Markdown>
                  </div>
                )}
                {active && (
                  <div className="studio-run-state" role="status">
                    <span className="spinner" />
                    <span>{t(`live.${status}`)}</span>
                    {details.length > 0 && (
                      <details>
                        <summary>
                          {t("live.activity")} · {details.length}
                        </summary>
                        <pre>{details.at(-1)?.text}</pre>
                      </details>
                    )}
                  </div>
                )}
                {approval && (
                  <div className="approval-card">
                    <h3>{t("live.approval")}</h3>
                    <pre>{approval.description}</pre>
                    <button type="button" onClick={() => void decide(false)}>
                      {t("common.deny")}
                    </button>
                    <button type="button" onClick={() => void decide(true)}>
                      {t("common.approve")}
                    </button>
                  </div>
                )}
              </div>
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
                    if (event.nativeEvent.isComposing) return;
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
                    if (
                      event.key === "Enter" &&
                      (event.metaKey || event.ctrlKey) &&
                      !event.nativeEvent.isComposing
                    ) {
                      event.preventDefault();
                      void send();
                    }
                  }}
                  aria-label={t("home.placeholder")}
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
                  canSend={!busy && Boolean(draft.trim()) && Boolean(api)}
                />
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
              <h3>{t("live.context")}</h3>
              <pre>{state?.context}</pre>
              <button
                type="button"
                disabled={busy || !state?.sessionId}
                onClick={() => void manage({ type: "compact" })}
              >
                {t("live.compact")}
              </button>
              <h3>{t("live.activity")}</h3>
              {details.map((detail) => (
                <details key={detail.id} open={detail.kind === "error"}>
                  <summary>{detail.kind}</summary>
                  <pre>{detail.text}</pre>
                </details>
              ))}
              <p>{t("live.verification")}</p>
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
