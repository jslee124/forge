import { ShieldCheck } from "@phosphor-icons/react/ShieldCheck";
import { useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import type { RunPayload } from "../../shared/run-protocol.js";
import { RunOutput } from "./run-output.js";

export function ApprovalCard({
  approval,
  count,
  pending,
  onDecide,
}: {
  approval: Extract<RunPayload, { type: "approval" }>;
  count: number;
  pending: boolean;
  onDecide: (allow: boolean) => Promise<void>;
}) {
  const { t } = useTranslation();
  const denyRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    denyRef.current?.focus();
  }, []);
  const descriptor = approval.descriptor;
  return (
    <section
      className="run-approval"
      aria-labelledby="run-approval-title"
      aria-busy={pending}
    >
      <header>
        <ShieldCheck size={20} aria-hidden="true" />
        <div>
          <h3 id="run-approval-title">{t("runUi.approvalTitle")}</h3>
          <p>
            {descriptor
              ? t(`runUi.effects.${descriptor.effect}`)
              : t("runUi.opaqueApproval")}
          </p>
        </div>
        {count > 1 && <span>{t("runUi.pendingCount", { count })}</span>}
      </header>
      {descriptor && (
        <code
          className="run-approval-preview"
          title={descriptor.preview.split("\n")[0]}
        >
          {descriptor.preview.split("\n")[0]}
        </code>
      )}
      {descriptor && (
        <dl>
          <dt>{t("runUi.resource")}</dt>
          <dd>{descriptor.resource}</dd>
          <dt>{t("runUi.scope")}</dt>
          <dd>{t("runUi.once")}</dd>
        </dl>
      )}
      {descriptor && descriptor.riskFlags.length > 0 && (
        <p className="run-approval-risk">
          {descriptor.riskFlags
            .map((flag) => t(`runUi.risks.${flag}`))
            .join(" · ")}
        </p>
      )}
      <details className="run-approval-details">
        <summary>{t("runUi.fullAction")}</summary>
        <RunOutput label={t("runUi.fullAction")}>
          {descriptor?.preview ?? approval.description}
        </RunOutput>
        {descriptor && (
          <RunOutput label={t("runUi.input")}>{descriptor.input}</RunOutput>
        )}
      </details>
      <footer>
        <span>{t("runUi.waiting")}</span>
        <button
          ref={denyRef}
          type="button"
          disabled={pending}
          onClick={() => void onDecide(false)}
        >
          {t("common.deny")}
        </button>
        <button
          type="button"
          className="run-approval-allow"
          disabled={pending}
          onClick={() => void onDecide(true)}
        >
          {t("runUi.allowOnce")}
        </button>
      </footer>
    </section>
  );
}
