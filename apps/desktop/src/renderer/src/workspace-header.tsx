import { FolderOpen } from "@phosphor-icons/react/FolderOpen";
import { GearSix } from "@phosphor-icons/react/GearSix";
import { Plus } from "@phosphor-icons/react/Plus";
import { SidebarSimple } from "@phosphor-icons/react/SidebarSimple";
import { useTranslation } from "react-i18next";
import type { DesktopState } from "../../shared/application-protocol.js";
import markUrl from "./assets/forge-mark.svg";
export function WorkspaceHeader({
  state,
  sidebarOpen,
  setSidebarOpen,
  panel,
  setPanel,
  settings,
  busy,
  onChooseWorkspace,
  onNewTask,
  onSettings,
}: {
  state: DesktopState | undefined;
  sidebarOpen: boolean;
  setSidebarOpen: (value: boolean) => void;
  panel: boolean;
  setPanel: (value: boolean) => void;
  settings: boolean;
  busy: boolean;
  onChooseWorkspace: () => Promise<void>;
  onNewTask: () => void;
  onSettings: () => void;
}) {
  const { t } = useTranslation();
  const collapsedMac =
    window.forgeDesktop?.platform === "darwin" && !sidebarOpen;
  return (
    <header className="live-toolbar">
      {!sidebarOpen && (
        <button
          type="button"
          className="studio-icon studio-sidebar-toggle"
          data-testid="sidebar-toggle"
          title={`Forge · ${t("studio.sidebar")}`}
          aria-label={`Forge · ${t("studio.sidebar")}`}
          aria-expanded={sidebarOpen}
          onClick={() => setSidebarOpen(!sidebarOpen)}
        >
          {collapsedMac ? (
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
      )}
      <button type="button" disabled={busy} onClick={onChooseWorkspace}>
        <FolderOpen size={17} />
        {state?.cwd?.split("/").pop() || t("live.folder")}
      </button>
      {collapsedMac && (
        <button
          type="button"
          className="studio-icon studio-toolbar-new-task"
          title={t("live.new")}
          aria-label={t("live.new")}
          disabled={busy}
          onClick={onNewTask}
        >
          <Plus size={18} />
        </button>
      )}
      <span className="studio-task-title">
        {settings
          ? t("common.settings")
          : state?.sessions.find((session) => session.id === state.sessionId)
              ?.title}
      </span>
      <button
        type="button"
        className="studio-panel-toggle"
        aria-expanded={panel}
        onClick={() => setPanel(!panel)}
      >
        <SidebarSimple size={17} />
        {t("studio.workbench")}
      </button>
      {collapsedMac && (
        <button
          type="button"
          className="studio-icon studio-toolbar-settings"
          title={t("common.settings")}
          aria-label={t("common.settings")}
          aria-current={settings ? "page" : undefined}
          onClick={onSettings}
        >
          <GearSix size={18} />
        </button>
      )}
    </header>
  );
}
