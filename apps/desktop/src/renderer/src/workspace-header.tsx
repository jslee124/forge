import { FolderOpen } from "@phosphor-icons/react/FolderOpen";
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
}: {
  state: DesktopState | undefined;
  sidebarOpen: boolean;
  setSidebarOpen: (value: boolean) => void;
  panel: boolean;
  setPanel: (value: boolean) => void;
  settings: boolean;
  busy: boolean;
  onChooseWorkspace: () => Promise<void>;
}) {
  const { t } = useTranslation();
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
      )}
      <button type="button" disabled={busy} onClick={onChooseWorkspace}>
        <FolderOpen size={17} />
        {state?.cwd?.split("/").pop() || t("live.folder")}
      </button>
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
    </header>
  );
}
