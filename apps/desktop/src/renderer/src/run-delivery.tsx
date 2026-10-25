import type { ProductRunDelivery } from "@forge/persistence";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { DiffViewer } from "./file-preview.js";
import { RunOutput } from "./run-output.js";

export function RunDelivery({
  delivery,
  busy,
  onPreview,
}: {
  delivery: ProductRunDelivery;
  busy: boolean;
  onPreview: (path: string) => void;
}) {
  const { t } = useTranslation();
  const attention = delivery.commands.filter(
    ({ facts }) =>
      facts.exitCode !== 0 || facts.timedOut || facts.signal !== null,
  ).length;
  const [fileCount, setFileCount] = useState(10);
  const [commandCount, setCommandCount] = useState(10);
  const [issueCount, setIssueCount] = useState(10);
  return (
    <details className="run-delivery">
      <summary>
        {t("delivery.title")}{" "}
        <small>
          {t("delivery.counts", {
            files: delivery.files.length,
            commands: delivery.commands.length,
          })}
        </small>
        {attention > 0 && (
          <span className="run-delivery-attention">
            {t("delivery.commandAttention", { count: attention })}
          </span>
        )}
      </summary>
      <p className="run-delivery-scope">{t("delivery.scope")}</p>
      {delivery.incomplete && <p role="status">{t("delivery.incomplete")}</p>}
      {delivery.unstructured > 0 && (
        <p>{t("delivery.unstructured", { count: delivery.unstructured })}</p>
      )}
      {delivery.omitted > 0 && (
        <p>{t("runUi.omitted", { count: delivery.omitted })}</p>
      )}
      <h4>{t("delivery.files")}</h4>
      {!delivery.files.length && <p>{t("delivery.noFiles")}</p>}
      <ul className="run-delivery-files">
        {delivery.files.slice(0, fileCount).map((entry) => (
          <RecordedFile
            key={entry.actionId}
            entry={entry}
            busy={busy}
            onPreview={onPreview}
          />
        ))}
      </ul>
      {fileCount < delivery.files.length && (
        <button type="button" onClick={() => setFileCount(fileCount + 10)}>
          {t("delivery.more")}
        </button>
      )}
      <h4>{t("delivery.commands")}</h4>
      <p>{t("delivery.verificationScope")}</p>
      {!delivery.commands.length && <p>{t("delivery.noCommands")}</p>}
      <ol className="run-delivery-commands">
        {delivery.commands.slice(0, commandCount).map(({ actionId, facts }) => {
          const outcome = facts.timedOut
            ? "timeout"
            : facts.signal || facts.exitCode === null
              ? "unknown"
              : facts.exitCode === 0
                ? "zero"
                : "nonzero";
          return (
            <li key={actionId} data-command-outcome={outcome}>
              <strong>
                {t(`delivery.commandOutcomes.${outcome}`, {
                  code: facts.exitCode,
                })}
              </strong>
              <RunOutput label={t("delivery.commands")}>
                {facts.command}
              </RunOutput>
              <small>
                {t("delivery.cwd", { path: facts.cwd })}
                {facts.signal ? ` · ${facts.signal}` : ""}
              </small>
              {(facts.stdout !== undefined || facts.stderr !== undefined) && (
                <details className="run-delivery-command-output">
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
      </ol>
      {commandCount < delivery.commands.length && (
        <button
          type="button"
          onClick={() => setCommandCount(commandCount + 10)}
        >
          {t("delivery.more")}
        </button>
      )}
      <h4>{t("delivery.unresolved")}</h4>
      {!delivery.unresolved.length && <p>{t("delivery.noUnresolved")}</p>}
      <ul>
        {delivery.unresolved.slice(0, issueCount).map((entry) => (
          <li key={entry.actionId}>
            {t(`runUi.tools.${entry.tool}`, { defaultValue: entry.tool })} ·{" "}
            {t(`delivery.states.${entry.status}`)}
          </li>
        ))}
      </ul>
      {issueCount < delivery.unresolved.length && (
        <button type="button" onClick={() => setIssueCount(issueCount + 10)}>
          {t("delivery.more")}
        </button>
      )}
    </details>
  );
}
function RecordedFile({
  entry,
  busy,
  onPreview,
}: {
  entry: ProductRunDelivery["files"][number];
  busy: boolean;
  onPreview: (path: string) => void;
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  return (
    <li>
      <details onToggle={(event) => setOpen(event.currentTarget.open)}>
        <summary>
          <span>{entry.facts.path}</span>
          <small>
            {t(`delivery.operations.${entry.facts.operation}`)} ·{" "}
            {entry.facts.bytes} B
          </small>
        </summary>
        <p>{t("delivery.recordedPatch")}</p>
        {open && (
          <section
            className="run-delivery-patch"
            aria-label={t("delivery.recordedPatch")}
            // biome-ignore lint/a11y/noNoninteractiveTabindex: The bounded diff region needs keyboard scrolling.
            tabIndex={0}
          >
            <DiffViewer
              entry={{
                path: entry.facts.path,
                status:
                  entry.facts.operation === "create" ? "added" : "modified",
                patch: entry.facts.patch,
              }}
            />
          </section>
        )}
        {entry.facts.truncated && <p>{t("runUi.truncated")}</p>}
        <button
          type="button"
          disabled={busy}
          onClick={() => onPreview(entry.facts.path)}
        >
          {t("delivery.previewCurrent")}
        </button>
      </details>
    </li>
  );
}
