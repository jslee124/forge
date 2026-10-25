import type { ProductRunCompletion } from "@forge/application";
import { useTranslation } from "react-i18next";
import { RunOutput } from "./run-output.js";

export function RunResult({
  result,
  historical = false,
}: {
  result: ProductRunCompletion;
  historical?: boolean;
}) {
  const { t } = useTranslation();
  const failed =
    result.outcome !== "completed" && result.outcome !== "cancelled";
  return (
    <section
      className="studio-run-result"
      data-run-result={historical ? "historical" : "current"}
      role={failed ? "alert" : "status"}
    >
      <strong>
        {t(
          result.reason === "no_progress"
            ? "runUi.noProgressTitle"
            : `runUi.outcomes.${result.outcome}`,
        )}
      </strong>
      {result.partial && <p>{t("runUi.partialResult")}</p>}
      {result.reason && <p>{t(`runUi.reasons.${result.reason}`)}</p>}
      <div className="run-result-metrics">
        {result.durationMs !== undefined && (
          <span>
            {t("runUi.elapsed", {
              seconds: Math.round(result.durationMs / 1000),
            })}
          </span>
        )}
        {result.modelSteps !== undefined && (
          <span>{t("runUi.steps", { count: result.modelSteps })}</span>
        )}
        {result.toolCalls !== undefined && (
          <span>{t("runUi.operationCount", { count: result.toolCalls })}</span>
        )}
      </div>
      {!historical && (
        <p>
          {t(
            result.outcome === "completed"
              ? "live.verification"
              : "runUi.draftRetained",
          )}
        </p>
      )}
      {result.message && (
        <details>
          <summary>{t("runUi.diagnostics")}</summary>
          <RunOutput label={t("runUi.diagnostics")}>{result.message}</RunOutput>
        </details>
      )}
    </section>
  );
}
