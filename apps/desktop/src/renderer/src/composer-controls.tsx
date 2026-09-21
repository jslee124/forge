import { ArrowUp } from "@phosphor-icons/react/ArrowUp";
import { useTranslation } from "react-i18next";
import type {
  DesktopState,
  ModelSelection,
} from "../../shared/application-protocol.js";
import { ComposerContext } from "./composer-context.js";
import { ModelSelector } from "./model-selector.js";
export function ComposerControls({
  state,
  engine,
  model,
  permission,
  setPermission,
  busy,
  importFile,
  onEngineChange,
  selection,
  onSelection,
  onRefresh,
  onSave,
  active,
  status,
  cancel,
  send,
  canSend,
}: {
  state: DesktopState | undefined;
  engine: "native" | "codex";
  model: string;
  permission: "safe" | "workspace-write";
  setPermission: (value: "safe" | "workspace-write") => void;
  busy: boolean;
  importFile: () => Promise<void>;
  onEngineChange: (engine: "native" | "codex") => void;
  selection: ModelSelection | undefined;
  onSelection: (value: ModelSelection) => void;
  onRefresh: () => Promise<void>;
  onSave: (value: ModelSelection) => Promise<boolean>;
  active: boolean;
  status: string;
  cancel: () => Promise<void>;
  send: () => Promise<void>;
  canSend: boolean;
}) {
  const { t } = useTranslation();
  return (
    <div className="studio-composer-footer">
      <ComposerContext
        state={state}
        engine={engine}
        permission={permission}
        onPermission={setPermission}
        busy={busy}
        onImport={importFile}
      />
      <ModelSelector
        state={state}
        engine={engine}
        model={model}
        busy={busy}
        onEngineChange={onEngineChange}
        selection={selection}
        onSelection={onSelection}
        onRefresh={onRefresh}
        onSave={onSave}
      />
      <span className="studio-shortcut">⌘ / Ctrl ↵</span>
      {active ? (
        <button
          type="button"
          disabled={status === "stopping"}
          onClick={() => void cancel()}
        >
          {t(status === "stopping" ? "live.stopping" : "live.stop")}
        </button>
      ) : (
        <button type="button" disabled={!canSend} onClick={() => void send()}>
          <ArrowUp size={16} />
          {t("live.send")}
        </button>
      )}
    </div>
  );
}
