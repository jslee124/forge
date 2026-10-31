import type { ProductRunCompletion } from "@forge/application";
import { useTranslation } from "react-i18next";
import { RunOutput } from "./run-output.js";

export function RunResult({
  result,
  historical = false,
  onRecover,
  onSource,
  onConfigure,
  recoveryDisabled = false,
  sourceDisabled,
}: {
  result: ProductRunCompletion;
  historical?: boolean;
  onRecover?: ((kind: "summarize" | "continue" | "retry") => void) | undefined;
  onSource?: (sourceRunId: string) => void;
  onConfigure?: (() => void) | undefined;
  recoveryDisabled?: boolean;
  sourceDisabled?: boolean;
}) {
  const { t } = useTranslation();
  const providerIssue = [
    "provider-authentication-failed",
    "provider-connection-failed",
    "provider-unavailable",
    "provider-rate-limited",
  ].includes(result.message ?? "")
    ? result.message
    : undefined;
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
          result.recovery?.kind === "summarize" &&
            result.outcome === "limit_reached"
            ? "recovery.summaryTitle"
            : result.reason === "no_progress"
              ? "runUi.noProgressTitle"
              : `runUi.outcomes.${result.outcome}`,
        )}
      </strong>
      {result.partial && <p>{t("runUi.partialResult")}</p>}
      {result.reason && result.recovery?.kind !== "summarize" && (
        <p>
          {providerIssue
            ? t(`runUi.providerFailures.${providerIssue}`)
            : t(`runUi.reasons.${result.reason}`)}
        </p>
      )}
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
      {result.recovery && onSource && (
        <button
          type="button"
          disabled={sourceDisabled ?? recoveryDisabled}
          onClick={() =>
            result.recovery && onSource(result.recovery.sourceRunId)
          }
        >
          {t("recovery.viewSource")}
        </button>
      )}
      {!historical &&
        result.reason === "configuration_error" &&
        onConfigure && (
          <button type="button" onClick={onConfigure}>
            {t("setup.configure")}
          </button>
        )}
      {onRecover && result.reason !== "configuration_error" && (
        <div className="run-recovery-actions">
          {(providerIssue
            ? (["retry"] as const)
            : (["summarize", "continue", "retry"] as const)
          ).map((kind) => (
            <button
              key={kind}
              type="button"
              data-recovery={kind}
              disabled={
                recoveryDisabled ||
                (result.recovery?.kind === "summarize" && kind !== "summarize")
              }
              title={t("recovery.reviewFirst")}
              onClick={() => onRecover(kind)}
            >
              {t(`recovery.actions.${kind}`)}
            </button>
          ))}
        </div>
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
