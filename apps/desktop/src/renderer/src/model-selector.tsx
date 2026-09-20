import { useTranslation } from "react-i18next";
import type { DesktopState } from "../../shared/application-protocol.js";

export function ModelSelector({
  state,
  engine,
  model,
  busy,
  onEngineChange,
  setModel,
}: {
  state: DesktopState | undefined;
  engine: "native" | "codex";
  model: string;
  busy: boolean;
  onEngineChange: (engine: "native" | "codex") => void;
  setModel: (model: string) => void;
}) {
  const { t } = useTranslation();
  return (
    <div className="studio-model-controls">
      {" "}
      <label>
        {t("live.engine")}{" "}
        <select
          disabled={busy}
          data-testid="composer-engine"
          value={engine}
          onChange={(event) =>
            onEngineChange(event.target.value as "native" | "codex")
          }
        >
          <option value="native">Forge</option>
          <option value="codex">Codex</option>
        </select>
      </label>
      <label>
        {t("live.model")}{" "}
        <input
          disabled={busy}
          value={model}
          onChange={(event) => setModel(event.target.value)}
          placeholder={
            engine === "native"
              ? `${state?.model ?? ""}`
              : t("live.defaultModel")
          }
          data-testid="composer-model"
          list="model-list"
        />
      </label>
      <datalist id="model-list">
        {engine === "native" && state?.model && <option value={state.model} />}
        {(engine === "codex" ? (state?.codexModels ?? []) : []).map((entry) => (
          <option key={entry} value={entry} />
        ))}
      </datalist>
    </div>
  );
}
