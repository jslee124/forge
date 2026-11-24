import type React from "react";
import { useTranslation } from "react-i18next";
import type {
  DesktopState,
  ModelSelection,
  RecoveryPlan,
} from "../../shared/application-protocol.js";
import { ComposerControls } from "./composer-controls.js";
import { SlashCommandMenu } from "./slash-command-menu.js";

export interface WorkbenchComposerProps {
  readonly composerRef: React.RefObject<HTMLTextAreaElement | null>;
  readonly zh: boolean;
  readonly viewed: boolean;
  readonly active: boolean;
  readonly busy: boolean;
  readonly hasApi: boolean;
  readonly status: string;
  readonly draftKey: string;
  readonly draft: string;
  readonly setDrafts: React.Dispatch<
    React.SetStateAction<Record<string, string>>
  >;
  readonly candidates: readonly (readonly [string, string, string])[];
  readonly commandIndex: number;
  readonly setCommandIndex: React.Dispatch<React.SetStateAction<number>>;
  readonly setCommandClosed: React.Dispatch<React.SetStateAction<boolean>>;
  readonly setLiteralOffer: React.Dispatch<React.SetStateAction<boolean>>;
  readonly state: DesktopState | undefined;
  readonly engine: "native" | "codex";
  readonly model: string;
  readonly permission: "safe" | "workspace-write";
  readonly setPermission: (value: "safe" | "workspace-write") => void;
  readonly selection: ModelSelection | undefined;
  readonly retryPlan: RecoveryPlan | undefined;
  readonly onUnlinkRetry: () => void;
  readonly onImportFile: () => Promise<void>;
  readonly onEngineChange: (value: "native" | "codex") => void;
  readonly onSelection: (value: ModelSelection) => void;
  readonly onRefreshModels: () => Promise<void>;
  readonly onSaveSelection: (value: ModelSelection) => Promise<boolean>;
  readonly onExecuteSlash: (input: string) => Promise<void>;
  readonly onCancel: () => Promise<void>;
  readonly onSend: (literal?: boolean) => Promise<void>;
}

export function WorkbenchComposer({
  composerRef,
  zh,
  viewed,
  active,
  busy,
  hasApi,
  status,
  draftKey,
  draft,
  setDrafts,
  candidates,
  commandIndex,
  setCommandIndex,
  setCommandClosed,
  setLiteralOffer,
  state,
  engine,
  model,
  permission,
  setPermission,
  selection,
  retryPlan,
  onUnlinkRetry,
  onImportFile,
  onEngineChange,
  onSelection,
  onRefreshModels,
  onSaveSelection,
  onExecuteSlash,
  onCancel,
  onSend,
}: WorkbenchComposerProps): React.JSX.Element {
  const { t } = useTranslation();

  return (
    <>
      {retryPlan && (
        <div className="run-retry-draft" role="status">
          <span>{t("recovery.retryDraft")}</span>
          <button type="button" disabled={busy} onClick={onUnlinkRetry}>
            {t("recovery.unlink")}
          </button>
        </div>
      )}
      <div className="live-composer">
        {candidates.length > 0 && (
          <SlashCommandMenu
            candidates={candidates}
            commandIndex={commandIndex}
            busy={busy}
            zh={zh}
            executeSlash={onExecuteSlash}
          />
        )}
        <textarea
          ref={composerRef}
          rows={3}
          role="combobox"
          aria-autocomplete="list"
          aria-expanded={candidates.length > 0}
          aria-controls={candidates.length ? "slash-menu" : undefined}
          aria-activedescendant={
            candidates.length
              ? `slash-option-${commandIndex % candidates.length}`
              : undefined
          }
          onKeyDown={(event) => {
            if (
              event.nativeEvent.isComposing ||
              event.nativeEvent.keyCode === 229
            )
              return;
            if (event.key === "Enter" && event.shiftKey) return;
            if (candidates.length) {
              if (event.key === "Escape") {
                event.preventDefault();
                setCommandClosed(true);
                return;
              }
              if (event.key === "ArrowDown" || event.key === "ArrowUp") {
                event.preventDefault();
                setCommandIndex(
                  (v) =>
                    (v +
                      (event.key === "ArrowDown" ? 1 : candidates.length - 1)) %
                    candidates.length,
                );
                return;
              }
              if (event.key === "Tab") {
                event.preventDefault();
                const selected = candidates[commandIndex % candidates.length];
                if (selected) {
                  setDrafts((v) => ({
                    ...v,
                    [draftKey]: `/${selected[0]}`,
                  }));
                }
                setCommandClosed(true);
                return;
              }
              if (event.key === "Enter") {
                event.preventDefault();
                const selected = candidates[commandIndex % candidates.length];
                if (selected) {
                  void onExecuteSlash(`/${selected[0]}`);
                }
                return;
              }
            }
            if (event.key === "Enter" && !event.altKey) {
              event.preventDefault();
              void onSend();
            }
          }}
          aria-label={t("home.placeholder")}
          title={
            zh
              ? "Enter 发送，Shift+Enter 换行"
              : "Enter to send, Shift+Enter for a new line"
          }
          placeholder={t("home.placeholder")}
          value={draft}
          onChange={(event) => {
            setLiteralOffer(false);
            setCommandIndex(0);
            setCommandClosed(false);
            setDrafts((values) => ({
              ...values,
              [draftKey]: event.target.value,
            }));
          }}
        />
        {viewed ? (
          <div className="browsing-draft-note">
            {t(active ? "browsing.draftWhileRunning" : "browsing.draftReady")}
          </div>
        ) : (
          <ComposerControls
            state={state}
            engine={engine}
            model={model}
            permission={permission}
            setPermission={setPermission}
            busy={busy}
            importFile={onImportFile}
            onEngineChange={onEngineChange}
            selection={selection}
            onSelection={onSelection}
            onRefresh={onRefreshModels}
            onSave={onSaveSelection}
            active={active}
            status={status}
            cancel={onCancel}
            send={onSend}
            lockSettings={Boolean(retryPlan)}
            canSend={!busy && Boolean(draft.trim()) && hasApi}
          />
        )}
      </div>
    </>
  );
}
