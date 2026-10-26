import type { ProductRunDelivery } from "@forge/persistence";
import { useTranslation } from "react-i18next";
import { RunOutput } from "./run-output.js";

/** Recorded execution observations, never an inferred task-success verdict. */
export function SystemFallback({
  delivery,
  original,
}: {
  delivery?: ProductRunDelivery | undefined;
  original: string;
}) {
  const { t } = useTranslation();
  const attention =
    delivery?.commands.filter(
      ({ facts }) =>
        facts.exitCode !== 0 || facts.timedOut || facts.signal !== null,
    ).length ?? 0;
  return (
    <section className="system-fallback" aria-label={t("fallback.title")}>
      <h3>{t("fallback.title")}</h3>
      <p>{t("fallback.explanation")}</p>
      {!delivery ? (
        <p>{t("fallback.unavailable")}</p>
      ) : (
        <>
          {delivery.incomplete && (
            <p role="status">{t("delivery.incomplete")}</p>
          )}
          <h4>{t("delivery.files")}</h4>
          {delivery.files.length ? (
            <ul>
              {delivery.files.slice(0, 5).map(({ actionId, facts }) => (
                <li key={actionId}>
                  <code>{facts.path}</code> ·{" "}
                  {t(`delivery.operations.${facts.operation}`)}
                </li>
              ))}
            </ul>
          ) : (
            <p>{t("delivery.noFiles")}</p>
          )}
          <h4>{t("delivery.commands")}</h4>
          <p>{t("delivery.verificationScope")}</p>
          {!delivery.commands.length && <p>{t("delivery.noCommands")}</p>}
          <ul>
            {delivery.commands.slice(0, 5).map(({ actionId, facts }) => {
              const outcome = facts.timedOut
                ? "timeout"
                : facts.signal || facts.exitCode === null
                  ? "unknown"
                  : facts.exitCode === 0
                    ? "zero"
                    : "nonzero";
              return (
                <li key={actionId}>
                  <strong>
                    {t(`delivery.commandOutcomes.${outcome}`, {
                      code: facts.exitCode,
                    })}
                  </strong>
                  <RunOutput label={t("delivery.commands")}>
                    {facts.command}
                  </RunOutput>
                  <small>{t("delivery.cwd", { path: facts.cwd })}</small>
                  {(facts.stdout !== undefined ||
                    facts.stderr !== undefined) && (
                    <details>
                      <summary>{t("runUi.output")}</summary>
                      {facts.stdout !== undefined && (
                        <RunOutput label="stdout">
                          {facts.stdout || t("delivery.emptyOutput")}
                        </RunOutput>
                      )}
                      {facts.stderr !== undefined && (
                        <RunOutput label="stderr">
                          {facts.stderr || t("delivery.emptyOutput")}
                        </RunOutput>
                      )}
                    </details>
                  )}
                  {facts.truncated && <p>{t("runUi.truncated")}</p>}
                </li>
              );
            })}
          </ul>
          <h4>{t("delivery.unresolved")}</h4>
          {attention > 0 && (
            <p>{t("delivery.commandAttention", { count: attention })}</p>
          )}
          {!delivery.unresolved.length && attention === 0 && (
            <p>{t("delivery.noUnresolved")}</p>
          )}
          <ul>
            {delivery.unresolved
              .slice(0, 5)
              .map(({ actionId, tool, status }) => (
                <li key={actionId}>
                  {t(`runUi.tools.${tool}`, { defaultValue: tool })} ·{" "}
                  {t(`delivery.states.${status}`)}
                </li>
              ))}
          </ul>
          {(delivery.omitted > 0 ||
            delivery.unstructured > 0 ||
            delivery.files.length > 5 ||
            delivery.commands.length > 5 ||
            delivery.unresolved.length > 5) && <p>{t("fallback.more")}</p>}
        </>
      )}
      <p className="system-fallback-limit">{t("fallback.limit")}</p>
      <details>
        <summary>{t("fallback.raw")}</summary>
        <RunOutput label={t("fallback.raw")}>{original}</RunOutput>
      </details>
    </section>
  );
}
