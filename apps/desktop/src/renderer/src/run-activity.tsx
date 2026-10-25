import { CheckCircle } from "@phosphor-icons/react/CheckCircle";
import { Clock } from "@phosphor-icons/react/Clock";
import { WarningCircle } from "@phosphor-icons/react/WarningCircle";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { RunOutput } from "./run-output.js";
import type { ActivityState } from "./run-state.js";

export function RunActivity({ state }: { state: ActivityState }) {
  const { t } = useTranslation();
  const [page, setPage] = useState(0);
  const items = state.items.filter((item) => item.kind !== "context");
  const diagnostics = state.items.filter((item) => item.kind === "context");
  const pageCount = Math.max(1, Math.ceil(items.length / 50));
  const current = Math.min(page, pageCount - 1);
  const end = items.length - current * 50;
  const actions = state.items.filter((item) => item.kind === "action");
  if (!state.items.length) return null;
  return (
    <div className="run-activity">
      <p className="run-activity-summary">
        {actions.length
          ? t("runUi.operationCount", { count: actions.length })
          : t("runUi.activitySummary")}
        {state.omitted > 0 && (
          <span>{t("runUi.omitted", { count: state.omitted })}</span>
        )}
      </p>
      <ol>
        {items.slice(Math.max(0, end - 50), end).map((item) => {
          const status = item.action?.status ?? item.decision;
          const failed =
            status === "failed" || status === "denied" || item.kind === "error";
          const done = status === "succeeded" || status === "allowed";
          const Icon = failed ? WarningCircle : done ? CheckCircle : Clock;
          const title = item.action
            ? t(`runUi.tools.${item.action.tool}`, {
                defaultValue: item.action.tool,
              })
            : t(`runUi.kinds.${item.kind}`);
          return (
            <li key={item.id}>
              <details data-view-disclosure={`activity-${item.id}`}>
                <summary>
                  <Icon size={16} aria-hidden="true" />
                  <span>{title}</span>
                  {status && <small>{t(`runUi.states.${status}`)}</small>}
                </summary>
                {item.action ? (
                  <>
                    <RunOutput label={t("runUi.input")}>
                      {item.action.input}
                    </RunOutput>
                    {item.action.output && (
                      <RunOutput label={t("runUi.output")}>
                        {item.action.output}
                      </RunOutput>
                    )}
                  </>
                ) : (
                  <RunOutput label={title}>{item.text}</RunOutput>
                )}
                {item.truncated && <p>{t("runUi.truncated")}</p>}
              </details>
            </li>
          );
        })}
      </ol>
      {diagnostics.length > 0 && (
        <details className="run-diagnostics" data-view-disclosure="diagnostics">
          <summary>{t("runUi.diagnostics")}</summary>
          {diagnostics.length > 20 && (
            <p>{t("runUi.omitted", { count: diagnostics.length - 20 })}</p>
          )}
          {diagnostics.slice(-20).map((item) => (
            <RunOutput key={item.id} label={t("runUi.kinds.context")}>
              {item.text}
            </RunOutput>
          ))}
        </details>
      )}
      {pageCount > 1 && (
        <nav aria-label={t("live.activity")}>
          <button
            type="button"
            disabled={current >= pageCount - 1}
            onClick={() => setPage(current + 1)}
          >
            {t("runUi.older")}
          </button>
          <span>
            {current + 1} / {pageCount}
          </span>
          <button
            type="button"
            disabled={current === 0}
            onClick={() => setPage(current - 1)}
          >
            {t("runUi.newer")}
          </button>
        </nav>
      )}
    </div>
  );
}
