import { useTranslation } from "react-i18next";
import type {
  DesktopState,
  ManagementCommand,
} from "../../shared/application-protocol.js";
import { RunActivity } from "./run-activity.js";
import { RunDelivery } from "./run-delivery.js";
import { RunResult } from "./run-result.js";

export function RunHistory({
  history,
  busy,
  onLoad,
  onRecover,
  onPreview,
}: {
  history: DesktopState["runHistory"];
  onPreview: (path: string) => void;
  onRecover?: (
    kind: "summarize" | "continue" | "retry",
    sourceRunId: string,
  ) => void;
  busy: boolean;
  onLoad: (
    command: Extract<ManagementCommand, { type: "run-history" }>,
  ) => Promise<void>;
}) {
  const { t } = useTranslation();
  const selected = history?.selected;
  return (
    <section className="run-history" aria-label={t("runUi.history")}>
      <h3>{t("runUi.history")}</h3>
      <button
        type="button"
        disabled={busy}
        onClick={() => void onLoad({ type: "run-history" })}
      >
        {t("runUi.refreshHistory")}
      </button>
      {history?.error && <p role="alert">{t("runUi.historyError")}</p>}
      {!history?.runs.length && <p>{t("runUi.noHistory")}</p>}
      <ul>
        {history?.runs.map((run) => (
          <li key={run.runId}>
            <button
              type="button"
              disabled={busy}
              aria-pressed={selected?.summary.runId === run.runId}
              onClick={() =>
                void onLoad({ type: "run-history", runId: run.runId })
              }
            >
              <span>{run.prompt}</span>
              <small>
                {new Date(run.startedAt).toLocaleString()} ·{" "}
                {run.engine === "native" ? "Forge" : "Codex"} ·{" "}
                {run.completion
                  ? t(`runUi.outcomes.${run.completion.outcome}`)
                  : t("live.running")}
              </small>
            </button>
          </li>
        ))}
      </ul>
      {history?.nextCursor !== undefined && (
        <button
          type="button"
          disabled={busy}
          onClick={() =>
            void onLoad({ type: "run-history", before: history.nextCursor })
          }
        >
          {t("runUi.older")}
        </button>
      )}
      {selected && (
        <div className="run-history-selected">
          <h4>{selected.summary.prompt}</h4>
          <p>{t("runUi.historyReadOnly")}</p>
          {selected.summary.completion && (
            <RunResult
              historical
              result={{
                ...selected.summary.completion,
                ...(selected.summary.recovery
                  ? { recovery: selected.summary.recovery }
                  : {}),
              }}
              recoveryDisabled={busy || selected.summary.engine !== "native"}
              onRecover={
                onRecover
                  ? (kind) => onRecover(kind, selected.summary.runId)
                  : undefined
              }
              onSource={(sourceRunId) =>
                void onLoad({ type: "run-history", runId: sourceRunId })
              }
            />
          )}
          {(selected.incomplete || selected.summary.omittedCharacters > 0) && (
            <p role="status">{t("runUi.historyIncomplete")}</p>
          )}
          {selected.delivery && (
            <RunDelivery
              key={selected.summary.runId}
              delivery={selected.delivery}
              busy={busy}
              onPreview={onPreview}
            />
          )}
          <RunActivity state={selected.activity} />
        </div>
      )}
    </section>
  );
}
