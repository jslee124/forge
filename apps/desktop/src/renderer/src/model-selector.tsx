import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import type {
  DesktopState,
  ModelSelection,
} from "../../shared/application-protocol.js";
export function ModelSelector({
  state,
  engine,
  model,
  busy,
  onEngineChange,
  selection,
  onSelection,
  onRefresh,
  onSave,
}: {
  state: DesktopState | undefined;
  engine: "native" | "codex";
  model: string;
  busy: boolean;
  onEngineChange: (engine: "native" | "codex") => void;
  selection: ModelSelection | undefined;
  onSelection: (value: ModelSelection) => void;
  onRefresh: () => Promise<void>;
  onSave: (value: ModelSelection) => Promise<boolean>;
}) {
  const { t, i18n } = useTranslation();
  const zh = i18n.language.startsWith("zh");
  const searchRef = useRef<HTMLInputElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const pickerRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState({
    bottom: 80,
    right: 16,
    width: 360,
  });
  const reposition = useCallback(() => {
    const trigger = triggerRef.current?.getBoundingClientRect();
    if (!trigger) return;
    const main = triggerRef.current
      ?.closest(".live-main")
      ?.getBoundingClientRect();
    const leftBound = (main?.left ?? 0) + 16;
    const rightBound = (main?.right ?? window.innerWidth) - 16;
    const width = Math.min(360, rightBound - leftBound);
    const left = Math.max(
      leftBound,
      Math.min(trigger.right - width, rightBound - width),
    );
    setPosition({
      bottom: window.innerHeight - trigger.top + 8,
      right: window.innerWidth - left - width,
      width,
    });
  }, []);
  const toggle = () => {
    reposition();
    setOpen((value) => !value);
  };
  useEffect(() => {
    if (open) searchRef.current?.focus();
  }, [open]);
  const [query, setQuery] = useState("");
  const [feedback, setFeedback] = useState("");
  // biome-ignore lint/correctness/useExhaustiveDependencies: Changing the task or engine clears transient picker state.
  useEffect(() => {
    setQuery("");
    setFeedback("");
  }, [engine, model]);
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      if (
        event.target instanceof Node &&
        !pickerRef.current?.contains(event.target)
      ) {
        setOpen(false);
      }
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.stopPropagation();
        setOpen(false);
        triggerRef.current?.focus();
      }
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown, true);
    window.addEventListener("resize", reposition);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown, true);
      window.removeEventListener("resize", reposition);
    };
  }, [open, reposition]);
  const listed = (state?.modelCatalog ?? []).filter((x) => x.engine === engine);
  const legacyId = selection?.model || model || state?.defaultSelection?.model;
  const entries = listed.concat(
    engine === "native" &&
      (legacyId === "deepseek-v4-flash" ||
        legacyId === "deepseek-v4-flash-vision-exp") &&
      !listed.some(
        (entry) => entry.provider === "deepseek" && entry.id === legacyId,
      )
      ? [
          {
            engine: "native",
            provider: "deepseek",
            id: legacyId,
            label: `DeepSeek V4.1 Flash · ${zh ? "兼容别名" : "compatibility alias"}`,
            efforts: ["low", "medium", "high", "max"],
            defaultEffort: "high",
          },
        ]
      : [],
  );
  const current = entries.find(
    (x) =>
      x.id === (selection?.model || model || state?.defaultSelection?.model) &&
      (!selection || x.provider === selection.provider),
  );
  const chosen =
    selection ??
    (state?.defaultSelection?.engine === engine &&
    state.defaultSelection.model === current?.id &&
    state.defaultSelection.provider === current?.provider
      ? state.defaultSelection
      : undefined) ??
    (current
      ? {
          engine,
          provider: current.provider,
          model: current.id,
          effort: current.defaultEffort as NonNullable<
            ModelSelection["effort"]
          >,
        }
      : undefined);
  return (
    <div className="studio-model-controls">
      <label>
        {t("live.engine")}{" "}
        <select
          disabled={busy}
          data-testid="composer-engine"
          value={engine}
          onChange={(e) => {
            onEngineChange(e.target.value as "native" | "codex");
            setQuery("");
            setFeedback("");
          }}
        >
          <option value="native">Forge</option>
          <option value="codex">Codex</option>
        </select>
      </label>
      <div className="studio-model-picker" ref={pickerRef}>
        <label>
          {t("live.model")}{" "}
          <button
            type="button"
            disabled={busy}
            ref={triggerRef}
            data-testid="composer-model"
            aria-expanded={open}
            aria-haspopup="dialog"
            title={current?.label || model}
            aria-label={`${t("live.model")}: ${current?.label || model || (zh ? "选择模型" : "Choose model")}`}
            onClick={toggle}
          >
            {current?.label || model || (zh ? "选择模型" : "Choose model")}
          </button>
        </label>
        {open && (
          <section
            role="dialog"
            aria-modal="false"
            tabIndex={-1}
            className="studio-model-popover"
            style={{
              position: "fixed",
              bottom: position.bottom,
              right: position.right,
              left: "auto",
              width: position.width,
            }}
            aria-label={zh ? "模型选择" : "Model selection"}
          >
            <div className="studio-model-search">
              <input
                ref={searchRef}
                aria-label={zh ? "搜索模型" : "Search models"}
                placeholder={
                  zh ? "搜索模型或提供商" : "Search model or provider"
                }
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
              <button
                type="button"
                disabled={busy}
                onClick={() => void onRefresh()}
              >
                {busy
                  ? zh
                    ? "加载中…"
                    : "Loading…"
                  : zh
                    ? "刷新列表"
                    : "Refresh"}
              </button>
            </div>
            {engine === "codex" && state?.modelCatalogError && (
              <p role="alert">
                {zh
                  ? "Codex 模型发现失败，请登录后重试。"
                  : "Codex discovery failed. Sign in and retry."}
              </p>
            )}
            <div className="studio-model-results">
              {entries
                .filter((x) =>
                  `${x.label} ${x.id} ${x.provider}`
                    .toLowerCase()
                    .includes(query.toLowerCase()),
                )
                .map((x) => (
                  <button
                    type="button"
                    key={`${x.provider}/${x.id}`}
                    disabled={busy}
                    aria-pressed={
                      chosen?.model === x.id && chosen?.provider === x.provider
                    }
                    title={`${x.label} · ${x.provider} / ${x.id}`}
                    onClick={() => {
                      onSelection({
                        engine,
                        provider: x.provider,
                        model: x.id,
                        effort: x.defaultEffort as NonNullable<
                          ModelSelection["effort"]
                        >,
                      });
                      setFeedback("");
                      setOpen(false);
                      triggerRef.current?.focus();
                    }}
                  >
                    <span>{x.label}</span>
                    {chosen?.model === x.id &&
                      chosen?.provider === x.provider && (
                        <span aria-hidden="true">✓</span>
                      )}
                    <small>
                      {x.provider} / {x.id}
                    </small>
                  </button>
                ))}
            </div>
            {!entries.filter((x) =>
              `${x.label} ${x.id} ${x.provider}`
                .toLowerCase()
                .includes(query.toLowerCase()),
            ).length && <p>{zh ? "没有匹配模型" : "No matching models"}</p>}
            <div className="studio-model-footer">
              <label>
                {zh ? "推理强度" : "Reasoning effort"}
                <select
                  data-testid="composer-effort"
                  disabled={busy || !chosen || !current?.efforts.length}
                  value={chosen?.effort ?? ""}
                  onChange={(e) => {
                    if (chosen)
                      onSelection({
                        ...chosen,
                        effort: e.target.value as NonNullable<
                          ModelSelection["effort"]
                        >,
                      });
                  }}
                >
                  <option value="" disabled>
                    {zh ? "提供商默认" : "Provider default"}
                  </option>
                  {current?.efforts.map((x) => (
                    <option key={x} value={x}>
                      {x}
                    </option>
                  ))}
                </select>
              </label>
              <p>
                {zh
                  ? "选择仅影响本次任务；保存默认值将写入 Forge 配置。"
                  : "Selection applies to this task. Saving the default writes Forge configuration."}
              </p>
              <button
                type="button"
                disabled={busy || !chosen}
                onClick={async () => {
                  if (chosen)
                    setFeedback(
                      (await onSave(chosen))
                        ? zh
                          ? "已保存默认值"
                          : "Default saved"
                        : zh
                          ? "保存失败"
                          : "Save failed",
                    );
                }}
              >
                {zh ? "保存为默认" : "Save as default"}
              </button>
              <button
                type="button"
                onClick={() => {
                  setOpen(false);
                  triggerRef.current?.focus();
                }}
              >
                {zh ? "关闭" : "Close"}
              </button>
              <p role="status">{feedback}</p>
            </div>
          </section>
        )}
      </div>
    </div>
  );
}
