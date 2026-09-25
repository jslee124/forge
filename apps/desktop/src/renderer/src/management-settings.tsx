import { useEffect, useRef, useState } from "react";
import type {
  DesktopState,
  ManagementCommand,
} from "../../shared/application-protocol.js";
import { ConfirmationDialog } from "./confirmation-dialog.js";

export function ManagementSettings({
  state,
  busy,
  manage,
  zh,
  section,
}: {
  state: DesktopState | undefined;
  busy: boolean;
  zh: boolean;
  section: "models" | "extensions";
  manage: (
    command: Exclude<ManagementCommand, { type: "workspace" }>,
  ) => Promise<DesktopState | undefined>;
}) {
  const [provider, setProvider] = useState("deepseek");
  const [confirmation, setConfirmation] = useState<ManagementCommand>();
  const [feedback, setFeedback] = useState("");
  const keyInput = useRef<HTMLInputElement>(null);
  const initialManage = useRef(manage);
  useEffect(() => {
    void initialManage.current({ type: "management-status" });
  }, []);
  const info = state?.management;
  const account = info?.providers.find((p) => p.id === provider);
  async function apply(
    command: Exclude<ManagementCommand, { type: "workspace" }>,
  ) {
    setConfirmation(undefined);
    setFeedback("");
    const result = await manage(command);
    setFeedback(
      result
        ? result.operationResult || (zh ? "已更新" : "Updated")
        : zh
          ? "操作失败，原设置未被确认更改。请检查错误后重试。"
          : "Operation failed. Changes are not confirmed; check the error and retry.",
    );
  }
  return (
    <section
      className="studio-management"
      aria-label={zh ? "管理" : "Management"}
    >
      {section === "models" && (
        <div className="studio-connection-card">
          <h3 id="settings-credentials">
            {zh ? "Forge · API 凭证" : "Forge · API credentials"}
          </h3>
          <details>
            <summary>
              {zh ? "凭证保存与优先级" : "Credential storage and precedence"}
            </summary>
            <p>
              {zh
                ? "保存到本机凭证库，不验证连接。环境变量优先于已保存凭证。Codex 订阅登录在独立区域管理。"
                : "Save to the local credential store without testing a connection. Environment values override stored credentials. Codex subscription login is managed separately."}
            </p>
          </details>
          <label>
            {zh ? "提供商" : "Provider"}{" "}
            <select
              value={provider}
              disabled={busy}
              onChange={(e) => {
                setProvider(e.target.value);
                if (keyInput.current) keyInput.current.value = "";
              }}
            >
              {(info?.providers ?? [{ id: "deepseek" }, { id: "openai" }]).map(
                (p) => (
                  <option key={p.id} value={p.id}>
                    {p.id}
                  </option>
                ),
              )}
            </select>
          </label>
          <p>
            {account?.source === "environment"
              ? zh
                ? "环境变量"
                : "Environment variable"
              : account?.source === "stored"
                ? zh
                  ? "本机已保存"
                  : "Stored locally"
                : zh
                  ? "未配置"
                  : "Not configured"}{" "}
            · {account?.environmentVariable}
          </p>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              const input = keyInput.current;
              const apiKey = input?.value.trim() ?? "";
              if (input) input.value = "";
              if (apiKey)
                void apply({ type: "native-login", provider, apiKey });
            }}
          >
            <label>
              API key{" "}
              <input
                ref={keyInput}
                type="password"
                autoComplete="off"
                required
                disabled={busy}
              />
            </label>
            <button type="submit" disabled={busy}>
              {zh ? "保存凭证" : "Save credential"}
            </button>
          </form>
          <button
            type="button"
            disabled={busy}
            onClick={() =>
              setConfirmation({ type: "logout", engine: "native", provider })
            }
          >
            {zh
              ? "删除此提供商的本机凭证"
              : "Remove this provider’s stored credential"}
          </button>
        </div>
      )}
      {section === "models" && (
        <div className="studio-connection-card">
          <h3 id="settings-models">{zh ? "配置模型" : "Configured models"}</h3>
          <details>
            <summary>{zh ? "删除范围" : "Deletion scope"}</summary>
            <p>
              {zh
                ? "仅删除用户配置中的模型。当前默认模型需先在输入框选择替代项并保存默认值；项目配置与内置模型不会被删除。"
                : "Only user-configured models can be removed. Save another default in the composer first when removing the default model. Project and built-in models remain."}
            </p>
          </details>
          {!info?.models.length && (
            <p>{zh ? "没有配置模型" : "No configured models"}</p>
          )}
          {info?.models.map((m) => (
            <div key={m.provider + "/" + m.id}>
              <code>
                {m.provider}/{m.id}
              </code>{" "}
              <button
                type="button"
                disabled={
                  busy ||
                  (state?.defaultSelection?.provider === m.provider &&
                    state.defaultSelection.model === m.id)
                }
                onClick={() =>
                  setConfirmation({
                    type: "model-delete",
                    provider: m.provider,
                    model: m.id,
                  })
                }
              >
                {zh ? "删除…" : "Delete…"}
              </button>
            </div>
          ))}
        </div>
      )}
      {section === "extensions" && (
        <div className="studio-connection-card">
          <h3 id="settings-plugins">
            {zh ? "插件与资源" : "Plugins and resources"}
          </h3>
          <details>
            <summary>
              {zh ? "插件信任与网络审批" : "Plugin trust and network approval"}
            </summary>
            <p>
              {zh
                ? "发现不等于执行授权。用户插件必须显式启用；项目信任只控制插件加载，网络请求仍遵循审批。下方 Web 工具可单独安装和配置；其他插件的安装请使用现有 CLI。"
                : "Discovery does not authorize execution. User plugins require explicit enablement; project trust controls loading, while network requests retain approval checks. Install/configure bundled Web tools below; use the existing CLI to install other plugins."}
            </p>
          </details>
          <button
            type="button"
            disabled={busy}
            onClick={() => void apply({ type: "management-status" })}
          >
            {zh ? "刷新诊断" : "Refresh diagnostics"}
          </button>
          {info?.plugins.map((p) => (
            <div key={p.scope + p.name}>
              <code>
                {p.name} {p.version}
              </code>{" "}
              · {p.scope} · {p.state}{" "}
              {p.scope === "user" && (
                <button
                  type="button"
                  disabled={busy}
                  onClick={() =>
                    setConfirmation({
                      type: "plugin-enable",
                      name: p.name,
                      enabled: p.state !== "enabled",
                    })
                  }
                >
                  {p.state === "enabled"
                    ? zh
                      ? "停用…"
                      : "Disable…"
                    : zh
                      ? "启用…"
                      : "Enable…"}
                </button>
              )}
            </div>
          ))}
          {info?.plugins.some((p) => p.scope === "project") && (
            <div>
              <button
                type="button"
                disabled={busy}
                onClick={() =>
                  setConfirmation({ type: "project-trust", trusted: true })
                }
              >
                {zh ? "信任此项目插件…" : "Trust project plugins…"}
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={() =>
                  setConfirmation({ type: "project-trust", trusted: false })
                }
              >
                {zh ? "撤销项目信任…" : "Revoke project trust…"}
              </button>
            </div>
          )}
          {!info?.plugins.length && (
            <p>{zh ? "未发现插件" : "No plugins discovered"}</p>
          )}
          <details id="settings-resources">
            <summary>
              {zh ? "Skills 只读诊断" : "Read-only Skill diagnostics"} (
              {info?.skills.length ?? 0})
            </summary>
            {info?.skills.map((s) => (
              <p key={s.path}>
                <strong>{s.name}</strong> · {s.source} · {s.status}
                <br />
                <code>{s.path}</code>
              </p>
            ))}
            {info?.diagnostics.map((d) => (
              <p key={d} role="status">
                {d}
              </p>
            ))}
          </details>
        </div>
      )}
      {confirmation && (
        <ConfirmationDialog
          title={zh ? "确认操作" : "Confirm operation"}
          confirmLabel={zh ? "确认" : "Confirm"}
          cancelLabel={zh ? "取消" : "Cancel"}
          busy={busy}
          onCancel={() => setConfirmation(undefined)}
          onConfirm={() => {
            if (confirmation.type !== "workspace") void apply(confirmation);
          }}
        >
          <p>
            {confirmation.type === "model-delete"
              ? `${zh ? "删除模型" : "Delete model"}: ${confirmation.provider}/${confirmation.model}`
              : confirmation.type === "logout"
                ? `${zh ? "移除本机凭证" : "Remove stored credential"}: Forge / ${confirmation.provider}`
                : confirmation.type === "plugin-enable"
                  ? `${confirmation.enabled ? (zh ? "启用插件" : "Enable plugin") : zh ? "停用插件" : "Disable plugin"}: ${confirmation.name}`
                  : confirmation.type === "project-trust"
                    ? confirmation.trusted
                      ? zh
                        ? "允许加载此项目中发现的插件"
                        : "Allow loading plugins discovered in this project"
                      : zh
                        ? "撤销此项目的插件信任"
                        : "Revoke plugin trust for this project"
                    : ""}
          </p>
        </ConfirmationDialog>
      )}
      {feedback && <p role="status">{feedback}</p>}
    </section>
  );
}
