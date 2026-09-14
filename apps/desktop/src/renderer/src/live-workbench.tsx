import { ArrowUp } from "@phosphor-icons/react/ArrowUp";
import { ChatCircle } from "@phosphor-icons/react/ChatCircle";
import { Code } from "@phosphor-icons/react/Code";
import { FileText } from "@phosphor-icons/react/FileText";
import { FolderOpen } from "@phosphor-icons/react/FolderOpen";
import { GearSix } from "@phosphor-icons/react/GearSix";
import { Globe } from "@phosphor-icons/react/Globe";
import { Moon } from "@phosphor-icons/react/Moon";
import { Paperclip } from "@phosphor-icons/react/Paperclip";
import { Plus } from "@phosphor-icons/react/Plus";
import { SidebarSimple } from "@phosphor-icons/react/SidebarSimple";
import { Sun } from "@phosphor-icons/react/Sun";
import { X } from "@phosphor-icons/react/X";
import React from "react";
import { useTranslation } from "react-i18next";
import type {
  DesktopState,
  ManagementCommand,
} from "../../shared/application-protocol.js";
import type { ChangeReview, FilePreview } from "../../shared/file-protocol.js";
import type { RunEvent } from "../../shared/run-protocol.js";
import logoUrl from "./assets/forge-logo.svg";
import markUrl from "./assets/forge-mark.svg";
import { ContentPreview, DiffViewer } from "./file-preview.js";
import { Markdown } from "./markdown.js";
import { type ThemeMode, useTheme } from "./theme.js";

export function LiveWorkbench(): React.JSX.Element {
  const { t, i18n } = useTranslation();
  const theme = useTheme();
  const [panelTab, setPanelTab] = React.useState("files");
  const [sidebarOpen, setSidebarOpen] = React.useState(true);
  const [panelWidth, setPanelWidth] = React.useState(360);
  const composerRef = React.useRef<HTMLTextAreaElement>(null);
  const [state, setState] = React.useState<DesktopState>();
  const [drafts, setDrafts] = React.useState<Record<string, string>>({});
  const [engine, setEngine] = React.useState<"native" | "codex">("native");
  const [model, setModel] = React.useState("");
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
  // biome-ignore lint/correctness/useExhaustiveDependencies: Changing tasks must invalidate the previous task's artifact state.
  React.useEffect(() => {
    setFilePath("");
    setFilePreview(undefined);
    setReview(undefined);
  }, [scope]);
  const key = state?.sessionId || `new:${state?.cwd ?? ""}`;
  const draft = drafts[key] ?? "";
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
        if (!disposed) setState(next);
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
  const send = async () => {
    if (!draft.trim() || busy || !api) return;
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
        ...(model ? { model } : {}),
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
      <div className="prototype-banner">
        <span>
          FORGE <span className="titlebar-divider">/</span>{" "}
          {state?.cwd?.split("/").pop() || t("studio.workspace")}
        </span>
        <span className={`studio-status status-${status}`}>
          <span />
          {t(`live.${status}`)}
        </span>
      </div>
      <div className="app-frame">
        <aside className="sidebar">
          <div className="studio-brand">
            <img src={logoUrl} alt="Forge" width={124} />
          </div>
          <button
            type="button"
            disabled={busy}
            onClick={() => {
              setState((value) =>
                value ? { ...value, sessionId: "", messages: [] } : value,
              );
              setPrompt("");
              setAnswer("");
              setDetails([]);
              setSettings(false);
              setPanel(false);
              setStatus("ready");
            }}
          >
            <Plus size={17} />
            {t("live.new")}
          </button>
          <button
            type="button"
            disabled={busy || !state?.cwd || !api}
            onClick={async () => {
              try {
                const imported = await api?.importFile();
                if (imported) {
                  setFilePath(imported.path);
                  setFilePreview(
                    await api?.previewFile({ path: imported.path }),
                  );
                  setPanel(true);
                }
              } catch (cause) {
                setError(operationError(cause));
              }
            }}
          >
            <Paperclip size={17} />
            {t("live.addMaterial")}
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={async () => {
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
            }}
          >
            <FolderOpen size={17} />
            {t("live.folder")}
          </button>
          <small className="live-path" title={state?.cwd}>
            {state?.cwd?.split("/").pop() || t("live.automatic")}
          </small>
          <p className="studio-section-label">{t("common.recentTasks")}</p>
          <div className="live-sessions">
            {!state?.sessions.length && (
              <p className="studio-empty-list">{t("studio.noTasks")}</p>
            )}
            {state?.sessions.map((session) => (
              <button
                type="button"
                key={session.id}
                data-session-id={session.id}
                aria-current={
                  session.id === state?.sessionId && !settings
                    ? "page"
                    : undefined
                }
                title={session.title}
                disabled={busy}
                onClick={() => {
                  void manage({ type: "resume", sessionId: session.id });
                  setPanel(true);
                  setPanelTab("files");
                  setStatus("ready");
                  setSettings(false);
                  setDetails([]);
                  setPrompt("");
                  setAnswer("");
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
          <button
            type="button"
            className="studio-theme-toggle"
            onClick={() =>
              theme.setTheme(theme.resolved === "dark" ? "light" : "dark")
            }
            aria-label={t("studio.appearance")}
          >
            <span>
              {theme.resolved === "dark" ? (
                <Moon size={17} />
              ) : (
                <Sun size={17} />
              )}
              {t(`studio.${theme.resolved}`)}
            </span>
            <span>{t("studio.appearance")}</span>
          </button>
        </aside>
        <section className="live-main">
          <header className="live-toolbar">
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
            <label>
              {t("live.engine")}{" "}
              <select
                disabled={busy}
                value={engine}
                onChange={(event) => {
                  setEngine(event.target.value as "native" | "codex");
                  setModel("");
                }}
              >
                <option value="native">Forge</option>
                <option value="codex">Codex</option>
              </select>
            </label>
            <label>
              {t("live.model")}{" "}
              <input
                disabled={busy}
                value={model}
                onChange={(event) => setModel(event.target.value)}
                placeholder={
                  engine === "native"
                    ? `${state?.provider ?? ""} / ${state?.model ?? ""}`
                    : t("live.defaultModel")
                }
                list="model-list"
              />
            </label>
            <datalist id="model-list">
              {state?.codexModels.map((entry) => (
                <option key={entry} value={entry} />
              ))}
            </datalist>
            <button
              type="button"
              className="studio-panel-toggle"
              aria-expanded={panel}
              onClick={() => setPanel(!panel)}
            >
              <SidebarSimple size={17} />
              {t("studio.workbench")}
            </button>
          </header>
          {error && (
            <p role="alert" className="field-error">
              {t(`live.errors.${error}`, { defaultValue: t("live.error") })}
            </p>
          )}
          {settings ? (
            <div className="live-settings">
              <span className="studio-eyebrow">{t("studio.preferences")}</span>
              <h2>{t("common.settings")}</h2>
              <section className="studio-appearance">
                <h3>{t("studio.appearance")}</h3>
                <p>{t("studio.appearanceHint")}</p>
                <div className="theme-options">
                  {(["light", "dark", "system"] as ThemeMode[]).map((mode) => (
                    <button
                      type="button"
                      key={mode}
                      aria-pressed={theme.mode === mode}
                      onClick={() => theme.setTheme(mode)}
                    >
                      <span className={`theme-swatch theme-swatch-${mode}`} />
                      {t(`studio.${mode}`)}
                    </button>
                  ))}
                </div>
              </section>
              <label>
                {t("settings.language")}{" "}
                <select
                  data-testid="language"
                  value={i18n.language}
                  onChange={(event) => {
                    void i18n.changeLanguage(event.target.value);
                    document.documentElement.lang = event.target.value;
                  }}
                >
                  <option value="zh-CN">简体中文</option>
                  <option value="en">English</option>
                </select>
              </label>
              <h3>{t("studio.connection")}</h3>
              <p>
                Forge home: <code>{state?.forgeHome}</code>
              </p>
              <p>{t("live.nativeConfig")}</p>
              <section
                className="web-settings"
                aria-label={t("live.web.title")}
              >
                <h3>{t("live.web.title")}</h3>
                <p>
                  {t("live.web.bundle")}: {state?.web?.provenance}
                </p>
                {state?.web?.configurationInvalid && (
                  <p role="alert">{t("live.errors.web-settings-invalid")}</p>
                )}
                <p>{t("live.web.scope")}</p>
                <button
                  type="button"
                  disabled={busy || state?.web?.installed}
                  onClick={() => void manage({ type: "web-install" })}
                >
                  {t(
                    state?.web?.installed
                      ? "live.web.installed"
                      : "live.web.install",
                  )}
                </button>
                <label>
                  <input
                    type="checkbox"
                    checked={state?.web?.enabled ?? false}
                    disabled={busy || !state?.web?.installed}
                    onChange={(event) =>
                      void manage({
                        type: "web-enable",
                        enabled: event.target.checked,
                      })
                    }
                  />
                  {t("live.web.enable")}
                </label>
                <label>
                  {t("live.web.provider")}
                  <select
                    value={state?.web?.provider ?? "auto"}
                    disabled={busy || !state?.web?.installed}
                    onChange={(event) =>
                      void manage({
                        type: "web-configure",
                        provider: event.target.value as
                          | "auto"
                          | "brave"
                          | "duckduckgo",
                      })
                    }
                  >
                    <option value="auto">Auto</option>
                    <option value="brave">Brave Search</option>
                    <option value="duckduckgo">DuckDuckGo HTML</option>
                  </select>
                </label>
                <p>
                  {t("live.web.actual")}:{" "}
                  {state?.web?.actualProvider === "brave"
                    ? "Brave Search"
                    : "DuckDuckGo HTML"}
                </p>
                <p>
                  {t(
                    state?.web?.braveKeyConfigured
                      ? "live.web.keyReady"
                      : "live.web.keyMissing",
                  )}
                </p>
                <p>{t("live.web.auto")}</p>
                <p>{t("live.web.report")}</p>
              </section>
              <h3>Codex</h3>
              <p>{t(`live.auth.${state?.auth ?? "unknown"}`)}</p>
              <button
                type="button"
                disabled={busy}
                onClick={() => void manage({ type: "auth-status" })}
              >
                {t("live.authCheck")}
              </button>
              <button
                type="button"
                disabled={busy || state?.auth === "signing-in"}
                onClick={() => void manage({ type: "login" })}
              >
                {t("live.login")}
              </button>
              {state?.auth === "signing-in" && (
                <button
                  type="button"
                  onClick={() => void manage({ type: "cancel-login" })}
                >
                  {t("live.cancelLogin")}
                </button>
              )}
              {state?.loginUrl && (
                <div>
                  <button
                    type="button"
                    onClick={() =>
                      void api
                        ?.openLogin()
                        .catch(() => setError("management-failed"))
                    }
                  >
                    {t("live.openLogin")}
                  </button>
                  <code>{state.loginCode}</code>
                </div>
              )}
              <p>{t("live.codexLimits")}</p>
            </div>
          ) : (
            <>
              <div className="live-transcript" aria-live="polite">
                {!state?.messages.length && !prompt && (
                  <div className="studio-welcome">
                    <span className="studio-welcome-icon">
                      <img src={markUrl} alt="" width={72} height={72} />
                    </span>
                    <span className="studio-eyebrow">
                      {t("studio.eyebrow")}
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
                <textarea
                  ref={composerRef}
                  rows={3}
                  onKeyDown={(event) => {
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
                  onChange={(event) =>
                    setDrafts((values) => ({
                      ...values,
                      [key]: event.target.value,
                    }))
                  }
                />
                <div className="studio-composer-footer">
                  <span className="studio-composer-context" title={state?.cwd}>
                    <FolderOpen size={15} />
                    {state?.cwd?.split("/").pop() || t("live.automatic")}
                  </span>
                  <span className="studio-shortcut">⌘ / Ctrl ↵</span>
                  {active ? (
                    <button
                      type="button"
                      disabled={status === "stopping"}
                      onClick={() => void cancel()}
                    >
                      {t(status === "stopping" ? "live.stopping" : "live.stop")}
                    </button>
                  ) : (
                    <button
                      type="button"
                      disabled={busy || !draft.trim() || !api}
                      onClick={() => void send()}
                    >
                      <ArrowUp size={16} />
                      {t("live.send")}
                    </button>
                  )}
                </div>
                <details className="studio-engine-note">
                  <summary>{t("studio.engineNote")}</summary>
                  <p>{t("live.switchNotice")}</p>
                </details>
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
