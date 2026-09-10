import React from "react";
import { useTranslation } from "react-i18next";
import type {
  DesktopState,
  ManagementCommand,
} from "../../shared/application-protocol.js";
import type { ChangeReview, FilePreview } from "../../shared/file-protocol.js";
import type { RunEvent } from "../../shared/run-protocol.js";
import logoUrl from "./assets/forge-logo.svg";
import { ContentPreview, DiffViewer } from "./file-preview.js";
import { Markdown } from "./markdown.js";

export function LiveWorkbench(): React.JSX.Element {
  const { t, i18n } = useTranslation();
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
  const [panel, setPanel] = React.useState(true);
  const [filePath, setFilePath] = React.useState("");
  const [filePreview, setFilePreview] = React.useState<FilePreview>();
  const [review, setReview] = React.useState<ChangeReview>();
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
    <main className="app-shell live-shell">
      <div className="prototype-banner">
        <span>Forge Desktop</span>
        <span>· {t(`live.${status}`)}</span>
      </div>
      <div className="app-frame">
        <aside className="sidebar">
          <img src={logoUrl} alt="Forge" width={100} />
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
            }}
          >
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
            {t("live.folder")}
          </button>
          <small className="live-path">
            {state?.cwd || t("live.automatic")}
          </small>
          <div className="live-sessions">
            {state?.sessions.map((session) => (
              <button
                type="button"
                key={session.id}
                disabled={busy}
                onClick={() => {
                  void manage({ type: "resume", sessionId: session.id });
                  setSettings(false);
                  setDetails([]);
                  setPrompt("");
                  setAnswer("");
                }}
              >
                {session.title}
              </button>
            ))}
          </div>
          <button
            data-testid="settings"
            type="button"
            onClick={() => setSettings(!settings)}
          >
            {t("common.settings")}
          </button>
        </aside>
        <section className="live-main">
          <header className="live-toolbar">
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
            <button type="button" onClick={() => setPanel(!panel)}>
              {t("live.context")}
            </button>
          </header>
          {error && (
            <p role="alert" className="field-error">
              {t(`live.errors.${error}`, { defaultValue: t("live.error") })}
            </p>
          )}
          {settings ? (
            <div className="live-settings">
              <h2>{t("common.settings")}</h2>
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
              <p>
                Forge home: <code>{state?.forgeHome}</code>
              </p>
              <p>{t("live.nativeConfig")}</p>
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
                  <h1>{t("home.title")}</h1>
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
                <p>{t("live.switchNotice")}</p>
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
                    {t("live.send")}
                  </button>
                )}
              </div>
            </>
          )}
        </section>
        {panel && (
          <aside className="live-panel">
            <h3>{t("live.files")}</h3>
            <input
              aria-label={t("live.filePath")}
              placeholder={t("live.filePath")}
              value={filePath}
              onChange={(event) => setFilePath(event.target.value)}
            />
            <div className="file-actions">
              <button
                type="button"
                disabled={!filePath || !state?.cwd}
                onClick={() => {
                  void api
                    ?.previewFile({ path: filePath })
                    .then(setFilePreview)
                    .catch((cause) => setError(operationError(cause)));
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
            <h3>{t("live.changes")}</h3>
            <button
              type="button"
              disabled={!state?.cwd}
              onClick={() =>
                void api
                  ?.reviewChanges()
                  .then(setReview)
                  .catch((cause) => setError(operationError(cause)))
              }
            >
              {t("live.refreshChanges")}
            </button>
            {review && (
              <div className="change-review">
                <small>
                  {t("live.baseline")}: {t(`live.baselines.${review.baseline}`)}
                </small>
                {review.limitations.map((limit) => (
                  <small key={limit}>{t(`live.reviewLimits.${limit}`)}</small>
                ))}
                <small>
                  Forge:{" "}
                  {t(`live.engineCoverage.${review.engineCoverage.native}`)}
                </small>
                <small>
                  Codex:{" "}
                  {t(`live.engineCoverage.${review.engineCoverage.codex}`)}
                </small>
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
    ].find((code) => message.includes(code)) ?? "management-failed"
  );
}
