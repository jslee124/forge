import { useTranslation } from "react-i18next";
import type { RecoverySource } from "../../shared/application-protocol.js";
import { RunActivity } from "./run-activity.js";
import { RunDelivery } from "./run-delivery.js";
import { RunOutput } from "./run-output.js";

/** Source-record projection only: generated summary text never selects a status. */
export function RecoveryFacts({
  source,
  onPreview,
}: {
  source: RecoverySource;
  onPreview: (path: string) => void;
}) {
  const { t } = useTranslation();
  const record = source.record;
  const completion = record?.summary.completion;
  return (
    <section
      className="recovery-facts"
      aria-label={t("recovery.factsTitle")}
      data-recovery-source={source.sourceRunId}
    >
      <h3>{t("recovery.factsTitle")}</h3>
      <p>{t("recovery.factsScope")}</p>
      <dl className="recovery-plan-metadata">
        <dt>{t("recovery.source")}</dt>
        <dd>{source.sourceRunId}</dd>
        <dt>{t("recovery.recordedStatus")}</dt>
        <dd>
          {completion
            ? t(`runUi.outcomes.${completion.outcome}`)
            : t("recovery.unknownStatus")}
        </dd>
        {completion?.reason && (
          <>
            <dt>{t("recovery.sourceReason")}</dt>
            <dd>{t(`runUi.reasons.${completion.reason}`)}</dd>
          </>
        )}
      </dl>
      {!record ? (
        <p role="status">{t("recovery.sourceUnavailable")}</p>
      ) : (
        <>
          {completion?.partial && <p>{t("runUi.partialResult")}</p>}
          {(record.incomplete ||
            record.delivery?.incomplete ||
            record.summary.omittedCharacters > 0 ||
            record.summary.omittedEvents > 0) && (
            <p>{t("recovery.incomplete")}</p>
          )}
          <p>{t("recovery.verificationScope")}</p>
          {!record.delivery?.commands.length && (
            <p>{t("delivery.noCommands")}</p>
          )}
          {record.delivery?.commands.slice(0, 5).map(({ actionId, facts }) => (
            <div key={actionId} className="recovery-fact-command">
              <strong>
                {t(
                  `delivery.commandOutcomes.${facts.timedOut ? "timeout" : facts.signal || facts.exitCode === null ? "unknown" : facts.exitCode === 0 ? "zero" : "nonzero"}`,
                  { code: facts.exitCode },
                )}
              </strong>
              <RunOutput label={t("delivery.commands")}>
                {facts.command}
              </RunOutput>
              <small>{t("delivery.cwd", { path: facts.cwd })}</small>
            </div>
          ))}
          {record.delivery && (
            <RunDelivery
              key={record.summary.runId}
              delivery={record.delivery}
              busy={false}
              onPreview={onPreview}
            />
          )}
          <details>
            <summary>{t("recovery.sourceActivity")}</summary>
            <RunActivity state={record.activity} />
          </details>
        </>
      )}
    </section>
  );
}
