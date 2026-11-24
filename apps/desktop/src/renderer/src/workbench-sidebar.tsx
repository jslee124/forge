import { ChatCircle } from "@phosphor-icons/react/ChatCircle";
import { GearSix } from "@phosphor-icons/react/GearSix";
import { Plus } from "@phosphor-icons/react/Plus";
import { SidebarSimple } from "@phosphor-icons/react/SidebarSimple";
import React from "react";
import { useTranslation } from "react-i18next";
import type { DesktopState } from "../../shared/application-protocol.js";
import logoUrl from "./assets/forge-logo.svg";
import markUrl from "./assets/forge-mark.svg";
import type { SessionRun } from "./session-runs.js";
import { UpdateView } from "./update-view.js";

export interface WorkbenchSidebarProps {
  readonly zh: boolean;
  readonly sidebarOpen: boolean;
  readonly setSidebarOpen: React.Dispatch<React.SetStateAction<boolean>>;
  readonly sidebarWidth: number;
  readonly setSidebarWidth: React.Dispatch<React.SetStateAction<number>>;
  readonly sidebarMax: number;
  readonly displayedSidebarWidth: number;
  readonly panel: boolean;
  readonly panelWidth: number;
  readonly pending: boolean;
  readonly busy: boolean;
  readonly viewLoading: boolean;
  readonly error: string;
  readonly settings: boolean;
  readonly currentSessionId: string | undefined;
  readonly viewedSessionId: string | undefined;
  readonly sessionQuery: string;
  readonly setSessionQuery: React.Dispatch<React.SetStateAction<string>>;
  readonly navigationSessions: DesktopState["sessions"];
  readonly getSessionRun: (sessionId: string) => SessionRun | undefined;
  readonly sessionToDelete: { id: string; title: string } | undefined;
  readonly setSessionToDelete: React.Dispatch<
    React.SetStateAction<{ id: string; title: string } | undefined>
  >;
  readonly onNewTask: () => Promise<boolean>;
  readonly onReturnToExecution: () => void;
  readonly onResumeSession: (sessionId: string) => Promise<void>;
  readonly onRemoveSession: () => Promise<void>;
  readonly onToggleSettings: () => void;
}

export function WorkbenchSidebar({
  zh,
  sidebarOpen,
  setSidebarOpen,
  sidebarWidth,
  setSidebarWidth,
  sidebarMax,
  displayedSidebarWidth,
  panel,
  panelWidth,
  pending,
  busy,
  viewLoading,
  error,
  settings,
  currentSessionId,
  viewedSessionId,
  sessionQuery,
  setSessionQuery,
  navigationSessions,
  getSessionRun,
  sessionToDelete,
  setSessionToDelete,
  onNewTask,
  onReturnToExecution,
  onResumeSession,
  onRemoveSession,
  onToggleSettings,
}: WorkbenchSidebarProps): React.JSX.Element {
  const { t } = useTranslation();
  const sidebarDrag = React.useRef<{ x: number; width: number } | undefined>(
    undefined,
  );
  const deleteDialog = React.useRef<HTMLDialogElement>(null);

  React.useEffect(() => {
    const stop = () => {
      sidebarDrag.current = undefined;
    };
    window.addEventListener("blur", stop);
    return () => window.removeEventListener("blur", stop);
  }, []);

  React.useEffect(() => {
    if (sessionToDelete) {
      deleteDialog.current?.showModal();
      deleteDialog.current?.querySelector<HTMLButtonElement>("button")?.focus();
    } else if (deleteDialog.current?.open) deleteDialog.current.close();
  }, [sessionToDelete]);

  return (
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
        disabled={pending}
        onClick={() => void onNewTask()}
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
            <div className="session-row" key={session.id}>
              <button
                type="button"
                data-session-id={session.id}
                aria-current={
                  session.id === (viewedSessionId ?? currentSessionId) &&
                  !settings
                    ? "page"
                    : undefined
                }
                title={`${session.title} · ${session.cwd ?? ""}`}
                disabled={
                  pending || (viewLoading && session.id !== currentSessionId)
                }
                onClick={() => {
                  if (session.id === currentSessionId && viewedSessionId)
                    onReturnToExecution();
                  else void onResumeSession(session.id);
                }}
              >
                <ChatCircle size={16} />
                <span>
                  {session.title === "Empty session"
                    ? t("setup.emptyTask")
                    : session.title}
                </span>
                {getSessionRun(session.id) && (
                  <small
                    className="session-running"
                    data-session-status={getSessionRun(session.id)?.status}
                  >
                    {t(`parallel.${getSessionRun(session.id)?.status}`, {
                      defaultValue: getSessionRun(session.id)?.status,
                    })}
                  </small>
                )}
              </button>
              <details className="session-menu">
                <summary
                  aria-label={
                    zh
                      ? `聊天操作：${session.title}`
                      : `Chat actions: ${session.title}`
                  }
                >
                  ⋯
                </summary>
                <button
                  type="button"
                  disabled={pending || busy}
                  onClick={(event) => {
                    event.currentTarget
                      .closest("details")
                      ?.removeAttribute("open");
                    setSessionToDelete({
                      id: session.id,
                      title: session.title,
                    });
                  }}
                >
                  {zh ? "删除聊天" : "Delete chat"}
                </button>
              </details>
            </div>
          ))}
      </div>
      <dialog
        ref={deleteDialog}
        className="session-delete-dialog"
        aria-labelledby="delete-chat-title"
        aria-describedby="delete-chat-description"
        onCancel={(event) => {
          if (pending) event.preventDefault();
          else setSessionToDelete(undefined);
        }}
      >
        <h2 id="delete-chat-title">{zh ? "删除聊天？" : "Delete chat?"}</h2>
        <p>{sessionToDelete?.title}</p>
        <p id="delete-chat-description">
          {zh
            ? "将永久删除本地聊天、运行记录和 trace，无法恢复。不会删除项目文件、撤销代码修改或清理外部引擎历史。"
            : "Permanently deletes local conversation, run records and traces. This cannot be undone. Project files, code changes and external engine history are kept."}
        </p>
        {error && (
          <p role="alert">
            {t(`live.errors.${error}`, { defaultValue: t("live.error") })}
          </p>
        )}
        <button
          type="button"
          disabled={pending}
          onClick={() => setSessionToDelete(undefined)}
        >
          {zh ? "取消" : "Cancel"}
        </button>
        <button
          type="button"
          disabled={pending || busy}
          onClick={() => void onRemoveSession()}
        >
          {pending ? (zh ? "删除中…" : "Deleting…") : zh ? "删除" : "Delete"}
        </button>
      </dialog>
      <div className="sidebar-bottom">
        <button
          title={t("common.settings")}
          aria-label={t("common.settings")}
          data-testid="settings"
          type="button"
          onClick={onToggleSettings}
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
  );
}
