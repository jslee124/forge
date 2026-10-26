import { useTranslation } from "react-i18next";
import type { RecoveryPlan } from "../../shared/application-protocol.js";
import { ConfirmationDialog } from "./confirmation-dialog.js";
import { RunOutput } from "./run-output.js";

export function RecoveryReview({
  plan,
  hasDraft,
  busy,
  onConfirm,
  onCancel,
}: {
  plan: RecoveryPlan;
  hasDraft: boolean;
  busy: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const { t } = useTranslation();
  return (
    <ConfirmationDialog
      title={t(`recovery.actions.${plan.kind}`)}
      busy={busy}
      confirmLabel={t(
        plan.kind === "retry"
          ? hasDraft
            ? "recovery.replaceDraft"
            : "recovery.loadDraft"
          : "recovery.start",
      )}
      cancelLabel={t(
        plan.kind === "retry" && hasDraft
          ? "recovery.keepDraft"
          : "recovery.cancel",
      )}
      onConfirm={onConfirm}
      onCancel={onCancel}
    >
      <p>
        {t(
          plan.kind === "summarize"
            ? "recovery.summaryScope"
            : plan.kind === "continue"
              ? "recovery.continueScope"
              : "recovery.retryScope",
        )}
      </p>
      <dl className="recovery-plan-metadata">
        <dt>{t("recovery.source")}</dt>
        <dd>{plan.sourceRunId}</dd>
        <dt>{t("recovery.model")}</dt>
        <dd>
          {plan.selection.provider} / {plan.selection.model} ·{" "}
          {plan.selection.effort}
        </dd>
        <dt>{t("recovery.budget")}</dt>
        <dd>
          {t("recovery.budgetValue", {
            steps: plan.maxModelSteps,
            tools: plan.maxToolCalls,
          })}
        </dd>
        {plan.kind === "summarize" && plan.responseLocale && (
          <>
            <dt>{t("recovery.language")}</dt>
            <dd>{plan.responseLocale === "zh-CN" ? "简体中文" : "English"}</dd>
          </>
        )}
        <dt>{t("recovery.permission")}</dt>
        <dd>
          {plan.kind === "summarize"
            ? t("recovery.noTools")
            : t(
                plan.permissionProfile === "safe"
                  ? "recovery.permissions.safe"
                  : "recovery.permissions.workspace",
              )}
        </dd>
      </dl>
      {plan.incomplete && <p>{t("recovery.incomplete")}</p>}
      {hasDraft && (
        <p>
          {t(
            plan.kind === "retry"
              ? "recovery.draftConflict"
              : "recovery.draftPreserved",
          )}
        </p>
      )}
      <RunOutput label={t("recovery.prompt")}>{plan.prompt}</RunOutput>
    </ConfirmationDialog>
  );
}
