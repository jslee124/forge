import { Code } from "@phosphor-icons/react/Code";
import { FileText } from "@phosphor-icons/react/FileText";
import { X } from "@phosphor-icons/react/X";
import type React from "react";
import { useTranslation } from "react-i18next";
import type {
  BrowsedSession,
  DesktopState,
  ManagementCommand,
  RecoveryPlan,
} from "../../shared/application-protocol.js";
import type { DesktopApi } from "../../shared/desktop-api.js";
import type { ChangeReview, FilePreview } from "../../shared/file-protocol.js";
import { ContentPreview, DiffViewer } from "./file-preview.js";
import { RunActivity } from "./run-activity.js";
import { RunHistory } from "./run-history.js";
import type { ActivityState } from "./run-state.js";
import { operationError } from "./workbench-errors.js";

export interface WorkbenchPanelProps {
  readonly api: DesktopApi | undefined;
  readonly state: DesktopState | undefined;
  readonly viewed: BrowsedSession | undefined;
  readonly viewLoading: boolean;
  readonly active: boolean;
  readonly busy: boolean;
  readonly pending: boolean;
  readonly scope: string;
  readonly scopeRef: React.RefObject<string>;
  readonly historyKey: string;
  readonly panelWidth: number;
  readonly setPanelWidth: React.Dispatch<React.SetStateAction<number>>;
  readonly panelTab: string;
  readonly setPanelTab: React.Dispatch<React.SetStateAction<string>>;
  readonly setPanel: React.Dispatch<React.SetStateAction<boolean>>;
  readonly filePath: string;
  readonly setFilePath: React.Dispatch<React.SetStateAction<string>>;
  readonly filePreview: FilePreview | undefined;
  readonly setFilePreview: React.Dispatch<
    React.SetStateAction<FilePreview | undefined>
  >;
  readonly review: ChangeReview | undefined;
  readonly setReview: React.Dispatch<
    React.SetStateAction<ChangeReview | undefined>
  >;
  readonly activity: ActivityState;
  readonly onError: (code: string) => void;
  readonly onPreviewFile: (path: string) => Promise<void>;
  readonly onPrepareRecovery: (
    kind: RecoveryPlan["kind"],
    sourceRunId: string,
  ) => Promise<void>;
  readonly onLoadHistory: (
    command: Extract<ManagementCommand, { type: "run-history" }>,
  ) => Promise<void>;
  readonly onCompact: () => Promise<void>;
}

export function WorkbenchPanel({
  api,
  state,
  viewed,
  viewLoading,
  active,
  busy,
  pending,
  scope,
  scopeRef,
  historyKey,
  panelWidth,
  setPanelWidth,
  panelTab,
  setPanelTab,
  setPanel,
  filePath,
  setFilePath,
  filePreview,
  setFilePreview,
  review,
  setReview,
  activity,
  onError,
  onPreviewFile,
  onPrepareRecovery,
  onLoadHistory,
  onCompact,
}: WorkbenchPanelProps): React.JSX.Element {
  const { t } = useTranslation();

  return (
    <aside
      className="live-panel"
      style={{ "--panel-width": `${panelWidth}px` } as React.CSSProperties}
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
              Math.max(280, Math.min(600, window.innerWidth - event.clientX)),
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
                Math.min(600, value + (event.key === "ArrowLeft" ? 20 : -20)),
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
                    onError(operationError(cause));
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
                .catch((cause) => onError(operationError(cause)))
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
                .catch((cause) => onError(operationError(cause)))
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
                .catch((cause) => onError(operationError(cause)))
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
                if (scopeRef.current === scope) onError(operationError(cause));
              })
          }
        >
          {t("live.refreshChanges")}
        </button>
        {review && (
          <div className="change-review">
            <small>
              {t("live.baseline")}: {t(`live.baselines.${review.baseline}`)}
            </small>
            <details className="studio-review-scope">
              <summary>{t("studio.reviewScope")}</summary>
              {review.limitations.map((limit) => (
                <small key={limit}>{t(`live.reviewLimits.${limit}`)}</small>
              ))}
              <small>
                Forge:{" "}
                {t(`live.engineCoverage.${review.engineCoverage.native}`)}
              </small>
              <small>
                Codex: {t(`live.engineCoverage.${review.engineCoverage.codex}`)}
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
          key={historyKey}
          history={viewed?.runHistory ?? state?.runHistory}
          onPreview={(path) => void onPreviewFile(path)}
          busy={pending || viewLoading}
          executionBusy={active || Boolean(viewed)}
          onRecover={(kind, sourceRunId) =>
            void onPrepareRecovery(kind, sourceRunId)
          }
          onLoad={onLoadHistory}
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
            onClick={() => void onCompact()}
          >
            {t("live.compact")}
          </button>
        </details>
        {!viewed && <p>{t("live.verification")}</p>}
      </div>
    </aside>
  );
}
